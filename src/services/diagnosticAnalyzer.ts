import type {
  DiagnosticAnalysis,
  DiagnosticFinding,
  ReadinessStatus,
  SpeedTestRun,
  WorkloadReadiness,
} from '../types/network';

export function buildDiagnosticAnalysis(run: SpeedTestRun): DiagnosticAnalysis {
  const dl = run.downloadMbps;
  const ul = run.uploadMbps;
  const lat = run.latency;
  const bloat = run.bufferbloat;
  const countryCode = run.context?.countryCode ?? null;

  const okBdix = run.bdixNodes.filter((n) => n.status === 'ok' && n.avgMs !== null);
  const bdixAvgs = okBdix.map((n) => n.avgMs as number).sort((a, b) => a - b);
  const bdixMedian =
    bdixAvgs.length > 0 ? bdixAvgs[Math.floor(bdixAvgs.length / 2)] : null;

  const okCdns = run.cdnNodes.filter((n) => n.status === 'ok' && n.throughputMbps !== null);
  const cdnThroughputs = okCdns.map((n) => n.throughputMbps as number);
  const cdnRtts = okCdns
    .map((n) => n.rttMs)
    .filter((v): v is number => v !== null)
    .sort((a, b) => a - b);
  const fastestCdn = cdnThroughputs.length > 0 ? Math.max(...cdnThroughputs) : null;
  const medianCdnRtt =
    cdnRtts.length > 0 ? cdnRtts[Math.floor(cdnRtts.length / 2)] : null;

  // Bottleneck classification
  let bottleneck = 'Balanced Link';
  if (dl !== null && ul !== null) {
    if (bloat && (bloat.grade === 'D' || bloat.grade === 'F')) {
      bottleneck = 'Severe Queueing / Bufferbloat Under Load';
    } else if (lat && lat.lossPct >= 5) {
      bottleneck = 'Packet Loss / WiFi RF Interference';
    } else if (dl < 15) {
      bottleneck = 'Low Downstream Bandwidth';
    } else if (ul < 5 && dl >= 25) {
      bottleneck = 'Asymmetric Upload Bottleneck';
    } else if (lat && lat.jitter > 15) {
      bottleneck = 'High WiFi Jitter / Channel Contention';
    } else if (bloat && bloat.grade === 'C') {
      bottleneck = 'Moderate Router Bufferbloat';
    }
  } else if (bdixMedian !== null && bdixMedian > 45 && countryCode === 'BD') {
    bottleneck = 'BDIX Domestic Peering Hairpin';
  }

  // BDIX summary
  let bdixSummary = 'BDIX peering nodes have not been probed in this run.';
  if (run.bdixNodes.length > 0) {
    if (okBdix.length === 0) {
      bdixSummary =
        'All BDIX nodes timed out or were unreachable. If you are outside Bangladesh or behind a firewall that blocks domestic IX routes, local BDIX peering is inaccessible.';
    } else if (bdixMedian !== null && bdixMedian <= 28) {
      bdixSummary = `Direct BDIX peering appears active (${okBdix.length}/${run.bdixNodes.length} reachable, median ${bdixMedian.toFixed(1)} ms). Domestic Bangladesh traffic stays local without international transit.`;
    } else if (countryCode === 'BD' && bdixMedian !== null) {
      bdixSummary = `High BDIX latency detected (${bdixMedian.toFixed(1)} ms median from BD). Domestic requests may be hairpinning through Singapore/international transit instead of local Dhaka IX peering.`;
    } else if (bdixMedian !== null) {
      bdixSummary = `${okBdix.length}/${run.bdixNodes.length} Bangladesh IX targets responded with ${bdixMedian.toFixed(1)} ms median RTT, consistent with cross-region routing${countryCode ? ` from ${countryCode}` : ''}.`;
    }
  }

  // CDN summary
  let cdnSummary = 'CDN edge nodes have not been probed in this run.';
  if (run.cdnNodes.length > 0) {
    if (okCdns.length === 0) {
      cdnSummary = 'Unable to complete CORS edge fetches across global CDN nodes.';
    } else {
      const bestNode = [...okCdns].sort(
        (a, b) => (b.throughputMbps ?? 0) - (a.throughputMbps ?? 0)
      )[0];
      cdnSummary = `${okCdns.length}/${run.cdnNodes.length} CDN edges verified. Fastest cache delivery: ${bestNode.provider} at ${bestNode.throughputMbps?.toFixed(1)} Mbps (${bestNode.rttMs?.toFixed(1) ?? '—'} ms RTT${bestNode.popHint ? `, PoP ${bestNode.popHint}` : ''}).`;
    }
  }

  // Workload readiness matrix
  const workloads: WorkloadReadiness[] = [];

  if (dl !== null) {
    const status: ReadinessStatus =
      dl >= 50 && (lat?.lossPct ?? 0) < 2
        ? 'optimal'
        : dl >= 25
          ? 'good'
          : dl >= 10
            ? 'marginal'
            : 'poor';
    workloads.push({
      id: 'uhd-streaming',
      label: '4K UHD Streaming',
      requirement: '≥ 25 Mbps down, < 2% loss',
      measuredSummary: `${dl.toFixed(1)} Mbps down`,
      status,
      detail:
        status === 'optimal' || status === 'good'
          ? 'Sustained throughput comfortably handles multi-stream 4K HDR playback.'
          : 'Throughput may buffer or step down to 1080p during peak WiFi contention.',
    });
  }

  if (lat !== null) {
    const worstDelta = Math.max(
      bloat?.downloadDeltaMs ?? 0,
      bloat?.uploadDeltaMs ?? 0
    );
    const status: ReadinessStatus =
      lat.median <= 35 && lat.jitter <= 8 && worstDelta <= 30
        ? 'optimal'
        : lat.median <= 60 && lat.jitter <= 15 && worstDelta <= 75
          ? 'good'
          : lat.median <= 100
            ? 'marginal'
            : 'poor';
    workloads.push({
      id: 'competitive-gaming',
      label: 'Competitive Gaming',
      requirement: '≤ 35 ms ping, ≤ 8 ms jitter, low bloat',
      measuredSummary: `${lat.median.toFixed(1)} ms · ${lat.jitter.toFixed(1)} ms jitter`,
      status,
      detail:
        status === 'optimal'
          ? 'Low baseline RTT and tight jitter keep frame pacing and hit registration responsive.'
          : worstDelta > 75
            ? `Loaded latency spikes by +${worstDelta.toFixed(0)} ms under traffic; background downloads will cause rubber-banding.`
            : 'Playable latency, though WiFi jitter or distance to edge PoP adds mild variance.',
    });
  }

  if (dl !== null && ul !== null) {
    const ulBloat = bloat?.uploadDeltaMs ?? 0;
    const status: ReadinessStatus =
      dl >= 15 && ul >= 10 && ulBloat <= 40
        ? 'optimal'
        : dl >= 8 && ul >= 4 && ulBloat <= 100
          ? 'good'
          : ul >= 2
            ? 'marginal'
            : 'poor';
    workloads.push({
      id: 'video-calls',
      label: 'HD Video Conferencing',
      requirement: '≥ 10 Mbps up/down, ≤ 40 ms upload bloat',
      measuredSummary: `${ul.toFixed(1)} Mbps up · +${ulBloat.toFixed(0)} ms bloat`,
      status,
      detail:
        status === 'optimal' || status === 'good'
          ? 'Upstream capacity and queue control keep screen sharing and 1080p cameras stable.'
          : 'Upload saturation or queue delay may cause robotic audio or frozen video.',
    });
  }

  if (okCdns.length > 0 && fastestCdn !== null) {
    const status: ReadinessStatus =
      fastestCdn >= 40 && (medianCdnRtt ?? 999) <= 45
        ? 'optimal'
        : fastestCdn >= 15
          ? 'good'
          : fastestCdn >= 5
            ? 'marginal'
            : 'poor';
    workloads.push({
      id: 'cdn-delivery',
      label: 'Cloud & Package Sync',
      requirement: '≥ 40 Mbps CDN edge, ≤ 45 ms edge RTT',
      measuredSummary: `${fastestCdn.toFixed(1)} Mbps peak CDN`,
      status,
      detail:
        status === 'optimal' || status === 'good'
          ? 'Local ISP cache/CDN peering delivers rapid package installs, web assets, and cloud sync.'
          : 'CDN edge throughput is constrained, suggesting suboptimal Anycast routing or link saturation.',
    });
  }

  if (run.bdixNodes.length > 0) {
    const status: ReadinessStatus =
      bdixMedian !== null && bdixMedian <= 25
        ? 'optimal'
        : bdixMedian !== null && bdixMedian <= 60
          ? 'good'
          : bdixMedian !== null
            ? 'marginal'
            : 'poor';
    workloads.push({
      id: 'bdix-peering',
      label: 'BDIX Local Peering',
      requirement: '≤ 25 ms domestic IX RTT',
      measuredSummary:
        bdixMedian !== null ? `${bdixMedian.toFixed(1)} ms median` : 'Unreachable',
      status,
      detail:
        status === 'optimal'
          ? 'Domestic IX peering is crisp and stays within local Bangladesh exchange infrastructure.'
          : status === 'poor'
            ? 'BDIX endpoints could not be reached from this network.'
            : 'BDIX latency exceeds local IX thresholds, indicating cross-region or transit routing.',
    });
  }

  // Detailed Findings & Recommendations
  const findings: DiagnosticFinding[] = [];

  if (bloat) {
    const worstDelta = Math.max(
      bloat.downloadDeltaMs ?? 0,
      bloat.uploadDeltaMs ?? 0
    );
    const severity =
      bloat.grade === 'A+' || bloat.grade === 'A'
        ? 'healthy'
        : bloat.grade === 'B' || bloat.grade === 'C'
          ? 'warning'
          : 'critical';
    findings.push({
      id: 'bufferbloat',
      severity,
      title: `Bufferbloat Grade ${bloat.grade}`,
      metric: `Idle ${bloat.idleMedianMs} ms → Loaded +${worstDelta.toFixed(0)} ms`,
      explanation:
        severity === 'healthy'
          ? 'Your router and ISP queue management prevent latency spikes even while saturating WiFi bandwidth.'
          : 'When throughput saturates your link, packet queues swell in the router or ONT modem, inflating round-trip time.',
      recommendation:
        severity === 'healthy'
          ? 'No QoS adjustments needed; current queue pacing preserves interactive responsiveness.'
          : 'Enable SQM (CAKE or FQ-CoDel) on your router with ingress/egress shaped to ~85–90% of measured WiFi speed.',
    });
  }

  if (lat) {
    const severity =
      lat.jitter <= 8 && lat.lossPct === 0
        ? 'healthy'
        : lat.jitter <= 18 && lat.lossPct < 3
          ? 'warning'
          : 'critical';
    findings.push({
      id: 'wifi-stability',
      severity,
      title: 'WiFi Link Jitter & Loss',
      metric: `Jitter ${lat.jitter.toFixed(1)} ms · p95 ${lat.p95.toFixed(1)} ms · ${lat.lossPct}% loss`,
      explanation:
        severity === 'healthy'
          ? 'Tight p95-to-median spread indicates clean WiFi RF airtime with negligible retransmissions.'
          : 'Elevated latency variance or dropped probes point to 2.4 GHz congestion, distance attenuation, or ISP micro-bursts.',
      recommendation:
        severity === 'healthy'
          ? 'RF link quality is stable across multi-sample bursts.'
          : 'Switch to 5 GHz / 6 GHz WiFi with 80 MHz channel width, avoid overlapping DFS channels, or verify Ethernet baseline.',
    });
  }

  if (dl !== null && ul !== null) {
    const ratio = dl > 0 ? ul / dl : 0;
    const isAsymmetric = ratio < 0.25 && dl > 30;
    findings.push({
      id: 'symmetry',
      severity: isAsymmetric ? 'warning' : 'info',
      title: isAsymmetric ? 'Asymmetric ISP Profile' : 'Throughput Symmetry',
      metric: `${dl.toFixed(1)} Mbps ↓ / ${ul.toFixed(1)} Mbps ↑ (${(ratio * 100).toFixed(0)}% ratio)`,
      explanation: isAsymmetric
        ? 'Upload throughput is less than 25% of download capacity, which can bottleneck cloud backups and multi-party video calls.'
        : 'Downstream and upstream capacities are well balanced for mixed interactive and bulk transfer traffic.',
      recommendation: isAsymmetric
        ? 'Schedule large cloud backups outside call hours or check if your ISP plan caps upstream bandwidth.'
        : 'Link symmetry supports simultaneous downloads, calls, and remote work.',
    });
  }

  if (run.bdixNodes.length > 0) {
    const severity =
      bdixMedian !== null && bdixMedian <= 28
        ? 'healthy'
        : bdixMedian !== null && bdixMedian <= 75
          ? 'warning'
          : 'info';
    findings.push({
      id: 'bdix-peering-finding',
      severity,
      title: 'BDIX Domestic Route Inspection',
      metric:
        bdixMedian !== null
          ? `${okBdix.length}/${run.bdixNodes.length} nodes · ${bdixMedian.toFixed(1)} ms median`
          : `0/${run.bdixNodes.length} reachable`,
      explanation: bdixSummary,
      recommendation:
        severity === 'healthy'
          ? 'Domestic BDIX servers and local ISP caches should deliver full local link speed.'
          : countryCode === 'BD'
            ? 'Ask your ISP to verify BDIX BGP peering and disable VPN/custom DNS proxies that bypass local IX routes.'
            : 'Test from a Bangladesh ISP connection or add an accessible local mirror URL to benchmark domestic BDIX peering.',
    });
  }

  if (okCdns.length > 0) {
    const sortedCdns = [...okCdns].sort(
      (a, b) => (b.throughputMbps ?? 0) - (a.throughputMbps ?? 0)
    );
    const top = sortedCdns[0];
    const bottom = sortedCdns[sortedCdns.length - 1];
    const spreadRatio =
      bottom.throughputMbps && bottom.throughputMbps > 0 && top.throughputMbps
        ? top.throughputMbps / bottom.throughputMbps
        : 1;
    findings.push({
      id: 'cdn-variance',
      severity: spreadRatio > 3 ? 'warning' : 'healthy',
      title: 'CDN Anycast Routing Variance',
      metric: `${top.provider} ${top.throughputMbps?.toFixed(1)} Mbps vs ${bottom.provider} ${bottom.throughputMbps?.toFixed(1)} Mbps`,
      explanation:
        spreadRatio > 3
          ? 'Noticeable performance spread across CDN providers indicates your ISP peers better with certain Anycast networks than others.'
          : 'Consistent throughput across major CDN networks confirms healthy regional transit and DNS Anycast resolution.',
      recommendation:
        spreadRatio > 3
          ? 'Using a local ISP DNS or testing 1.1.1.1 vs 8.8.8.8 with EDNS Client Subnet can improve routing to slower CDNs.'
          : 'CDN edge localization is performing well for web apps, media, and package registries.',
    });
  }

  // Headline & Summary
  let headline = 'Network Diagnostics Complete';
  if (dl !== null && ul !== null && lat !== null) {
    if (dl >= 100 && lat.median <= 30 && (!bloat || bloat.grade === 'A+' || bloat.grade === 'A')) {
      headline = 'High-Throughput, Low-Latency WiFi Link';
    } else if (bloat && (bloat.grade === 'D' || bloat.grade === 'F')) {
      headline = 'Fast Peak Speeds With Severe Bufferbloat';
    } else if (dl >= 40) {
      headline = 'Capable Broadband Link With Targeted Tuning Opportunities';
    } else {
      headline = 'Constrained Link Throughput Detected';
    }
  } else if (run.scope === 'bdix') {
    headline = 'BDIX Domestic Peering Audit Complete';
  } else if (run.scope === 'cdn') {
    headline = 'CDN Edge Matrix Benchmark Complete';
  }

  const parts: string[] = [];
  if (typeof dl === 'number' && typeof ul === 'number') {
    parts.push(`Overall WiFi ${dl.toFixed(1)} Mbps down / ${ul.toFixed(1)} Mbps up`);
  }
  if (typeof run.bdixDownloadMbps === 'number') {
    parts.push(`BDIX ${run.bdixDownloadMbps.toFixed(1)} Mbps (${typeof bdixMedian === 'number' ? `${bdixMedian.toFixed(1)} ms` : 'RTT'})`);
  } else if (typeof bdixMedian === 'number') {
    parts.push(`BDIX median ${bdixMedian.toFixed(1)} ms`);
  }
  if (typeof run.cdnMedianMbps === 'number') {
    parts.push(`CDN ${run.cdnMedianMbps.toFixed(1)} Mbps median`);
  } else if (typeof fastestCdn === 'number') {
    parts.push(`Peak CDN edge ${fastestCdn.toFixed(1)} Mbps`);
  }
  if (lat && typeof lat.median === 'number') {
    parts.push(`${lat.median.toFixed(1)} ms ping`);
  }
  if (bloat) {
    parts.push(`Bufferbloat grade ${bloat.grade}`);
  }

  return {
    headline,
    summary: parts.length > 0 ? `${parts.join(' · ')}.` : 'Diagnostic telemetry captured.',
    bottleneck,
    bdixSummary,
    cdnSummary,
    workloads,
    findings,
  };
}

export function exportRunAsJson(run: SpeedTestRun): void {
  const blob = new Blob([JSON.stringify(run, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `netpulse-diagnostic-${new Date(run.timestamp).toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export function exportRunAsCsv(run: SpeedTestRun): void {
  const rows: string[][] = [
    ['Section', 'Target / Metric', 'Value', 'Unit / Detail'],
    ['Overview', 'Timestamp', new Date(run.timestamp).toISOString(), 'UTC'],
    ['Overview', 'ISP', run.context?.isp ?? 'Unknown', run.context?.asn ?? ''],
    ['Overview', 'IP', run.context?.ip ?? 'Unknown', run.context?.city ?? ''],
    ['Overview', 'Engine', run.engineUsed, run.scope],
    ['Test 1: Overall WiFi', 'Download Sustained', String(run.downloadMbps ?? ''), 'Mbps'],
    ['Test 1: Overall WiFi', 'Download Peak', String(run.peakDownloadMbps ?? ''), 'Mbps'],
    ['Test 1: Overall WiFi', 'Upload Sustained', String(run.uploadMbps ?? ''), 'Mbps'],
    ['Test 1: Overall WiFi', 'Upload Peak', String(run.peakUploadMbps ?? ''), 'Mbps'],
    ['Test 2: BDIX Speed', 'BDIX Download Sustained', String(run.bdixDownloadMbps ?? ''), 'Mbps'],
    ['Test 2: BDIX Speed', 'BDIX Download Peak', String(run.bdixPeakMbps ?? ''), 'Mbps'],
    ['Test 2: BDIX Speed', 'BDIX Median RTT', String(run.bdixMedianRttMs ?? ''), 'ms'],
    ['Test 3: CDN Speed', 'CDN Median Speed', String(run.cdnMedianMbps ?? ''), 'Mbps'],
    ['Test 3: CDN Speed', 'CDN Peak Speed', String(run.cdnPeakMbps ?? ''), 'Mbps'],
    ['Test 3: CDN Speed', 'CDN Median RTT', String(run.cdnMedianRttMs ?? ''), 'ms'],
    ['Latency', 'Idle Median', String(run.latency?.median ?? ''), 'ms'],
    ['Latency', 'Idle p95', String(run.latency?.p95 ?? ''), 'ms'],
    ['Latency', 'Jitter', String(run.latency?.jitter ?? ''), 'ms'],
    ['Latency', 'Packet Loss', String(run.latency?.lossPct ?? ''), '%'],
    ['Bufferbloat', 'Grade', run.bufferbloat?.grade ?? '', ''],
    ['Bufferbloat', 'Download Loaded Delta', String(run.bufferbloat?.downloadDeltaMs ?? ''), 'ms'],
    ['Bufferbloat', 'Upload Loaded Delta', String(run.bufferbloat?.uploadDeltaMs ?? ''), 'ms'],
  ];

  for (const node of run.bdixNodes) {
    rows.push([
      'BDIX Peering',
      node.name,
      node.avgMs !== null ? String(node.avgMs) : 'Unreachable',
      `ms (${node.peeringVerdict})${node.throughputMbps !== null ? ` | ${node.throughputMbps} Mbps` : ''}`,
    ]);
  }

  for (const cdn of run.cdnNodes) {
    rows.push([
      'CDN Edge',
      `${cdn.provider} (${cdn.edgeLabel})`,
      cdn.throughputMbps !== null ? String(cdn.throughputMbps) : 'Error',
      `Mbps | RTT ${cdn.rttMs ?? '—'} ms`,
    ]);
  }

  const csv = rows
    .map((r) => r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `netpulse-diagnostic-${new Date(run.timestamp).toISOString().slice(0, 19).replace(/[:T]/g, '-')}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
