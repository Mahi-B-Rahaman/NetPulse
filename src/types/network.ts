export type TestEngine = 'cloudflare' | 'app-edge';

export type TestPhase =
  | 'idle'
  | 'latency'
  | 'download'
  | 'upload'
  | 'bdix'
  | 'cdn'
  | 'complete'
  | 'cancelled'
  | 'error';

export type TestScope = 'full' | 'wifi' | 'bdix' | 'cdn';

export type BufferbloatGrade = 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';

export interface ThroughputSample {
  t: number; // elapsed ms from phase start
  mbps: number;
  phase: 'download' | 'upload';
}

export interface LatencyStats {
  min: number;
  median: number;
  avg: number;
  p95: number;
  p99: number;
  jitter: number;
  lossPct: number;
  samples: number[];
}

export interface BufferbloatResult {
  idleMedianMs: number;
  downloadLoadedMs: number | null;
  uploadLoadedMs: number | null;
  downloadDeltaMs: number | null;
  uploadDeltaMs: number | null;
  grade: BufferbloatGrade;
}

export type BdixPeeringVerdict =
  | 'pending'
  | 'local-peered'
  | 'hairpin-transit'
  | 'cross-region'
  | 'unreachable';

export interface BdixNodeTarget {
  id: string;
  name: string;
  operator: string;
  url: string;
  region: string;
  isCustom?: boolean;
  supportsCorsThroughput?: boolean;
}

export interface BdixNodeResult extends BdixNodeTarget {
  status: 'pending' | 'testing' | 'ok' | 'timeout' | 'unreachable';
  minMs: number | null;
  avgMs: number | null;
  p95Ms: number | null;
  jitterMs: number | null;
  samples: number[];
  throughputMbps: number | null;
  peeringVerdict: BdixPeeringVerdict;
  errorNote?: string;
}

export interface CdnNodeTarget {
  id: string;
  provider: string;
  edgeLabel: string;
  probeUrl: string;
  pingUrl: string;
  expectedBytes: number;
}

export interface CdnNodeResult extends CdnNodeTarget {
  status: 'pending' | 'testing' | 'ok' | 'timeout' | 'error';
  rttMs: number | null;
  jitterMs: number | null;
  throughputMbps: number | null;
  popHint: string | null;
  samples: number[];
}

export interface BrowserConnectionInfo {
  effectiveType?: string;
  downlink?: number;
  rtt?: number;
  saveData?: boolean;
  type?: string;
}

export interface ClientNetworkContext {
  ip: string | null;
  isp: string | null;
  asn: string | null;
  city: string | null;
  countryCode: string | null;
  countryName: string | null;
  browserLink: BrowserConnectionInfo | null;
  serverRegion: string | null;
  detectedAt: number;
}

export type ReadinessStatus = 'optimal' | 'good' | 'marginal' | 'poor';

export interface WorkloadReadiness {
  id: string;
  label: string;
  requirement: string;
  measuredSummary: string;
  status: ReadinessStatus;
  detail: string;
}

export interface DiagnosticFinding {
  id: string;
  severity: 'healthy' | 'warning' | 'critical' | 'info';
  title: string;
  metric: string;
  explanation: string;
  recommendation: string;
}

export interface DiagnosticAnalysis {
  headline: string;
  summary: string;
  bottleneck: string;
  bdixSummary: string;
  cdnSummary: string;
  workloads: WorkloadReadiness[];
  findings: DiagnosticFinding[];
}

export interface SpeedTestRun {
  id: string;
  timestamp: number;
  scope: TestScope;
  engineUsed: TestEngine;
  context: ClientNetworkContext | null;
  downloadMbps: number | null;
  peakDownloadMbps: number | null;
  uploadMbps: number | null;
  peakUploadMbps: number | null;
  bdixDownloadMbps: number | null;
  bdixPeakMbps: number | null;
  bdixMedianRttMs: number | null;
  cdnMedianMbps: number | null;
  cdnPeakMbps: number | null;
  cdnMedianRttMs: number | null;
  latency: LatencyStats | null;
  bufferbloat: BufferbloatResult | null;
  samples: ThroughputSample[];
  bdixNodes: BdixNodeResult[];
  cdnNodes: CdnNodeResult[];
  analysis: DiagnosticAnalysis | null;
}
