import type {
  BdixNodeResult,
  BdixNodeTarget,
  BdixPeeringVerdict,
  BrowserConnectionInfo,
  BufferbloatGrade,
  BufferbloatResult,
  CdnNodeResult,
  CdnNodeTarget,
  ClientNetworkContext,
  LatencyStats,
  TestEngine,
  ThroughputSample,
} from '../types/network';

function appendCacheBuster(url: string): string {
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}_cb=${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

export function calculateJitter(samples: number[]): number {
  if (samples.length < 2) return 0;
  let totalDelta = 0;
  for (let i = 1; i < samples.length; i++) {
    totalDelta += Math.abs(samples[i] - samples[i - 1]);
  }
  return Number((totalDelta / (samples.length - 1)).toFixed(2));
}

export function computeLatencyStats(samples: number[], totalAttempts: number): LatencyStats {
  if (samples.length === 0) {
    return {
      min: 0,
      median: 0,
      avg: 0,
      p95: 0,
      p99: 0,
      jitter: 0,
      lossPct: 100,
      samples: [],
    };
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const sum = samples.reduce((acc, v) => acc + v, 0);
  const failed = Math.max(0, totalAttempts - samples.length);
  return {
    min: Number(sorted[0].toFixed(2)),
    median: Number(percentile(sorted, 0.5).toFixed(2)),
    avg: Number((sum / samples.length).toFixed(2)),
    p95: Number(percentile(sorted, 0.95).toFixed(2)),
    p99: Number(percentile(sorted, 0.99).toFixed(2)),
    jitter: calculateJitter(samples),
    lossPct: Number(((failed / Math.max(1, totalAttempts)) * 100).toFixed(1)),
    samples: samples.map((v) => Number(v.toFixed(2))),
  };
}

export function computeBufferbloatGrade(
  downloadDeltaMs: number | null,
  uploadDeltaMs: number | null
): BufferbloatGrade {
  const deltas = [downloadDeltaMs, uploadDeltaMs].filter((v): v is number => v !== null);
  if (deltas.length === 0) return 'A';
  const worstDelta = Math.max(...deltas);
  if (worstDelta < 10) return 'A+';
  if (worstDelta < 30) return 'A';
  if (worstDelta < 75) return 'B';
  if (worstDelta < 150) return 'C';
  if (worstDelta < 300) return 'D';
  return 'F';
}

export async function detectNetworkContext(): Promise<ClientNetworkContext> {
  let browserLink: BrowserConnectionInfo | null = null;
  const nav = navigator as Navigator & {
    connection?: {
      effectiveType?: string;
      downlink?: number;
      rtt?: number;
      saveData?: boolean;
      type?: string;
    };
  };

  if (nav.connection) {
    browserLink = {
      effectiveType: nav.connection.effectiveType,
      downlink: nav.connection.downlink,
      rtt: nav.connection.rtt,
      saveData: nav.connection.saveData,
      type: nav.connection.type,
    };
  }

  let serverInfo: {
    clientIp?: string | null;
    country?: string | null;
    serverRegion?: string | null;
  } = {};

  try {
    const res = await fetch('/api/network-info', { cache: 'no-store' });
    if (res.ok) {
      serverInfo = await res.json();
    }
  } catch {
    // Ignore local server info failure
  }

  let geoInfo: {
    ip?: string;
    city?: string;
    country?: string;
    country_code?: string;
    connection?: { isp?: string; org?: string; asn?: number };
  } | null = null;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3200);
    const geoRes = await fetch('https://ipwho.is/', {
      cache: 'no-store',
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (geoRes.ok) {
      const parsed = await geoRes.json();
      if (parsed && parsed.success !== false) {
        geoInfo = parsed;
      }
    }
  } catch {
    // Public IP lookup optional; fallback to server-detected headers
  }

  return {
    ip: geoInfo?.ip || serverInfo.clientIp || null,
    isp: geoInfo?.connection?.isp || geoInfo?.connection?.org || null,
    asn: geoInfo?.connection?.asn ? `AS${geoInfo.connection.asn}` : null,
    city: geoInfo?.city || null,
    countryCode: geoInfo?.country_code || serverInfo.country || null,
    countryName: geoInfo?.country || null,
    browserLink,
    serverRegion: serverInfo.serverRegion || null,
    detectedAt: Date.now(),
  };
}

async function singlePing(
  url: string,
  mode: RequestMode,
  timeoutMs: number,
  signal: AbortSignal
): Promise<number | null> {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const start = performance.now();
  try {
    const res = await fetch(appendCacheBuster(url), {
      method: 'GET',
      mode,
      cache: 'no-store',
      signal: controller.signal,
    });
    if (mode === 'cors' && !res.ok && res.status !== 204) {
      return null;
    }
    return performance.now() - start;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', onAbort);
  }
}

export function getEngineEndpoints(engine: TestEngine) {
  if (engine === 'cloudflare') {
    return {
      pingUrl: 'https://speed.cloudflare.com/__down?bytes=0',
      downUrl: (bytes: number) => `https://speed.cloudflare.com/__down?bytes=${bytes}`,
      upUrl: 'https://speed.cloudflare.com/__up',
      mode: 'cors' as RequestMode,
    };
  }
  return {
    pingUrl: '/api/speed/ping',
    downUrl: (bytes: number) => `/api/speed/down?bytes=${bytes}`,
    upUrl: '/api/speed/up',
    mode: 'cors' as RequestMode,
  };
}

export async function resolveWorkingEngine(
  preferred: TestEngine,
  signal: AbortSignal
): Promise<TestEngine> {
  if (preferred === 'app-edge') return 'app-edge';
  const cfPing = await singlePing(
    'https://speed.cloudflare.com/__down?bytes=0',
    'cors',
    2500,
    signal
  );
  if (cfPing !== null) return 'cloudflare';
  return 'app-edge';
}

export async function measureIdleLatency(
  engine: TestEngine,
  signal: AbortSignal,
  onSample?: (stats: LatencyStats) => void
): Promise<LatencyStats> {
  const { pingUrl } = getEngineEndpoints(engine);
  const totalMeasuredAttempts = 12;
  const samples: number[] = [];

  // Warm-up request to establish TLS/H2 connection
  await singlePing(pingUrl, 'cors', 3000, signal);

  for (let i = 0; i < totalMeasuredAttempts; i++) {
    if (signal.aborted) break;
    const rtt = await singlePing(pingUrl, 'cors', 3000, signal);
    if (rtt !== null) {
      samples.push(rtt);
    }
    if (onSample && samples.length > 0) {
      onSample(computeLatencyStats(samples, i + 1));
    }
    await new Promise((r) => setTimeout(r, 45));
  }

  return computeLatencyStats(samples, totalMeasuredAttempts);
}

export async function runDownloadBenchmark(
  engine: TestEngine,
  signal: AbortSignal,
  onProgress: (info: {
    currentMbps: number;
    peakMbps: number;
    sample: ThroughputSample;
    loadedLatencyMs: number | null;
  }) => void
): Promise<{
  sustainedMbps: number;
  peakMbps: number;
  samples: ThroughputSample[];
  loadedLatencySamples: number[];
}> {
  const { downUrl, pingUrl } = getEngineEndpoints(engine);
  const testDurationMs = 8500;
  const warmupWindowMs = 1000;
  const concurrency = 4;
  const chunkSizes = [2_000_000, 6_000_000, 14_000_000, 24_000_000];

  const phaseController = new AbortController();
  const onParentAbort = () => phaseController.abort();
  signal.addEventListener('abort', onParentAbort, { once: true });

  const startTime = performance.now();
  let totalBytes = 0;
  let lastSnapshotBytes = 0;
  let lastSnapshotTime = startTime;
  let peakMbps = 0;
  let latestLoadedPing: number | null = null;
  const samples: ThroughputSample[] = [];
  const loadedLatencySamples: number[] = [];

  // Sample throughput every 180ms
  const samplerInterval = setInterval(() => {
    const now = performance.now();
    const dtSec = (now - lastSnapshotTime) / 1000;
    if (dtSec <= 0.05) return;

    const deltaBytes = totalBytes - lastSnapshotBytes;
    const instMbps = Number(((deltaBytes * 8) / (dtSec * 1_000_000)).toFixed(2));

    lastSnapshotBytes = totalBytes;
    lastSnapshotTime = now;

    if (instMbps > peakMbps) peakMbps = instMbps;

    const sample: ThroughputSample = {
      t: Math.round(now - startTime),
      mbps: instMbps,
      phase: 'download',
    };
    samples.push(sample);

    onProgress({
      currentMbps: instMbps,
      peakMbps: Number(peakMbps.toFixed(2)),
      sample,
      loadedLatencyMs: latestLoadedPing,
    });
  }, 180);

  // Measure loaded latency (bufferbloat) concurrently every 450ms
  let pingActive = true;
  const pingLoop = (async () => {
    while (pingActive && !phaseController.signal.aborted) {
      const rtt = await singlePing(pingUrl, 'cors', 2500, phaseController.signal);
      if (rtt !== null) {
        latestLoadedPing = Number(rtt.toFixed(1));
        loadedLatencySamples.push(rtt);
      }
      await new Promise((r) => setTimeout(r, 420));
    }
  })();

  const stopTimer = setTimeout(() => {
    phaseController.abort();
  }, testDurationMs);

  const worker = async (workerIdx: number) => {
    let stage = workerIdx % 2;
    while (!phaseController.signal.aborted && performance.now() - startTime < testDurationMs) {
      const targetBytes = chunkSizes[Math.min(stage, chunkSizes.length - 1)];
      stage++;
      try {
        const res = await fetch(appendCacheBuster(downUrl(targetBytes)), {
          cache: 'no-store',
          signal: phaseController.signal,
        });
        if (!res.ok || !res.body) break;
        const reader = res.body.getReader();
        while (!phaseController.signal.aborted) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) totalBytes += value.byteLength;
        }
      } catch {
        break;
      }
    }
  };

  await Promise.all(Array.from({ length: concurrency }, (_, i) => worker(i)));

  pingActive = false;
  clearTimeout(stopTimer);
  clearInterval(samplerInterval);
  signal.removeEventListener('abort', onParentAbort);
  await pingLoop.catch(() => undefined);

  // Sustained speed from steady-state samples after TCP slow-start warmup
  const steadySamples = samples.filter((s) => s.t >= warmupWindowMs && s.mbps > 0);
  let sustainedMbps = 0;
  if (steadySamples.length >= 3) {
    const sorted = steadySamples.map((s) => s.mbps).sort((a, b) => a - b);
    // Trim bottom 20% slow-start outliers and top 10% burst spikes
    const startIdx = Math.floor(sorted.length * 0.2);
    const endIdx = Math.max(startIdx + 1, Math.ceil(sorted.length * 0.9));
    const slice = sorted.slice(startIdx, endIdx);
    sustainedMbps = Number((slice.reduce((a, b) => a + b, 0) / slice.length).toFixed(2));
  } else {
    const totalSec = Math.max(0.2, (performance.now() - startTime) / 1000);
    sustainedMbps = Number(((totalBytes * 8) / (totalSec * 1_000_000)).toFixed(2));
  }

  return {
    sustainedMbps,
    peakMbps: Number(Math.max(peakMbps, sustainedMbps).toFixed(2)),
    samples,
    loadedLatencySamples,
  };
}

function buildRandomUploadPayload(byteLength: number): Uint8Array {
  const buf = new Uint8Array(byteLength);
  const cryptoChunk = 65536;
  for (let offset = 0; offset < byteLength; offset += cryptoChunk) {
    const len = Math.min(cryptoChunk, byteLength - offset);
    crypto.getRandomValues(buf.subarray(offset, offset + len));
  }
  return buf;
}

export async function runUploadBenchmark(
  engine: TestEngine,
  signal: AbortSignal,
  onProgress: (info: {
    currentMbps: number;
    peakMbps: number;
    sample: ThroughputSample;
    loadedLatencyMs: number | null;
  }) => void
): Promise<{
  sustainedMbps: number;
  peakMbps: number;
  samples: ThroughputSample[];
  loadedLatencySamples: number[];
}> {
  let { upUrl, pingUrl } = getEngineEndpoints(engine);

  // Verify upload endpoint accepts CORS POST; otherwise use /api/speed/up
  if (engine === 'cloudflare') {
    try {
      const probeCtrl = new AbortController();
      const probeTimer = setTimeout(() => probeCtrl.abort(), 2500);
      const probeRes = await fetch(appendCacheBuster(upUrl), {
        method: 'POST',
        body: new Uint8Array(1024),
        signal: probeCtrl.signal,
      });
      clearTimeout(probeTimer);
      if (!probeRes.ok) {
        upUrl = '/api/speed/up';
        pingUrl = '/api/speed/ping';
      }
    } catch {
      upUrl = '/api/speed/up';
      pingUrl = '/api/speed/ping';
    }
  }

  const testDurationMs = 7500;
  const warmupWindowMs = 1000;
  const concurrency = 3;
  const payloadSizes = [1_500_000, 3_000_000, 5_000_000];
  const prebuiltPayloads = payloadSizes.map((sz) => buildRandomUploadPayload(sz));

  const phaseController = new AbortController();
  const onParentAbort = () => phaseController.abort();
  signal.addEventListener('abort', onParentAbort, { once: true });

  const startTime = performance.now();
  const workerBytes = new Array(concurrency).fill(0);
  let lastSnapshotBytes = 0;
  let lastSnapshotTime = startTime;
  let peakMbps = 0;
  let latestLoadedPing: number | null = null;
  const samples: ThroughputSample[] = [];
  const loadedLatencySamples: number[] = [];

  const getTotalBytes = () => workerBytes.reduce((a, b) => a + b, 0);

  const samplerInterval = setInterval(() => {
    const now = performance.now();
    const dtSec = (now - lastSnapshotTime) / 1000;
    if (dtSec <= 0.05) return;

    const currentTotal = getTotalBytes();
    const deltaBytes = Math.max(0, currentTotal - lastSnapshotBytes);
    const instMbps = Number(((deltaBytes * 8) / (dtSec * 1_000_000)).toFixed(2));

    lastSnapshotBytes = currentTotal;
    lastSnapshotTime = now;

    if (instMbps > peakMbps) peakMbps = instMbps;

    const sample: ThroughputSample = {
      t: Math.round(now - startTime),
      mbps: instMbps,
      phase: 'upload',
    };
    samples.push(sample);

    onProgress({
      currentMbps: instMbps,
      peakMbps: Number(Math.max(peakMbps, instMbps).toFixed(2)),
      sample,
      loadedLatencyMs: latestLoadedPing,
    });
  }, 180);

  let pingActive = true;
  const pingLoop = (async () => {
    while (pingActive && !phaseController.signal.aborted) {
      const rtt = await singlePing(pingUrl, 'cors', 2500, phaseController.signal);
      if (rtt !== null) {
        latestLoadedPing = Number(rtt.toFixed(1));
        loadedLatencySamples.push(rtt);
      }
      await new Promise((r) => setTimeout(r, 420));
    }
  })();

  const stopTimer = setTimeout(() => {
    phaseController.abort();
  }, testDurationMs);

  const sendXhr = (workerIdx: number, payload: Uint8Array): Promise<void> =>
    new Promise((resolve) => {
      if (phaseController.signal.aborted) {
        resolve();
        return;
      }
      const xhr = new XMLHttpRequest();
      const baseBytes = workerBytes[workerIdx];
      let lastLoaded = 0;

      const abortHandler = () => {
        try {
          xhr.abort();
        } catch {
          // ignore
        }
        resolve();
      };
      phaseController.signal.addEventListener('abort', abortHandler, { once: true });

      xhr.open('POST', appendCacheBuster(upUrl), true);
      xhr.setRequestHeader('Content-Type', 'application/octet-stream');

      xhr.upload.onprogress = (ev) => {
        if (ev.loaded > lastLoaded) {
          lastLoaded = ev.loaded;
          workerBytes[workerIdx] = baseBytes + lastLoaded;
        }
      };

      xhr.onload = () => {
        phaseController.signal.removeEventListener('abort', abortHandler);
        workerBytes[workerIdx] = baseBytes + payload.byteLength;
        resolve();
      };

      xhr.onerror = () => {
        phaseController.signal.removeEventListener('abort', abortHandler);
        resolve();
      };

      xhr.onabort = () => {
        phaseController.signal.removeEventListener('abort', abortHandler);
        resolve();
      };

      xhr.send(new Blob([payload.buffer as ArrayBuffer]));
    });

  const worker = async (workerIdx: number) => {
    let stage = 0;
    while (!phaseController.signal.aborted && performance.now() - startTime < testDurationMs) {
      const payload = prebuiltPayloads[Math.min(stage, prebuiltPayloads.length - 1)];
      stage++;
      await sendXhr(workerIdx, payload);
    }
  };

  await Promise.all(Array.from({ length: concurrency }, (_, i) => worker(i)));

  pingActive = false;
  clearTimeout(stopTimer);
  clearInterval(samplerInterval);
  signal.removeEventListener('abort', onParentAbort);
  await pingLoop.catch(() => undefined);

  const steadySamples = samples.filter((s) => s.t >= warmupWindowMs && s.mbps > 0);
  let sustainedMbps = 0;
  if (steadySamples.length >= 3) {
    const sorted = steadySamples.map((s) => s.mbps).sort((a, b) => a - b);
    const startIdx = Math.floor(sorted.length * 0.2);
    const endIdx = Math.max(startIdx + 1, Math.ceil(sorted.length * 0.9));
    const slice = sorted.slice(startIdx, endIdx);
    sustainedMbps = Number((slice.reduce((a, b) => a + b, 0) / slice.length).toFixed(2));
  } else {
    const totalSec = Math.max(0.2, (performance.now() - startTime) / 1000);
    sustainedMbps = Number(((getTotalBytes() * 8) / (totalSec * 1_000_000)).toFixed(2));
  }

  return {
    sustainedMbps,
    peakMbps: Number(Math.max(peakMbps, sustainedMbps).toFixed(2)),
    samples,
    loadedLatencySamples,
  };
}

export function buildBufferbloatResult(
  idleMedianMs: number,
  downloadLoadedSamples: number[],
  uploadLoadedSamples: number[]
): BufferbloatResult {
  const dlSorted = [...downloadLoadedSamples].sort((a, b) => a - b);
  const ulSorted = [...uploadLoadedSamples].sort((a, b) => a - b);

  const downloadLoadedMs =
    dlSorted.length > 0 ? Number(percentile(dlSorted, 0.5).toFixed(1)) : null;
  const uploadLoadedMs =
    ulSorted.length > 0 ? Number(percentile(ulSorted, 0.5).toFixed(1)) : null;

  const downloadDeltaMs =
    downloadLoadedMs !== null
      ? Number(Math.max(0, downloadLoadedMs - idleMedianMs).toFixed(1))
      : null;
  const uploadDeltaMs =
    uploadLoadedMs !== null
      ? Number(Math.max(0, uploadLoadedMs - idleMedianMs).toFixed(1))
      : null;

  return {
    idleMedianMs: Number(idleMedianMs.toFixed(1)),
    downloadLoadedMs,
    uploadLoadedMs,
    downloadDeltaMs,
    uploadDeltaMs,
    grade: computeBufferbloatGrade(downloadDeltaMs, uploadDeltaMs),
  };
}

function classifyBdixVerdict(
  avgMs: number | null,
  countryCode: string | null
): BdixPeeringVerdict {
  if (avgMs === null) return 'unreachable';
  if (avgMs <= 28) return 'local-peered';
  if (countryCode === 'BD' && avgMs > 28) return 'hairpin-transit';
  if (avgMs <= 75) return 'hairpin-transit';
  return 'cross-region';
}

export async function runBdixBandwidthTest(
  targets: BdixNodeTarget[],
  signal: AbortSignal,
  onProgress: (info: { currentMbps: number; peakMbps: number }) => void
): Promise<{ sustainedMbps: number | null; peakMbps: number | null }> {
  const corsTargets = targets.filter((t) => t.supportsCorsThroughput || t.isCustom);
  if (corsTargets.length === 0) {
    return { sustainedMbps: null, peakMbps: null };
  }

  // Verify at least one BDIX endpoint allows CORS streaming
  const activeUrls: string[] = [];
  for (const t of corsTargets) {
    if (signal.aborted) break;
    try {
      const ctrl = new AbortController();
      const onParentAbort = () => ctrl.abort();
      signal.addEventListener('abort', onParentAbort, { once: true });
      const timer = setTimeout(() => ctrl.abort(), 3200);
      const res = await fetch(appendCacheBuster(t.url), {
        mode: 'cors',
        cache: 'no-store',
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      signal.removeEventListener('abort', onParentAbort);
      if (res.ok) {
        await res.arrayBuffer().catch(() => undefined);
        activeUrls.push(t.url);
      }
    } catch {
      // Skip non-CORS or unreachable URL
    }
  }

  if (activeUrls.length === 0) {
    return { sustainedMbps: null, peakMbps: null };
  }

  const testDurationMs = 4500;
  const concurrency = 4;
  const phaseController = new AbortController();
  const onParentAbort = () => phaseController.abort();
  signal.addEventListener('abort', onParentAbort, { once: true });

  const startTime = performance.now();
  let totalBytes = 0;
  let lastBytes = 0;
  let lastTime = startTime;
  let peakMbps = 0;
  const instSamples: number[] = [];

  const sampler = setInterval(() => {
    const now = performance.now();
    const dt = (now - lastTime) / 1000;
    if (dt <= 0.05) return;
    const delta = totalBytes - lastBytes;
    const mbps = Number(((delta * 8) / (dt * 1_000_000)).toFixed(2));
    lastBytes = totalBytes;
    lastTime = now;
    if (mbps > peakMbps) peakMbps = mbps;
    if (now - startTime >= 500 && mbps > 0) {
      instSamples.push(mbps);
    }
    onProgress({
      currentMbps: mbps,
      peakMbps: Number(peakMbps.toFixed(2)),
    });
  }, 180);

  const stopTimer = setTimeout(() => phaseController.abort(), testDurationMs);

  const worker = async (idx: number) => {
    let urlIdx = idx % activeUrls.length;
    while (!phaseController.signal.aborted && performance.now() - startTime < testDurationMs) {
      const targetUrl = activeUrls[urlIdx % activeUrls.length];
      urlIdx++;
      try {
        const res = await fetch(appendCacheBuster(targetUrl), {
          mode: 'cors',
          cache: 'no-store',
          signal: phaseController.signal,
        });
        if (!res.ok || !res.body) break;
        const reader = res.body.getReader();
        while (!phaseController.signal.aborted) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) totalBytes += value.byteLength;
        }
      } catch {
        break;
      }
    }
  };

  await Promise.all(Array.from({ length: concurrency }, (_, i) => worker(i)));

  clearTimeout(stopTimer);
  clearInterval(sampler);
  signal.removeEventListener('abort', onParentAbort);

  if (totalBytes < 10_000) {
    return { sustainedMbps: null, peakMbps: null };
  }

  let sustainedMbps = 0;
  if (instSamples.length >= 3) {
    const sorted = [...instSamples].sort((a, b) => a - b);
    const startIdx = Math.floor(sorted.length * 0.2);
    const endIdx = Math.max(startIdx + 1, Math.ceil(sorted.length * 0.9));
    const slice = sorted.slice(startIdx, endIdx);
    sustainedMbps = Number((slice.reduce((a, b) => a + b, 0) / slice.length).toFixed(2));
  } else {
    const sec = Math.max(0.2, (performance.now() - startTime) / 1000);
    sustainedMbps = Number(((totalBytes * 8) / (sec * 1_000_000)).toFixed(2));
  }

  return {
    sustainedMbps,
    peakMbps: Number(Math.max(peakMbps, sustainedMbps).toFixed(2)),
  };
}

export async function probeBdixNodes(
  targets: BdixNodeTarget[],
  countryCode: string | null,
  signal: AbortSignal,
  onUpdate: (node: BdixNodeResult) => void
): Promise<BdixNodeResult[]> {
  const results: BdixNodeResult[] = [];

  for (const target of targets) {
    if (signal.aborted) break;

    onUpdate({
      ...target,
      status: 'testing',
      minMs: null,
      avgMs: null,
      p95Ms: null,
      jitterMs: null,
      samples: [],
      throughputMbps: null,
      peeringVerdict: 'pending',
    });

    // If CORS-capable (e.g. Link3 or custom BDIX mirror), measure per-node BDIX throughput
    let throughputMbps: number | null = null;
    if (target.isCustom || target.supportsCorsThroughput) {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 5000);
        const dlStart = performance.now();
        const res = await fetch(appendCacheBuster(target.url), {
          mode: 'cors',
          cache: 'no-store',
          signal: ctrl.signal,
        });
        if (res.ok && res.body) {
          const reader = res.body.getReader();
          let bytes = 0;
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) bytes += value.byteLength;
            if (bytes >= 8_000_000) {
              ctrl.abort();
              break;
            }
          }
          const sec = Math.max(0.03, (performance.now() - dlStart) / 1000);
          if (bytes > 50_000) {
            throughputMbps = Number(((bytes * 8) / (sec * 1_000_000)).toFixed(2));
          }
        }
        clearTimeout(timer);
      } catch {
        // Fallback to no-cors RTT probing below
      }
    }

    // 1 warm-up DNS/TLS sample + 4 steady-state RTT samples
    await singlePing(target.url, 'no-cors', 3200, signal);
    const samples: number[] = [];
    for (let s = 0; s < 4; s++) {
      if (signal.aborted) break;
      const rtt = await singlePing(target.url, 'no-cors', 3200, signal);
      if (rtt !== null) {
        samples.push(Number(rtt.toFixed(1)));
      }
      await new Promise((r) => setTimeout(r, 60));
    }

    let result: BdixNodeResult;
    if (samples.length === 0) {
      result = {
        ...target,
        status: 'unreachable',
        minMs: null,
        avgMs: null,
        p95Ms: null,
        jitterMs: null,
        samples: [],
        throughputMbps,
        peeringVerdict: 'unreachable',
        errorNote: 'Timeout or ISP-walled BDIX route',
      };
    } else {
      const sorted = [...samples].sort((a, b) => a - b);
      const avgMs = Number((samples.reduce((a, b) => a + b, 0) / samples.length).toFixed(1));
      const minMs = Number(sorted[0].toFixed(1));
      const p95Ms = Number(percentile(sorted, 0.95).toFixed(1));
      const jitterMs = calculateJitter(samples);
      result = {
        ...target,
        status: 'ok',
        minMs,
        avgMs,
        p95Ms,
        jitterMs,
        samples,
        throughputMbps,
        peeringVerdict: classifyBdixVerdict(avgMs, countryCode),
      };
    }

    results.push(result);
    onUpdate(result);
  }

  return results;
}

export async function probeCdnNodes(
  targets: CdnNodeTarget[],
  signal: AbortSignal,
  onUpdate: (node: CdnNodeResult) => void,
  onLiveMbps?: (mbps: number) => void
): Promise<CdnNodeResult[]> {
  const results: CdnNodeResult[] = [];

  for (const target of targets) {
    if (signal.aborted) break;

    onUpdate({
      ...target,
      status: 'testing',
      rttMs: null,
      jitterMs: null,
      throughputMbps: null,
      popHint: null,
      samples: [],
    });

    // Warm-up + 3 RTT samples
    await singlePing(target.pingUrl, 'cors', 3000, signal);
    const rttSamples: number[] = [];
    for (let i = 0; i < 3; i++) {
      if (signal.aborted) break;
      const rtt = await singlePing(target.pingUrl, 'cors', 3000, signal);
      if (rtt !== null) rttSamples.push(Number(rtt.toFixed(1)));
      await new Promise((r) => setTimeout(r, 40));
    }

    // Payload fetch for real CDN edge throughput
    let throughputMbps: number | null = null;
    let popHint: string | null = null;
    let status: CdnNodeResult['status'] = 'error';

    try {
      const ctrl = new AbortController();
      const onParentAbort = () => ctrl.abort();
      signal.addEventListener('abort', onParentAbort, { once: true });
      const timer = setTimeout(() => ctrl.abort(), 8000);

      const start = performance.now();
      const res = await fetch(appendCacheBuster(target.probeUrl), {
        mode: 'cors',
        cache: 'no-store',
        signal: ctrl.signal,
      });

      if (res.ok && res.body) {
        const cfRay = res.headers.get('cf-ray');
        const servedBy = res.headers.get('x-served-by');
        if (cfRay && cfRay.includes('-')) {
          popHint = cfRay.split('-').pop() || null;
        } else if (servedBy) {
          popHint = servedBy.split('-').pop()?.slice(0, 6) || null;
        }

        const reader = res.body.getReader();
        let bytes = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            bytes += value.byteLength;
            const dt = (performance.now() - start) / 1000;
            if (dt > 0.05 && onLiveMbps) {
              onLiveMbps(Number(((bytes * 8) / (dt * 1_000_000)).toFixed(2)));
            }
          }
        }
        const elapsedSec = Math.max(0.02, (performance.now() - start) / 1000);
        const actualBytes = bytes > 0 ? bytes : target.expectedBytes;
        throughputMbps = Number(((actualBytes * 8) / (elapsedSec * 1_000_000)).toFixed(2));
        if (onLiveMbps) onLiveMbps(throughputMbps);
        status = 'ok';
      } else {
        status = 'error';
      }

      clearTimeout(timer);
      signal.removeEventListener('abort', onParentAbort);
    } catch {
      status = rttSamples.length > 0 ? 'timeout' : 'error';
    }

    const medianRtt =
      rttSamples.length > 0
        ? Number(percentile([...rttSamples].sort((a, b) => a - b), 0.5).toFixed(1))
        : null;

    const result: CdnNodeResult = {
      ...target,
      status,
      rttMs: medianRtt,
      jitterMs: rttSamples.length >= 2 ? calculateJitter(rttSamples) : null,
      throughputMbps,
      popHint,
      samples: rttSamples,
    };

    results.push(result);
    onUpdate(result);
  }

  return results;
}
