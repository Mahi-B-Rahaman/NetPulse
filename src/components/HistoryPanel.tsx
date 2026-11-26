import { Trash2 } from 'lucide-react';
import type { SpeedTestRun } from '../types/network';

interface HistoryPanelProps {
  history: SpeedTestRun[];
  activeRunId: string | null;
  onSelectRun: (run: SpeedTestRun) => void;
  onClearHistory: () => void;
}

export function HistoryPanel({
  history,
  activeRunId,
  onSelectRun,
  onClearHistory,
}: HistoryPanelProps) {
  return (
    <section
      id="history"
      className="scroll-mt-20 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 transition-colors duration-200"
    >
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
        <div>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            Saved Diagnostic History
          </h2>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
            Stored locally in your browser. Click any previous run to inspect its Overall WiFi, BDIX, and CDN analysis.
          </p>
        </div>

        {history.length > 0 && (
          <button
            type="button"
            onClick={onClearHistory}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
            Clear History
          </button>
        )}
      </div>

      {history.length === 0 ? (
        <div className="py-10 text-center text-sm text-slate-500 dark:text-slate-400">
          No completed benchmark runs saved yet. Run the 3 tests above to start tracking Overall WiFi, BDIX, and CDN trends over time.
        </div>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-xs font-medium text-slate-500 dark:text-slate-400">
                <th className="py-2.5 pr-4">Timestamp</th>
                <th className="py-2.5 px-3">Scope</th>
                <th className="py-2.5 px-3">Network / ISP</th>
                <th className="py-2.5 px-3 text-right">1. Overall ↓/↑</th>
                <th className="py-2.5 px-3 text-right">Ping / Bloat</th>
                <th className="py-2.5 px-3 text-right">2. BDIX Speed</th>
                <th className="py-2.5 pl-3 text-right">3. CDN Speed</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70 text-sm">
              {history.map((run) => {
                const okBdix = (run.bdixNodes ?? [])
                  .filter((n) => n.status === 'ok' && typeof n.avgMs === 'number')
                  .map((n) => n.avgMs as number)
                  .sort((a, b) => a - b);
                const bdixMed =
                  typeof run.bdixMedianRttMs === 'number'
                    ? run.bdixMedianRttMs
                    : okBdix.length > 0
                      ? okBdix[Math.floor(okBdix.length / 2)]
                      : null;

                const okCdns = (run.cdnNodes ?? [])
                  .filter((n) => n.status === 'ok' && typeof n.throughputMbps === 'number')
                  .map((n) => n.throughputMbps as number)
                  .sort((a, b) => a - b);
                const cdnMed =
                  typeof run.cdnMedianMbps === 'number'
                    ? run.cdnMedianMbps
                    : okCdns.length > 0
                      ? okCdns[Math.floor(okCdns.length / 2)]
                      : null;

                const isSelected = run.id === activeRunId;

                return (
                  <tr
                    key={run.id}
                    onClick={() => onSelectRun(run)}
                    className={`cursor-pointer transition-colors ${
                      isSelected
                        ? 'bg-blue-50/70 dark:bg-blue-950/30'
                        : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                    }`}
                  >
                    <td className="py-2.5 pr-4 text-xs font-mono text-slate-700 dark:text-slate-300 whitespace-nowrap tabular-nums">
                      {new Date(run.timestamp).toLocaleString([], {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>
                    <td className="py-2.5 px-3 text-xs text-slate-600 dark:text-slate-300 whitespace-nowrap capitalize">
                      {run.scope === 'full' ? 'All 3 Tests' : run.scope}
                    </td>
                    <td className="py-2.5 px-3 text-xs text-slate-600 dark:text-slate-400 max-w-[180px] truncate">
                      {run.context?.isp || run.context?.ip || 'Local Network'}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-xs font-semibold text-slate-900 dark:text-slate-100 tabular-nums whitespace-nowrap">
                      {typeof run.downloadMbps === 'number' ? `${run.downloadMbps.toFixed(1)}` : '—'}
                      <span className="text-slate-400 font-normal"> / </span>
                      {typeof run.uploadMbps === 'number' ? `${run.uploadMbps.toFixed(1)} Mbps` : '—'}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-xs text-slate-700 dark:text-slate-300 tabular-nums whitespace-nowrap">
                      {typeof run.latency?.median === 'number' ? `${run.latency.median.toFixed(1)} ms` : '—'}
                      {run.bufferbloat?.grade ? ` · ${run.bufferbloat.grade}` : ''}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-xs text-slate-800 dark:text-slate-200 tabular-nums whitespace-nowrap">
                      {typeof run.bdixDownloadMbps === 'number'
                        ? `${run.bdixDownloadMbps.toFixed(1)} Mbps`
                        : '—'}
                      {typeof bdixMed === 'number' ? ` · ${bdixMed.toFixed(1)} ms` : ''}
                    </td>
                    <td className="py-2.5 pl-3 text-right font-mono text-xs font-semibold text-slate-900 dark:text-slate-100 tabular-nums whitespace-nowrap">
                      {typeof cdnMed === 'number' ? `${cdnMed.toFixed(1)} Mbps` : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
