import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MotionConfig } from 'motion/react';
import {
  CheckCircle2,
  Download,
  Loader2,
  Moon,
  Play,
  RefreshCw,
  Square,
  Sun,
} from 'lucide-react';
import { AnalysisPanel } from './components/AnalysisPanel';
import { BdixPeeringPanel } from './components/BdixPeeringPanel';
import { CdnMatrixPanel } from './components/CdnMatrixPanel';
import { HistoryPanel } from './components/HistoryPanel';
import { LiveWaveformChart } from './components/LiveWaveformChart';
import { ThroughputGauge } from './components/ThroughputGauge';
import {
  buildDiagnosticAnalysis,
  exportRunAsCsv,
  exportRunAsJson,
} from './services/diagnosticAnalyzer';
import {
  DEFAULT_BDIX_TARGETS,
  DEFAULT_CDN_TARGETS,
} from './services/networkTargets';
import {
  buildBufferbloatResult,
  detectNetworkContext,
  measureIdleLatency,
  percentile,
  probeBdixNodes,
  probeCdnNodes,
  resolveWorkingEngine,
  runBdixBandwidthTest,
  runDownloadBenchmark,
  runUploadBenchmark,
} from './services/speedEngine';
import type {
  BdixNodeResult,
  BdixNodeTarget,
  BufferbloatResult,
  CdnNodeResult,
  ClientNetworkContext,
  DiagnosticAnalysis,
  LatencyStats,
  SpeedTestRun,
  TestEngine,
  TestPhase,
  TestScope,
  ThroughputSample,
} from './types/network';

const HISTORY_STORAGE_KEY = 'netpulse_diagnostic_history_v1';
const CUSTOM_BDIX_STORAGE_KEY = 'netpulse_custom_bdix_targets_v1';
const THEME_STORAGE_KEY = 'netpulse_theme_v1';

function createInitialBdixResults(targets: BdixNodeTarget[]): BdixNodeResult[] {
  return targets.map((t) => ({
    ...t,
    status: 'pending',
    minMs: null,
    avgMs: null,
    p95Ms: null,
    jitterMs: null,
    samples: [],
    throughputMbps: null,
    peeringVerdict: 'pending',
  }));
}

function createInitialCdnResults(): CdnNodeResult[] {
  return DEFAULT_CDN_TARGETS.map((t) => ({
    ...t,
    status: 'pending',
    rttMs: null,
    jitterMs: null,
    throughputMbps: null,
    popHint: null,
    samples: [],
  }));
}

export default function App() {
  const [darkMode, setDarkMode] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === 'dark') return true;
    if (saved === 'light') return false;
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
  });

  useEffect(() => {
    const root = document.documentElement;
    if (darkMode) {
      root.classList.add('dark');
      localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    } else {
      root.classList.remove('dark');
      localStorage.setItem(THEME_STORAGE_KEY, 'light');
    }
  }, [darkMode]);

  const [customBdixTargets, setCustomBdixTargets] = useState<BdixNodeTarget[]>(() => {
    try {
      const raw = localStorage.getItem(CUSTOM_BDIX_STORAGE_KEY);
      return raw ? (JSON.parse(raw) as BdixNodeTarget[]) : [];
    } catch {
      return [];
    }
  });

  const allBdixTargets = useMemo(
    () => [...DEFAULT_BDIX_TARGETS, ...customBdixTargets],
    [customBdixTargets]
  );

  const [history, setHistory] = useState<SpeedTestRun[]>(() => {
    try {
      const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as Partial<SpeedTestRun>[];
      if (!Array.isArray(parsed)) return [];
      return parsed.map((item) => ({
        id: item.id ?? `run-${Date.now()}`,
        timestamp: item.timestamp ?? Date.now(),
        scope: item.scope ?? 'full',
        engineUsed: item.engineUsed ?? 'cloudflare',
        context: item.context ?? null,
        downloadMbps: item.downloadMbps ?? null,
        peakDownloadMbps: item.peakDownloadMbps ?? null,
        uploadMbps: item.uploadMbps ?? null,
        peakUploadMbps: item.peakUploadMbps ?? null,
        bdixDownloadMbps: item.bdixDownloadMbps ?? null,
        bdixPeakMbps: item.bdixPeakMbps ?? null,
        bdixMedianRttMs: item.bdixMedianRttMs ?? null,
        cdnMedianMbps: item.cdnMedianMbps ?? null,
        cdnPeakMbps: item.cdnPeakMbps ?? null,
        cdnMedianRttMs: item.cdnMedianRttMs ?? null,
        latency: item.latency ?? null,
        bufferbloat: item.bufferbloat ?? null,
        samples: Array.isArray(item.samples) ? item.samples : [],
        bdixNodes: Array.isArray(item.bdixNodes) ? item.bdixNodes : [],
        cdnNodes: Array.isArray(item.cdnNodes) ? item.cdnNodes : [],
        analysis: item.analysis ?? null,
      }));
    } catch {
      return [];
    }
  });

  const [context, setContext] = useState<ClientNetworkContext | null>(null);
  const [contextLoading, setContextLoading] = useState(true);

  const [selectedScope, setSelectedScope] = useState<TestScope>('full');
  const [preferredEngine, setPreferredEngine] = useState<TestEngine>('cloudflare');
  const [activeEngineUsed, setActiveEngineUsed] = useState<TestEngine>('cloudflare');

  const [phase, setPhase] = useState<TestPhase>('idle');
  const [liveMbps, setLiveMbps] = useState(0);
  const [loadedLatencyMs, setLoadedLatencyMs] = useState<number | null>(null);

  // Test 1: Overall WiFi Speed
  const [downloadMbps, setDownloadMbps] = useState<number | null>(null);
  const [peakDownloadMbps, setPeakDownloadMbps] = useState<number | null>(null);
  const [uploadMbps, setUploadMbps] = useState<number | null>(null);
  const [peakUploadMbps, setPeakUploadMbps] = useState<number | null>(null);
  const [latency, setLatency] = useState<LatencyStats | null>(null);
  const [bufferbloat, setBufferbloat] = useState<BufferbloatResult | null>(null);
  const [samples, setSamples] = useState<ThroughputSample[]>([]);

  // Test 2: BDIX Speed
  const [bdixDownloadMbps, setBdixDownloadMbps] = useState<number | null>(null);
  const [bdixPeakMbps, setBdixPeakMbps] = useState<number | null>(null);
  const [bdixMedianRttMs, setBdixMedianRttMs] = useState<number | null>(null);
  const [bdixNodes, setBdixNodes] = useState<BdixNodeResult[]>(() =>
    createInitialBdixResults(allBdixTargets)
  );

  // Test 3: CDN Speed
  const [cdnMedianMbps, setCdnMedianMbps] = useState<number | null>(null);
  const [cdnPeakMbps, setCdnPeakMbps] = useState<number | null>(null);
  const [cdnMedianRttMs, setCdnMedianRttMs] = useState<number | null>(null);
  const [cdnNodes, setCdnNodes] = useState<CdnNodeResult[]>(() =>
    createInitialCdnResults()
  );

  const [analysis, setAnalysis] = useState<DiagnosticAnalysis | null>(null);
  const [activeRun, setActiveRun] = useState<SpeedTestRun | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const isRunning =
    phase === 'latency' ||
    phase === 'download' ||
    phase === 'upload' ||
    phase === 'bdix' ||
    phase === 'cdn';

  const refreshContext = useCallback(async () => {
    setContextLoading(true);
    const detected = await detectNetworkContext();
    setContext(detected);
    setContextLoading(false);
    return detected;
  }, []);

  useEffect(() => {
    void refreshContext();
  }, [refreshContext]);

  const stopTest = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setPhase('cancelled');
    setLiveMbps(0);
  }, []);

  const executeTest = useCallback(
    async (scopeToRun: TestScope) => {
      if (abortRef.current) {
        abortRef.current.abort();
      }
      const controller = new AbortController();
      abortRef.current = controller;

      setErrorMsg(null);
      setSelectedScope(scopeToRun);

      const shouldRunWifi = scopeToRun === 'full' || scopeToRun === 'wifi';
      const shouldRunBdix = scopeToRun === 'full' || scopeToRun === 'bdix';
      const shouldRunCdn = scopeToRun === 'full' || scopeToRun === 'cdn';

      let nextDl = shouldRunWifi ? null : downloadMbps;
      let nextPeakDl = shouldRunWifi ? null : peakDownloadMbps;
      let nextUl = shouldRunWifi ? null : uploadMbps;
      let nextPeakUl = shouldRunWifi ? null : peakUploadMbps;
      let nextLatency = shouldRunWifi ? null : latency;
      let nextBloat = shouldRunWifi ? null : bufferbloat;
      let nextSamples = shouldRunWifi ? [] : samples;

      let nextBdixDl = shouldRunBdix ? null : bdixDownloadMbps;
      let nextBdixPeak = shouldRunBdix ? null : bdixPeakMbps;
      let nextBdixRtt = shouldRunBdix ? null : bdixMedianRttMs;
      let nextBdix = shouldRunBdix
        ? createInitialBdixResults(allBdixTargets)
        : bdixNodes;

      let nextCdnMed = shouldRunCdn ? null : cdnMedianMbps;
      let nextCdnPeak = shouldRunCdn ? null : cdnPeakMbps;
      let nextCdnRtt = shouldRunCdn ? null : cdnMedianRttMs;
      let nextCdn = shouldRunCdn ? createInitialCdnResults() : cdnNodes;

      if (shouldRunWifi) {
        setDownloadMbps(null);
        setPeakDownloadMbps(null);
        setUploadMbps(null);
        setPeakUploadMbps(null);
        setLatency(null);
        setBufferbloat(null);
        setSamples([]);
        setLiveMbps(0);
        setLoadedLatencyMs(null);
      }
      if (shouldRunBdix) {
        setBdixDownloadMbps(null);
        setBdixPeakMbps(null);
        setBdixMedianRttMs(null);
        setBdixNodes(nextBdix);
      }
      if (shouldRunCdn) {
        setCdnMedianMbps(null);
        setCdnPeakMbps(null);
        setCdnMedianRttMs(null);
        setCdnNodes(nextCdn);
      }
      setAnalysis(null);

      try {
        const netCtx = context ?? (await refreshContext());
        if (controller.signal.aborted) return;

        const engine = await resolveWorkingEngine(preferredEngine, controller.signal);
        setActiveEngineUsed(engine);
        if (controller.signal.aborted) return;

        let dlLoadedSamples: number[] = [];
        let ulLoadedSamples: number[] = [];

        // TEST 1: Overall WiFi Speed
        if (shouldRunWifi) {
          setPhase('latency');
          nextLatency = await measureIdleLatency(
            engine,
            controller.signal,
            (partial) => setLatency(partial)
          );
          setLatency(nextLatency);
          if (controller.signal.aborted) return;

          setPhase('download');
          const dlRes = await runDownloadBenchmark(
            engine,
            controller.signal,
            (info) => {
              setLiveMbps(info.currentMbps);
              setPeakDownloadMbps(info.peakMbps);
              setLoadedLatencyMs(info.loadedLatencyMs);
              setSamples((prev) => [...prev, info.sample]);
            }
          );
          if (controller.signal.aborted) return;

          nextDl = dlRes.sustainedMbps;
          nextPeakDl = dlRes.peakMbps;
          dlLoadedSamples = dlRes.loadedLatencySamples;
          nextSamples = [...dlRes.samples];
          setDownloadMbps(nextDl);
          setPeakDownloadMbps(nextPeakDl);
          setLiveMbps(0);

          setPhase('upload');
          const ulRes = await runUploadBenchmark(
            engine,
            controller.signal,
            (info) => {
              setLiveMbps(info.currentMbps);
              setPeakUploadMbps(info.peakMbps);
              setLoadedLatencyMs(info.loadedLatencyMs);
              setSamples((prev) => [...prev, info.sample]);
            }
          );
          if (controller.signal.aborted) return;

          nextUl = ulRes.sustainedMbps;
          nextPeakUl = ulRes.peakMbps;
          ulLoadedSamples = ulRes.loadedLatencySamples;
          nextSamples = [...nextSamples, ...ulRes.samples];
          setUploadMbps(nextUl);
          setPeakUploadMbps(nextPeakUl);
          setLiveMbps(0);

          nextBloat = buildBufferbloatResult(
            nextLatency.median,
            dlLoadedSamples,
            ulLoadedSamples
          );
          setBufferbloat(nextBloat);
        }

        // TEST 2: BDIX Speed (Throughput + Peering RTT)
        if (shouldRunBdix) {
          setPhase('bdix');
          setLiveMbps(0);

          const bdixSpeedRes = await runBdixBandwidthTest(
            allBdixTargets,
            controller.signal,
            (info) => {
              setLiveMbps(info.currentMbps);
              setBdixPeakMbps(info.peakMbps);
            }
          );
          if (controller.signal.aborted) return;

          nextBdixDl = bdixSpeedRes.sustainedMbps;
          nextBdixPeak = bdixSpeedRes.peakMbps;
          setBdixDownloadMbps(nextBdixDl);
          setBdixPeakMbps(nextBdixPeak);
          setLiveMbps(0);

          nextBdix = await probeBdixNodes(
            allBdixTargets,
            netCtx.countryCode,
            controller.signal,
            (updatedNode) => {
              setBdixNodes((prev) =>
                prev.map((n) => (n.id === updatedNode.id ? updatedNode : n))
              );
            }
          );
          if (controller.signal.aborted) return;

          const okRtts = nextBdix
            .filter((n) => n.status === 'ok' && n.avgMs !== null)
            .map((n) => n.avgMs as number)
            .sort((a, b) => a - b);
          nextBdixRtt =
            okRtts.length > 0 ? Number(percentile(okRtts, 0.5).toFixed(1)) : null;
          setBdixMedianRttMs(nextBdixRtt);

          // If multi-stream BDIX burst returned null but an individual node measured CORS throughput, use its best
          if (nextBdixDl === null) {
            const nodeThroughputs = nextBdix
              .map((n) => n.throughputMbps)
              .filter((v): v is number => v !== null);
            if (nodeThroughputs.length > 0) {
              nextBdixDl = Math.max(...nodeThroughputs);
              nextBdixPeak = nextBdixDl;
              setBdixDownloadMbps(nextBdixDl);
              setBdixPeakMbps(nextBdixPeak);
            }
          }
        }

        // TEST 3: CDN Speed (Throughput + Edge RTT)
        if (shouldRunCdn) {
          setPhase('cdn');
          setLiveMbps(0);

          nextCdn = await probeCdnNodes(
            DEFAULT_CDN_TARGETS,
            controller.signal,
            (updatedCdn) => {
              setCdnNodes((prev) =>
                prev.map((c) => (c.id === updatedCdn.id ? updatedCdn : c))
              );
            },
            (mbps) => setLiveMbps(mbps)
          );
          if (controller.signal.aborted) return;

          setLiveMbps(0);

          const cdnSpeeds = nextCdn
            .filter((n) => n.status === 'ok' && n.throughputMbps !== null)
            .map((n) => n.throughputMbps as number)
            .sort((a, b) => a - b);
          const cdnRtts = nextCdn
            .filter((n) => n.status === 'ok' && n.rttMs !== null)
            .map((n) => n.rttMs as number)
            .sort((a, b) => a - b);

          nextCdnMed =
            cdnSpeeds.length > 0
              ? Number(percentile(cdnSpeeds, 0.5).toFixed(2))
              : null;
          nextCdnPeak =
            cdnSpeeds.length > 0 ? Number(Math.max(...cdnSpeeds).toFixed(2)) : null;
          nextCdnRtt =
            cdnRtts.length > 0 ? Number(percentile(cdnRtts, 0.5).toFixed(1)) : null;

          setCdnMedianMbps(nextCdnMed);
          setCdnPeakMbps(nextCdnPeak);
          setCdnMedianRttMs(nextCdnRtt);
        }

        const completedRun: SpeedTestRun = {
          id: `run-${Date.now()}`,
          timestamp: Date.now(),
          scope: scopeToRun,
          engineUsed: engine,
          context: netCtx,
          downloadMbps: nextDl,
          peakDownloadMbps: nextPeakDl,
          uploadMbps: nextUl,
          peakUploadMbps: nextPeakUl,
          bdixDownloadMbps: nextBdixDl,
          bdixPeakMbps: nextBdixPeak,
          bdixMedianRttMs: nextBdixRtt,
          cdnMedianMbps: nextCdnMed,
          cdnPeakMbps: nextCdnPeak,
          cdnMedianRttMs: nextCdnRtt,
          latency: nextLatency,
          bufferbloat: nextBloat,
          samples: nextSamples,
          bdixNodes: nextBdix,
          cdnNodes: nextCdn,
          analysis: null,
        };

        const computedAnalysis = buildDiagnosticAnalysis(completedRun);
        completedRun.analysis = computedAnalysis;

        setAnalysis(computedAnalysis);
        setActiveRun(completedRun);
        setPhase('complete');

        setHistory((prev) => {
          const updated = [completedRun, ...prev].slice(0, 20);
          try {
            localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(updated));
          } catch {
            // ignore storage quota errors
          }
          return updated;
        });
      } catch (err) {
        if (controller.signal.aborted) {
          setPhase('cancelled');
          return;
        }
        setErrorMsg(
          err instanceof Error
            ? err.message
            : 'Network benchmark encountered an unexpected error.'
        );
        setPhase('error');
      } finally {
        abortRef.current = null;
      }
    },
    [
      allBdixTargets,
      bdixDownloadMbps,
      bdixMedianRttMs,
      bdixNodes,
      bdixPeakMbps,
      bufferbloat,
      cdnMedianMbps,
      cdnMedianRttMs,
      cdnNodes,
      cdnPeakMbps,
      context,
      downloadMbps,
      latency,
      peakDownloadMbps,
      peakUploadMbps,
      preferredEngine,
      refreshContext,
      samples,
      uploadMbps,
    ]
  );

  const handleAddCustomBdix = (target: BdixNodeTarget) => {
    const updatedCustom = [...customBdixTargets, target];
    setCustomBdixTargets(updatedCustom);
    try {
      localStorage.setItem(CUSTOM_BDIX_STORAGE_KEY, JSON.stringify(updatedCustom));
    } catch {
      // ignore
    }
    setBdixNodes((prev) => [
      ...prev,
      {
        ...target,
        status: 'pending',
        minMs: null,
        avgMs: null,
        p95Ms: null,
        jitterMs: null,
        samples: [],
        throughputMbps: null,
        peeringVerdict: 'pending',
      },
    ]);
  };

  const handleRemoveCustomBdix = (id: string) => {
    const updatedCustom = customBdixTargets.filter((t) => t.id !== id);
    setCustomBdixTargets(updatedCustom);
    try {
      localStorage.setItem(CUSTOM_BDIX_STORAGE_KEY, JSON.stringify(updatedCustom));
    } catch {
      // ignore
    }
    setBdixNodes((prev) => prev.filter((n) => n.id !== id));
  };

  const handleSelectHistoryRun = (run: SpeedTestRun) => {
    if (isRunning) return;
    setActiveRun(run);
    setSelectedScope(run.scope);
    setActiveEngineUsed(run.engineUsed);
    setDownloadMbps(run.downloadMbps);
    setPeakDownloadMbps(run.peakDownloadMbps);
    setUploadMbps(run.uploadMbps);
    setPeakUploadMbps(run.peakUploadMbps);
    setBdixDownloadMbps(run.bdixDownloadMbps ?? null);
    setBdixPeakMbps(run.bdixPeakMbps ?? null);
    setBdixMedianRttMs(run.bdixMedianRttMs ?? null);
    setCdnMedianMbps(run.cdnMedianMbps ?? null);
    setCdnPeakMbps(run.cdnPeakMbps ?? null);
    setCdnMedianRttMs(run.cdnMedianRttMs ?? null);
    setLatency(run.latency);
    setBufferbloat(run.bufferbloat);
    setSamples(run.samples);
    setBdixNodes(
      run.bdixNodes.length > 0
        ? run.bdixNodes
        : createInitialBdixResults(allBdixTargets)
    );
    setCdnNodes(
      run.cdnNodes.length > 0 ? run.cdnNodes : createInitialCdnResults()
    );
    setAnalysis(run.analysis ?? buildDiagnosticAnalysis(run));
    setPhase('complete');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleClearHistory = () => {
    setHistory([]);
    try {
      localStorage.removeItem(HISTORY_STORAGE_KEY);
    } catch {
      // ignore
    }
  };

  const okBdixCount = bdixNodes.filter((n) => n.status === 'ok').length;
  const okCdnNodes = cdnNodes.filter(
    (n) => n.status === 'ok' && n.throughputMbps !== null
  );
  const fastestCdn =
    okCdnNodes.length > 0
      ? [...okCdnNodes].sort(
          (a, b) => (b.throughputMbps ?? 0) - (a.throughputMbps ?? 0)
        )[0]
      : null;

  const test1Status =
    phase === 'latency' || phase === 'download' || phase === 'upload'
      ? 'running'
      : downloadMbps !== null && uploadMbps !== null
        ? 'done'
        : 'idle';
  const test2Status =
    phase === 'bdix'
      ? 'running'
      : bdixMedianRttMs !== null || bdixDownloadMbps !== null
        ? 'done'
        : 'idle';
  const test3Status =
    phase === 'cdn'
      ? 'running'
      : cdnMedianMbps !== null
        ? 'done'
        : 'idle';

  return (
    <MotionConfig reducedMotion="user">
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 transition-colors duration-200">
      {/* Top Bar Contract: 3 zones separated by gap-8 */}
      <header className="sticky top-0 z-30 bg-white/95 dark:bg-slate-950/95 backdrop-blur border-b border-slate-200 dark:border-slate-800">
        <div className="max-w-[1280px] mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-8">
          <a
            href="#overview"
            className="font-display text-lg font-bold tracking-tight text-slate-900 dark:text-slate-50 whitespace-nowrap shrink-0"
          >
            NetPulse
          </a>

          <nav
            aria-label="Primary"
            className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600 dark:text-slate-400"
          >
            <a
              href="#overview"
              className="hover:text-slate-900 dark:hover:text-slate-100 transition-colors whitespace-nowrap shrink-0"
            >
              Overview
            </a>
            <a
              href="#analysis"
              className="hover:text-slate-900 dark:hover:text-slate-100 transition-colors whitespace-nowrap shrink-0"
            >
              Analysis
            </a>
            <a
              href="#bdix-peering"
              className="hover:text-slate-900 dark:hover:text-slate-100 transition-colors whitespace-nowrap shrink-0"
            >
              BDIX Speed
            </a>
            <a
              href="#cdn-matrix"
              className="hover:text-slate-900 dark:hover:text-slate-100 transition-colors whitespace-nowrap shrink-0"
            >
              CDN Speed
            </a>
            <a
              href="#history"
              className="hover:text-slate-900 dark:hover:text-slate-100 transition-colors whitespace-nowrap shrink-0"
            >
              History
            </a>
          </nav>

          <div className="flex items-center shrink-0">
            {isRunning ? (
              <button
                type="button"
                onClick={stopTest}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg bg-rose-600 text-white hover:bg-rose-700 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Square className="w-3.5 h-3.5 fill-current" aria-hidden="true" />
                Stop Test
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void executeTest('full')}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Play className="w-3.5 h-3.5 fill-current" aria-hidden="true" />
                Run All 3 Tests
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-[1280px] mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* Workspace Control Bar + Network Context */}
        <section
          id="overview"
          className="scroll-mt-20 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-5 transition-colors duration-200"
        >
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-50 text-balance">
                WiFi, BDIX &amp; CDN Speed Test Suite
              </h1>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
                {contextLoading ? (
                  <span>Detecting ISP &amp; client route context...</span>
                ) : (
                  <>
                    <span className="font-medium text-slate-700 dark:text-slate-300">
                      {context?.isp || 'Detected Network'}
                      {context?.asn ? ` (${context.asn})` : ''}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono tabular-nums">
                      {context?.ip || 'Local IP'}
                    </span>
                    {context?.city || context?.countryName ? (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>
                          {[context.city, context.countryName]
                            .filter(Boolean)
                            .join(', ')}
                        </span>
                      </>
                    ) : null}
                    {context?.browserLink?.effectiveType ? (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono tabular-nums">
                          Link {context.browserLink.effectiveType.toUpperCase()}
                          {context.browserLink.downlink
                            ? ` (~${context.browserLink.downlink} Mbps hint)`
                            : ''}
                        </span>
                      </>
                    ) : null}
                  </>
                )}
                <button
                  type="button"
                  onClick={() => void refreshContext()}
                  disabled={contextLoading || isRunning}
                  aria-label="Refresh detected network info"
                  className="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400 hover:underline disabled:opacity-50 cursor-pointer"
                >
                  <RefreshCw
                    className={`w-3 h-3 ${contextLoading ? 'animate-spin' : ''}`}
                    aria-hidden="true"
                  />
                  Refresh
                </button>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {activeRun && (
                <>
                  <button
                    type="button"
                    onClick={() => exportRunAsCsv(activeRun)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" aria-hidden="true" />
                    Export CSV
                  </button>
                  <button
                    type="button"
                    onClick={() => exportRunAsJson(activeRun)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" aria-hidden="true" />
                    Export JSON
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={() => setDarkMode((d) => !d)}
                aria-label={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                {darkMode ? (
                  <>
                    <Sun className="w-3.5 h-3.5" aria-hidden="true" />
                    Light
                  </>
                ) : (
                  <>
                    <Moon className="w-3.5 h-3.5" aria-hidden="true" />
                    Dark
                  </>
                )}
              </button>
            </div>
          </div>

          {/* 3-Test Pipeline Selector & Engine Bar */}
          <div className="pt-4 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                Overall Test Engine
              </span>
              <div className="inline-flex items-center p-1 rounded-lg bg-slate-100 dark:bg-slate-800">
                {(
                  [
                    { id: 'cloudflare', label: 'Cloudflare Edge' },
                    { id: 'app-edge', label: 'App Cloud Edge' },
                  ] as const
                ).map((eng) => (
                  <button
                    key={eng.id}
                    type="button"
                    disabled={isRunning}
                    onClick={() => setPreferredEngine(eng.id)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      preferredEngine === eng.id
                        ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-sm'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                    }`}
                  >
                    {eng.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
              <span>Run mode:</span>
              <span className="font-medium text-slate-700 dark:text-slate-300 capitalize">
                {selectedScope === 'full' ? 'All 3 Tests Sequential' : `${selectedScope} test`}
              </span>
              <span aria-hidden="true">·</span>
              <span>
                Engine: {activeEngineUsed === 'cloudflare' ? 'Cloudflare Edge' : 'App Cloud Edge'}
              </span>
            </div>
          </div>

          {errorMsg && (
            <div className="p-3 rounded-lg border border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/40 text-xs text-rose-700 dark:text-rose-300">
              {errorMsg}
            </div>
          )}

          {/* Hero Split: Gauge + Live Waveform */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
            <div className="lg:col-span-5 border border-slate-200 dark:border-slate-800 rounded-lg p-5">
              <ThroughputGauge
                phase={phase}
                liveMbps={liveMbps}
                downloadMbps={downloadMbps}
                uploadMbps={uploadMbps}
                bdixDownloadMbps={bdixDownloadMbps}
                cdnMedianMbps={cdnMedianMbps}
                loadedLatencyMs={loadedLatencyMs}
                idleLatencyMs={latency?.median ?? null}
              />
            </div>

            <div className="lg:col-span-7 border border-slate-200 dark:border-slate-800 rounded-lg p-5">
              <LiveWaveformChart samples={samples} phase={phase} />
            </div>
          </div>

          {/* Dedicated 3-Test Cards Row: 1. Overall WiFi, 2. BDIX Speed, 3. CDN Speed */}
          <div className="pt-2 grid grid-cols-1 lg:grid-cols-3 gap-5">
            {/* Test 1: Overall WiFi Speed */}
            <div
              className={`border rounded-lg p-5 flex flex-col justify-between transition-[border-color,background-color] duration-200 ${
                test1Status === 'running'
                  ? 'border-blue-500/70 dark:border-blue-500/60 bg-blue-50/30 dark:bg-blue-950/20'
                  : 'border-slate-200 dark:border-slate-800'
              }`}
            >
              <div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    1. Overall WiFi Speed
                  </span>
                  {test1Status === 'running' ? (
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 dark:text-blue-400">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                      Testing
                    </span>
                  ) : test1Status === 'done' ? (
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                      <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                      Complete
                    </span>
                  ) : (
                    <span className="text-xs text-slate-400 dark:text-slate-500">Idle</span>
                  )}
                </div>

                <div className="mt-4 grid grid-cols-2 gap-4">
                  <div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">Download</div>
                    <div className="mt-0.5 font-mono text-2xl font-bold text-slate-900 dark:text-slate-50 tabular-nums">
                      {downloadMbps !== null ? downloadMbps.toFixed(1) : '—'}
                      <span className="ml-1 text-xs font-normal text-slate-500">Mbps</span>
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">Upload</div>
                    <div className="mt-0.5 font-mono text-2xl font-bold text-slate-900 dark:text-slate-50 tabular-nums">
                      {uploadMbps !== null ? uploadMbps.toFixed(1) : '—'}
                      <span className="ml-1 text-xs font-normal text-slate-500">Mbps</span>
                    </div>
                  </div>
                </div>

                <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                  {latency
                    ? `Ping ${latency.median.toFixed(1)} ms · Jitter ${latency.jitter.toFixed(1)} ms${bufferbloat ? ` · Bloat ${bufferbloat.grade}` : ''}`
                    : 'Measures multi-stream WiFi down/up, ping & bufferbloat'}
                </div>
              </div>

              <button
                type="button"
                disabled={isRunning}
                onClick={() => void executeTest('wifi')}
                className="mt-4 w-full px-3 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 transition-colors duration-150 cursor-pointer"
              >
                Run Overall Test
              </button>
            </div>

            {/* Test 2: BDIX Speed */}
            <div
              className={`border rounded-lg p-5 flex flex-col justify-between transition-[border-color,background-color] duration-200 ${
                test2Status === 'running'
                  ? 'border-emerald-500/70 dark:border-emerald-500/60 bg-emerald-50/30 dark:bg-emerald-950/20'
                  : 'border-slate-200 dark:border-slate-800'
              }`}
            >
              <div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    2. BDIX Speed
                  </span>
                  {test2Status === 'running' ? (
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                      Testing
                    </span>
                  ) : test2Status === 'done' ? (
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                      <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                      Complete
                    </span>
                  ) : (
                    <span className="text-xs text-slate-400 dark:text-slate-500">Idle</span>
                  )}
                </div>

                <div className="mt-4 grid grid-cols-2 gap-4">
                  <div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">BDIX Speed</div>
                    <div className="mt-0.5 font-mono text-2xl font-bold text-slate-900 dark:text-slate-50 tabular-nums">
                      {bdixDownloadMbps !== null ? bdixDownloadMbps.toFixed(1) : '—'}
                      <span className="ml-1 text-xs font-normal text-slate-500">Mbps</span>
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">Median RTT</div>
                    <div className="mt-0.5 font-mono text-2xl font-bold text-slate-900 dark:text-slate-50 tabular-nums">
                      {bdixMedianRttMs !== null ? bdixMedianRttMs.toFixed(1) : '—'}
                      <span className="ml-1 text-xs font-normal text-slate-500">ms</span>
                    </div>
                  </div>
                </div>

                <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                  {okBdixCount > 0
                    ? `${okBdixCount}/${bdixNodes.length} BD IX nodes reachable${bdixPeakMbps ? ` · Peak ${bdixPeakMbps.toFixed(1)} Mbps` : ''}`
                    : 'Measures BDIX Link3/mirror speed & Dhaka IX latency'}
                </div>
              </div>

              <button
                type="button"
                disabled={isRunning}
                onClick={() => void executeTest('bdix')}
                className="mt-4 w-full px-3 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 transition-colors duration-150 cursor-pointer"
              >
                Run BDIX Test
              </button>
            </div>

            {/* Test 3: CDN Speed */}
            <div
              className={`border rounded-lg p-5 flex flex-col justify-between transition-[border-color,background-color] duration-200 ${
                test3Status === 'running'
                  ? 'border-indigo-500/70 dark:border-indigo-500/60 bg-indigo-50/30 dark:bg-indigo-950/20'
                  : 'border-slate-200 dark:border-slate-800'
              }`}
            >
              <div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    3. CDN Speed
                  </span>
                  {test3Status === 'running' ? (
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 dark:text-indigo-400">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                      Testing
                    </span>
                  ) : test3Status === 'done' ? (
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                      <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                      Complete
                    </span>
                  ) : (
                    <span className="text-xs text-slate-400 dark:text-slate-500">Idle</span>
                  )}
                </div>

                <div className="mt-4 grid grid-cols-2 gap-4">
                  <div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">CDN Median</div>
                    <div className="mt-0.5 font-mono text-2xl font-bold text-slate-900 dark:text-slate-50 tabular-nums">
                      {cdnMedianMbps !== null ? cdnMedianMbps.toFixed(1) : '—'}
                      <span className="ml-1 text-xs font-normal text-slate-500">Mbps</span>
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">Median RTT</div>
                    <div className="mt-0.5 font-mono text-2xl font-bold text-slate-900 dark:text-slate-50 tabular-nums">
                      {cdnMedianRttMs !== null ? cdnMedianRttMs.toFixed(1) : '—'}
                      <span className="ml-1 text-xs font-normal text-slate-500">ms</span>
                    </div>
                  </div>
                </div>

                <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums truncate">
                  {fastestCdn && fastestCdn.throughputMbps !== null
                    ? `Peak: ${fastestCdn.provider} (${fastestCdn.throughputMbps.toFixed(1)} Mbps${fastestCdn.popHint ? ` · ${fastestCdn.popHint}` : ''})`
                    : 'Benchmarks Cloudflare, jsDelivr, cdnjs, unpkg & Google Edge'}
                </div>
              </div>

              <button
                type="button"
                disabled={isRunning}
                onClick={() => void executeTest('cdn')}
                className="mt-4 w-full px-3 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 transition-colors duration-150 cursor-pointer"
              >
                Run CDN Test
              </button>
            </div>
          </div>
        </section>

        {/* Detailed Analysis */}
        <AnalysisPanel
          latency={latency}
          bufferbloat={bufferbloat}
          analysis={analysis}
        />

        {/* BDIX Peering Matrix */}
        <BdixPeeringPanel
          nodes={bdixNodes}
          customTargets={customBdixTargets}
          isRunning={isRunning}
          onRunBdixOnly={() => void executeTest('bdix')}
          onAddCustomTarget={handleAddCustomBdix}
          onRemoveCustomTarget={handleRemoveCustomBdix}
          countryCode={context?.countryCode ?? null}
        />

        {/* CDN Matrix */}
        <CdnMatrixPanel
          nodes={cdnNodes}
          isRunning={isRunning}
          onRunCdnOnly={() => void executeTest('cdn')}
        />

        {/* Saved Run History */}
        <HistoryPanel
          history={history}
          activeRunId={activeRun?.id ?? null}
          onSelectRun={handleSelectHistoryRun}
          onClearHistory={handleClearHistory}
        />
      </main>

      <footer className="max-w-[1280px] mx-auto px-4 sm:px-6 py-6 border-t border-slate-200 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400 flex flex-wrap items-center justify-between gap-4">
        <span>
          NetPulse · 3-stage browser telemetry: Overall WiFi throughput &amp; bufferbloat, BDIX speed &amp; peering RTT, and multi-CDN edge speed.
        </span>
        <span>
          Results saved locally in your browser.
        </span>
      </footer>
    </div>
    </MotionConfig>
  );
}
