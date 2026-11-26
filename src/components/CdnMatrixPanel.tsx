import { CheckCircle2, Loader2, XCircle } from 'lucide-react';
import type { CdnNodeResult } from '../types/network';

interface CdnMatrixPanelProps {
  nodes: CdnNodeResult[];
  isRunning: boolean;
  onRunCdnOnly: () => void;
}

export function CdnMatrixPanel({
  nodes,
  isRunning,
  onRunCdnOnly,
}: CdnMatrixPanelProps) {
  const maxMbps = Math.max(
    10,
    ...nodes.map((n) => n.throughputMbps ?? 0)
  );

  const okNodes = nodes.filter((n) => n.status === 'ok' && n.throughputMbps !== null);
  const fastest =
    okNodes.length > 0
      ? [...okNodes].sort((a, b) => (b.throughputMbps ?? 0) - (a.throughputMbps ?? 0))[0]
      : null;

  return (
    <section
      id="cdn-matrix"
      className="scroll-mt-20 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 transition-colors duration-200"
    >
      <div className="flex flex-wrap items-start justify-between gap-4 pb-5 border-b border-slate-200 dark:border-slate-800">
        <div>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            CDN Edge &amp; Cache Throughput Matrix
          </h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400 max-w-2xl">
            Measures real CORS payload delivery speed and Anycast RTT from your WiFi to Cloudflare, jsDelivr, cdnjs, unpkg, Google Edge, and the App Cloud Edge.
          </p>
        </div>

        <div className="flex items-center gap-4">
          {fastest && fastest.throughputMbps !== null && (
            <div className="text-right">
              <div className="text-xs text-slate-500 dark:text-slate-400">Fastest Edge</div>
              <div className="font-mono text-base font-semibold text-slate-900 dark:text-slate-100 tabular-nums">
                {fastest.provider} · {fastest.throughputMbps.toFixed(1)} Mbps
              </div>
            </div>
          )}
          <button
            type="button"
            onClick={onRunCdnOnly}
            disabled={isRunning}
            className="px-4 py-2 text-xs font-medium rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            Benchmark CDN Edges
          </button>
        </div>
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-slate-200 dark:border-slate-800 text-xs font-medium text-slate-500 dark:text-slate-400">
              <th className="py-2.5 pr-4">CDN Provider</th>
              <th className="py-2.5 px-3">Edge Layer</th>
              <th className="py-2.5 px-3 text-right">Median RTT</th>
              <th className="py-2.5 px-3 text-right">Jitter</th>
              <th className="py-2.5 px-3 text-right">Edge Speed</th>
              <th className="py-2.5 pl-4 min-w-[180px]">Relative Delivery</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70 text-sm">
            {nodes.map((node) => {
              const barPct =
                node.throughputMbps !== null
                  ? Math.max(4, Math.min(100, (node.throughputMbps / maxMbps) * 100))
                  : 0;

              return (
                <tr
                  key={node.id}
                  className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors"
                >
                  <td className="py-3 pr-4">
                    <div className="font-medium text-slate-900 dark:text-slate-100">
                      {node.provider}
                      {node.popHint ? (
                        <span className="ml-2 font-mono text-xs font-normal text-slate-500 dark:text-slate-400">
                          PoP {node.popHint}
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td className="py-3 px-3 text-xs text-slate-600 dark:text-slate-400">
                    {node.edgeLabel}
                  </td>
                  <td className="py-3 px-3 text-right font-mono text-xs text-slate-700 dark:text-slate-300 tabular-nums whitespace-nowrap">
                    {node.rttMs !== null ? `${node.rttMs.toFixed(1)} ms` : '—'}
                  </td>
                  <td className="py-3 px-3 text-right font-mono text-xs text-slate-600 dark:text-slate-400 tabular-nums whitespace-nowrap">
                    {node.jitterMs !== null ? `${node.jitterMs.toFixed(1)} ms` : '—'}
                  </td>
                  <td className="py-3 px-3 text-right font-mono text-xs font-semibold text-slate-900 dark:text-slate-100 tabular-nums whitespace-nowrap">
                    {node.throughputMbps !== null
                      ? `${node.throughputMbps.toFixed(1)} Mbps`
                      : '—'}
                  </td>
                  <td className="py-3 pl-4">
                    {node.status === 'testing' ? (
                      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 dark:text-blue-400">
                        <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                        Measuring edge payload
                      </span>
                    ) : node.status === 'ok' && node.throughputMbps !== null ? (
                      <div className="flex items-center gap-2.5">
                        <div className="flex-1 h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                          <div
                            className="h-full w-full origin-left rounded-full bg-blue-600 dark:bg-blue-500"
                            style={{
                              transform: `scaleX(${barPct / 100})`,
                              transition: 'transform 420ms cubic-bezier(0.16, 1, 0.3, 1)',
                            }}
                          />
                        </div>
                        <CheckCircle2
                          className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0"
                          aria-hidden="true"
                        />
                      </div>
                    ) : node.status === 'pending' ? (
                      <span className="text-xs text-slate-400 dark:text-slate-500">
                        Awaiting benchmark
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-xs text-rose-700 dark:text-rose-400">
                        <XCircle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                        {node.status === 'timeout' ? 'Payload timed out' : 'Edge fetch failed'}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
