import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';
import type {
  BufferbloatResult,
  DiagnosticAnalysis,
  LatencyStats,
  ReadinessStatus,
} from '../types/network';

interface AnalysisPanelProps {
  latency: LatencyStats | null;
  bufferbloat: BufferbloatResult | null;
  analysis: DiagnosticAnalysis | null;
}

const READINESS_META: Record<
  ReadinessStatus,
  { label: string; colorClass: string; Icon: typeof CheckCircle2 }
> = {
  optimal: {
    label: 'Optimal',
    colorClass: 'text-emerald-700 dark:text-emerald-400',
    Icon: CheckCircle2,
  },
  good: {
    label: 'Good',
    colorClass: 'text-blue-700 dark:text-blue-400',
    Icon: CheckCircle2,
  },
  marginal: {
    label: 'Marginal',
    colorClass: 'text-amber-700 dark:text-amber-400',
    Icon: AlertTriangle,
  },
  poor: {
    label: 'Constrained',
    colorClass: 'text-rose-700 dark:text-rose-400',
    Icon: XCircle,
  },
};

export function AnalysisPanel({
  latency,
  bufferbloat,
  analysis,
}: AnalysisPanelProps) {
  return (
    <section
      id="analysis"
      className="scroll-mt-20 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-6 transition-colors duration-200"
    >
      <div className="flex flex-wrap items-start justify-between gap-4 pb-5 border-b border-slate-200 dark:border-slate-800">
        <div>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            Detailed Latency, Bufferbloat &amp; Route Analysis
          </h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400 max-w-3xl">
            {analysis
              ? analysis.summary
              : 'Run a diagnostic suite to inspect latency percentiles, queue delay under load, workload readiness, and peering bottlenecks.'}
          </p>
        </div>

        {analysis && (
          <div className="text-right">
            <div className="text-xs text-slate-500 dark:text-slate-400">Primary Bottleneck</div>
            <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              {analysis.bottleneck}
            </div>
          </div>
        )}
      </div>

      {/* Latency Percentiles + Bufferbloat Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="border border-slate-200 dark:border-slate-800 rounded-lg p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Idle Latency Distribution
            </h3>
            <span className="text-xs font-mono text-slate-500 dark:text-slate-400 tabular-nums">
              {latency ? `${latency.samples.length} valid probes` : 'No samples'}
            </span>
          </div>

          <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
            {[
              { label: 'Min', value: latency ? `${latency.min.toFixed(1)} ms` : '—' },
              { label: 'Median', value: latency ? `${latency.median.toFixed(1)} ms` : '—' },
              { label: 'Average', value: latency ? `${latency.avg.toFixed(1)} ms` : '—' },
              { label: 'p95', value: latency ? `${latency.p95.toFixed(1)} ms` : '—' },
              { label: 'Jitter', value: latency ? `${latency.jitter.toFixed(1)} ms` : '—' },
              { label: 'Loss', value: latency ? `${latency.lossPct}%` : '—' },
            ].map((item) => (
              <div key={item.label}>
                <div className="text-xs text-slate-500 dark:text-slate-400">{item.label}</div>
                <div className="mt-1 font-mono text-sm font-semibold text-slate-900 dark:text-slate-100 tabular-nums">
                  {item.value}
                </div>
              </div>
            ))}
          </div>

          {/* Mini sample distribution bars */}
          {latency && latency.samples.length > 0 && (
            <div className="mt-5 pt-4 border-t border-slate-100 dark:border-slate-800">
              <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400 mb-2">
                <span>Sequential probe RTT variance</span>
                <span className="font-mono tabular-nums">
                  p99: {latency.p99.toFixed(1)} ms
                </span>
              </div>
              <div className="flex items-end gap-1.5 h-10">
                {latency.samples.map((val, idx) => {
                  const maxVal = Math.max(latency.p99 * 1.15, 20);
                  const heightPct = Math.max(12, Math.min(100, (val / maxVal) * 100));
                  return (
                    <div
                      key={idx}
                      title={`Probe #${idx + 1}: ${val.toFixed(1)} ms`}
                      className="flex-1 bg-blue-600/80 dark:bg-blue-500/80 rounded-t-sm"
                      style={{ height: `${heightPct}%` }}
                    />
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div className="border border-slate-200 dark:border-slate-800 rounded-lg p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Bufferbloat (Loaded Latency)
            </h3>
            <span className="font-mono text-sm font-bold text-slate-900 dark:text-slate-100 tabular-nums">
              {bufferbloat ? `Grade ${bufferbloat.grade}` : 'Not measured'}
            </span>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <div className="text-xs text-slate-500 dark:text-slate-400">Idle Baseline</div>
              <div className="mt-1 font-mono text-base font-semibold text-slate-900 dark:text-slate-100 tabular-nums">
                {bufferbloat ? `${bufferbloat.idleMedianMs.toFixed(1)} ms` : '—'}
              </div>
            </div>

            <div>
              <div className="text-xs text-slate-500 dark:text-slate-400">Under Download</div>
              <div className="mt-1 font-mono text-base font-semibold text-slate-900 dark:text-slate-100 tabular-nums">
                {bufferbloat?.downloadLoadedMs !== null && bufferbloat?.downloadLoadedMs !== undefined
                  ? `${bufferbloat.downloadLoadedMs.toFixed(1)} ms`
                  : '—'}
              </div>
              <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400 tabular-nums">
                {bufferbloat?.downloadDeltaMs !== null && bufferbloat?.downloadDeltaMs !== undefined
                  ? `+${bufferbloat.downloadDeltaMs.toFixed(1)} ms delta`
                  : 'Pending'}
              </div>
            </div>

            <div>
              <div className="text-xs text-slate-500 dark:text-slate-400">Under Upload</div>
              <div className="mt-1 font-mono text-base font-semibold text-slate-900 dark:text-slate-100 tabular-nums">
                {bufferbloat?.uploadLoadedMs !== null && bufferbloat?.uploadLoadedMs !== undefined
                  ? `${bufferbloat.uploadLoadedMs.toFixed(1)} ms`
                  : '—'}
              </div>
              <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400 tabular-nums">
                {bufferbloat?.uploadDeltaMs !== null && bufferbloat?.uploadDeltaMs !== undefined
                  ? `+${bufferbloat.uploadDeltaMs.toFixed(1)} ms delta`
                  : 'Pending'}
              </div>
            </div>
          </div>

          <p className="mt-5 pt-4 border-t border-slate-100 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
            Bufferbloat measures how much interactive ping degrades while your WiFi link is saturated by bulk downloads or uploads. Deltas under 30 ms preserve smooth voice, gaming, and video calls.
          </p>
        </div>
      </div>

      {/* Workload Readiness Matrix */}
      {analysis && analysis.workloads.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-3">
            Workload Readiness Assessment
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {analysis.workloads.map((w) => {
              const meta = READINESS_META[w.status];
              const StatusIcon = meta.Icon;
              return (
                <div
                  key={w.id}
                  className="border border-slate-200 dark:border-slate-800 rounded-lg p-4 flex flex-col justify-between"
                >
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                        {w.label}
                      </span>
                      <span
                        className={`inline-flex items-center gap-1 text-xs font-medium whitespace-nowrap ${meta.colorClass}`}
                      >
                        <StatusIcon className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                        {meta.label}
                      </span>
                    </div>
                    <div className="mt-1 text-xs font-mono text-slate-600 dark:text-slate-300 tabular-nums">
                      {w.measuredSummary}
                    </div>
                    <p className="mt-2 text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                      {w.detail}
                    </p>
                  </div>
                  <div className="mt-3 pt-2 border-t border-slate-100 dark:border-slate-800 text-[11px] text-slate-400 dark:text-slate-500">
                    Target threshold: {w.requirement}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Actionable Diagnostic Findings */}
      {analysis && analysis.findings.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-3">
            Engineering Findings &amp; Recommendations
          </h3>
          <div className="divide-y divide-slate-200 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-lg">
            {analysis.findings.map((finding) => {
              const Icon =
                finding.severity === 'healthy'
                  ? CheckCircle2
                  : finding.severity === 'warning'
                    ? AlertTriangle
                    : finding.severity === 'critical'
                      ? XCircle
                      : Info;
              const iconColor =
                finding.severity === 'healthy'
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : finding.severity === 'warning'
                    ? 'text-amber-600 dark:text-amber-400'
                    : finding.severity === 'critical'
                      ? 'text-rose-600 dark:text-rose-400'
                      : 'text-blue-600 dark:text-blue-400';

              return (
                <div key={finding.id} className="p-4 flex flex-col md:flex-row md:items-start gap-4">
                  <div className="flex items-start gap-2.5 md:w-1/3 shrink-0">
                    <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${iconColor}`} aria-hidden="true" />
                    <div>
                      <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                        {finding.title}
                      </div>
                      <div className="mt-0.5 text-xs font-mono text-slate-500 dark:text-slate-400 tabular-nums">
                        {finding.metric}
                      </div>
                    </div>
                  </div>
                  <div className="md:w-2/3 text-xs text-slate-600 dark:text-slate-300 space-y-1.5 leading-relaxed">
                    <p>{finding.explanation}</p>
                    <p className="text-slate-800 dark:text-slate-200 font-medium">
                      Recommendation: {finding.recommendation}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
