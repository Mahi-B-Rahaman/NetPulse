import { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Globe,
  Loader2,
  Plus,
  Trash2,
  XCircle,
} from 'lucide-react';
import type { BdixNodeResult, BdixNodeTarget } from '../types/network';

interface BdixPeeringPanelProps {
  nodes: BdixNodeResult[];
  customTargets: BdixNodeTarget[];
  isRunning: boolean;
  onRunBdixOnly: () => void;
  onAddCustomTarget: (target: BdixNodeTarget) => void;
  onRemoveCustomTarget: (id: string) => void;
  countryCode: string | null;
}

const VERDICT_META: Record<
  BdixNodeResult['peeringVerdict'],
  { label: string; colorClass: string; Icon: typeof CheckCircle2 }
> = {
  'local-peered': {
    label: 'Direct BDIX Peering',
    colorClass: 'text-emerald-700 dark:text-emerald-400',
    Icon: CheckCircle2,
  },
  'hairpin-transit': {
    label: 'Transit / Suboptimal IX',
    colorClass: 'text-amber-700 dark:text-amber-400',
    Icon: AlertTriangle,
  },
  'cross-region': {
    label: 'Cross-Region Route',
    colorClass: 'text-slate-600 dark:text-slate-300',
    Icon: Globe,
  },
  unreachable: {
    label: 'Unreachable / Walled',
    colorClass: 'text-rose-700 dark:text-rose-400',
    Icon: XCircle,
  },
  pending: {
    label: 'Awaiting probe',
    colorClass: 'text-slate-400 dark:text-slate-500',
    Icon: Globe,
  },
};

export function BdixPeeringPanel({
  nodes,
  customTargets,
  isRunning,
  onRunBdixOnly,
  onAddCustomTarget,
  onRemoveCustomTarget,
  countryCode,
}: BdixPeeringPanelProps) {
  const [nameInput, setNameInput] = useState('');
  const [urlInput, setUrlInput] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const okNodes = nodes.filter((n) => n.status === 'ok' && n.avgMs !== null);
  const medianAvg =
    okNodes.length > 0
      ? [...okNodes].sort((a, b) => (a.avgMs ?? 0) - (b.avgMs ?? 0))[
          Math.floor(okNodes.length / 2)
        ]?.avgMs ?? null
      : null;

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const trimmedUrl = urlInput.trim();
    if (!trimmedUrl) {
      setFormError('Enter an HTTPS URL for your BDIX mirror or local ISP node.');
      return;
    }
    let parsed: URL;
    try {
      parsed = new URL(trimmedUrl.startsWith('http') ? trimmedUrl : `https://${trimmedUrl}`);
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        setFormError('Only HTTP or HTTPS URLs are supported.');
        return;
      }
    } catch {
      setFormError('Enter a valid URL (for example: https://mirror.example.com.bd/).');
      return;
    }

    onAddCustomTarget({
      id: `custom-bdix-${Date.now()}`,
      name: nameInput.trim() || parsed.hostname,
      operator: 'Custom BDIX Target',
      url: parsed.toString(),
      region: 'User Defined',
      isCustom: true,
    });
    setNameInput('');
    setUrlInput('');
  };

  return (
    <section
      id="bdix-peering"
      className="scroll-mt-20 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 transition-colors duration-200"
    >
      <div className="flex flex-wrap items-start justify-between gap-4 pb-5 border-b border-slate-200 dark:border-slate-800">
        <div>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            BDIX Peering &amp; Domestic Route Matrix
          </h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400 max-w-2xl">
            Direct browser-to-node RTT probes across Bangladesh Internet Exchange endpoints.
            {countryCode === 'BD'
              ? ' Detected Bangladesh network: healthy BDIX peering typically responds under 25 ms.'
              : ' When testing outside Bangladesh or behind non-peered transit, expect higher cross-region RTT or ISP-walled timeouts.'}
          </p>
        </div>

        <div className="flex items-center gap-4">
          {medianAvg !== null && (
            <div className="text-right">
              <div className="text-xs text-slate-500 dark:text-slate-400">BDIX Median RTT</div>
              <div className="font-mono text-base font-semibold text-slate-900 dark:text-slate-100 tabular-nums">
                {medianAvg.toFixed(1)} ms
              </div>
            </div>
          )}
          <button
            type="button"
            onClick={onRunBdixOnly}
            disabled={isRunning}
            className="px-4 py-2 text-xs font-medium rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            Probe BDIX Routes
          </button>
        </div>
      </div>

      {/* Custom BDIX target bar */}
      <form
        onSubmit={handleAdd}
        className="mt-4 pb-4 border-b border-slate-100 dark:border-slate-800/80 flex flex-wrap items-end gap-3"
      >
        <div className="flex-1 min-w-[180px]">
          <label
            htmlFor="bdix-custom-name"
            className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1"
          >
            Custom BDIX Node Label
          </label>
          <input
            id="bdix-custom-name"
            type="text"
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            placeholder="e.g. Local ISP FTP Mirror"
            className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
          />
        </div>

        <div className="flex-[2] min-w-[240px]">
          <label
            htmlFor="bdix-custom-url"
            className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1"
          >
            Target HTTPS URL (CORS endpoints also measure download Mbps)
          </label>
          <input
            id="bdix-custom-url"
            type="text"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            placeholder="https://mirror.example.com.bd/"
            className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
          />
        </div>

        <button
          type="submit"
          className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-lg bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 hover:bg-slate-800 dark:hover:bg-white transition-colors whitespace-nowrap shrink-0 cursor-pointer h-[38px]"
        >
          <Plus className="w-3.5 h-3.5" aria-hidden="true" />
          Add Node
        </button>

        {formError && (
          <p className="w-full text-xs text-rose-600 dark:text-rose-400">{formError}</p>
        )}
      </form>

      {/* High-density telemetry table */}
      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-slate-200 dark:border-slate-800 text-xs font-medium text-slate-500 dark:text-slate-400">
              <th className="py-2.5 pr-4">Exchange / Endpoint</th>
              <th className="py-2.5 px-3">Region</th>
              <th className="py-2.5 px-3 text-right">Min</th>
              <th className="py-2.5 px-3 text-right">Avg</th>
              <th className="py-2.5 px-3 text-right">p95</th>
              <th className="py-2.5 px-3 text-right">Jitter</th>
              <th className="py-2.5 pl-4">Route Assessment</th>
              <th className="py-2.5 pl-2 w-8 text-right">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70 text-sm">
            {nodes.map((node) => {
              const meta = VERDICT_META[node.peeringVerdict];
              const VerdictIcon = meta.Icon;
              const isCustom = customTargets.some((c) => c.id === node.id) || node.isCustom;

              return (
                <tr
                  key={node.id}
                  className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors"
                >
                  <td className="py-2.5 pr-4">
                    <div className="font-medium text-slate-900 dark:text-slate-100">
                      {node.name}
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 font-mono truncate max-w-[260px]">
                      {node.operator} · {node.url.replace(/^https?:\/\//, '').replace(/\/$/, '')}
                    </div>
                  </td>
                  <td className="py-2.5 px-3 text-xs text-slate-600 dark:text-slate-400 whitespace-nowrap">
                    {node.region}
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono text-xs text-slate-700 dark:text-slate-300 tabular-nums whitespace-nowrap">
                    {node.minMs !== null ? `${node.minMs.toFixed(1)} ms` : '—'}
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono text-xs font-semibold text-slate-900 dark:text-slate-100 tabular-nums whitespace-nowrap">
                    {node.avgMs !== null ? `${node.avgMs.toFixed(1)} ms` : '—'}
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono text-xs text-slate-700 dark:text-slate-300 tabular-nums whitespace-nowrap">
                    {node.p95Ms !== null ? `${node.p95Ms.toFixed(1)} ms` : '—'}
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono text-xs text-slate-600 dark:text-slate-400 tabular-nums whitespace-nowrap">
                    {node.jitterMs !== null ? `${node.jitterMs.toFixed(1)} ms` : '—'}
                  </td>
                  <td className="py-2.5 pl-4 whitespace-nowrap">
                    {node.status === 'testing' ? (
                      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 dark:text-blue-400">
                        <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                        Probing samples
                      </span>
                    ) : (
                      <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${meta.colorClass}`}>
                        <VerdictIcon className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                        <span>
                          {meta.label}
                          {node.throughputMbps !== null
                            ? ` (${node.throughputMbps.toFixed(1)} Mbps)`
                            : ''}
                        </span>
                      </span>
                    )}
                  </td>
                  <td className="py-2.5 pl-2 text-right">
                    {isCustom && (
                      <button
                        type="button"
                        onClick={() => onRemoveCustomTarget(node.id)}
                        aria-label={`Remove ${node.name}`}
                        className="p-1.5 rounded text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 transition-colors cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                      </button>
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
