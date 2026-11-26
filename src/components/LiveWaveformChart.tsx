import { useState } from 'react';
import type { TestPhase, ThroughputSample } from '../types/network';

interface LiveWaveformChartProps {
  samples: ThroughputSample[];
  phase?: TestPhase;
}

interface PlotPoint {
  x: number;
  y: number;
  s: ThroughputSample;
  idx: number;
}

// Catmull-Rom to Cubic Bezier spline for smooth organic throughput curves
function buildSmoothSpline(points: PlotPoint[]): string {
  if (points.length === 0) return '';
  if (points.length === 1) {
    return `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
  }
  if (points.length === 2) {
    return `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)} L ${points[1].x.toFixed(1)} ${points[1].y.toFixed(1)}`;
  }

  let d = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
  const tension = 0.22;

  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];

    const cp1x = p1.x + (p2.x - p0.x) * tension;
    const cp1y = p1.y + (p2.y - p0.y) * tension;
    const cp2x = p2.x - (p3.x - p1.x) * tension;
    const cp2y = p2.y - (p3.y - p1.y) * tension;

    d += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }

  return d;
}

export function LiveWaveformChart({ samples, phase = 'idle' }: LiveWaveformChartProps) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  const dlSamples = samples.filter((s) => s.phase === 'download');
  const ulSamples = samples.filter((s) => s.phase === 'upload');

  const allMbps = samples.map((s) => s.mbps);
  const rawMax = allMbps.length > 0 ? Math.max(...allMbps) : 100;
  const maxMbps = Math.max(25, Math.ceil((rawMax * 1.15) / 10) * 10);

  const width = 640;
  const height = 210;
  const padLeft = 44;
  const padRight = 14;
  const padTop = 14;
  const padBottom = 26;
  const innerW = width - padLeft - padRight;
  const innerH = height - padTop - padBottom;

  const buildPath = (series: ThroughputSample[]) => {
    if (series.length === 0) {
      return { line: '', area: '', points: [] as PlotPoint[] };
    }
    const maxT = Math.max(8500, series[series.length - 1]?.t ?? 8500);
    const points: PlotPoint[] = series.map((s, idx) => {
      const x =
        padLeft +
        (series.length === 1
          ? innerW * 0.04
          : (Math.min(s.t, maxT) / maxT) * innerW);
      const y = Math.max(
        padTop,
        Math.min(
          padTop + innerH,
          padTop + innerH - (Math.min(s.mbps, maxMbps) / maxMbps) * innerH
        )
      );
      return { x, y, s, idx };
    });

    const line = buildSmoothSpline(points);
    const last = points[points.length - 1];
    const first = points[0];
    const area = `${line} L ${last.x.toFixed(1)} ${(padTop + innerH).toFixed(1)} L ${first.x.toFixed(1)} ${(padTop + innerH).toFixed(1)} Z`;

    return { line, area, points };
  };

  const dl = buildPath(dlSamples);
  const ul = buildPath(ulSamples);

  const yTicks = [0, 0.25, 0.5, 0.75, 1];
  const combinedPoints = [
    ...dl.points.map((p) => ({ ...p, color: '#2563EB', label: 'Download' })),
    ...ul.points.map((p) => ({ ...p, color: '#0D9488', label: 'Upload' })),
  ];
  const activePoint =
    hoveredIdx !== null && combinedPoints[hoveredIdx] ? combinedPoints[hoveredIdx] : null;

  const liveTip =
    phase === 'download' && dl.points.length > 0
      ? { point: dl.points[dl.points.length - 1], color: '#2563EB' }
      : phase === 'upload' && ul.points.length > 0
        ? { point: ul.points[ul.points.length - 1], color: '#0D9488' }
        : null;

  return (
    <div className="flex flex-col h-full justify-between">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Throughput Stability Waveform
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Smoothed multi-stream Mbps sampled at 180 ms intervals
          </p>
        </div>

        <div className="flex items-center gap-4 text-xs text-slate-600 dark:text-slate-400">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block w-3 h-0.5 bg-blue-600" aria-hidden="true" />
            Download ({dlSamples.length})
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block w-3 h-0.5 bg-teal-600" aria-hidden="true" />
            Upload ({ulSamples.length})
          </span>
        </div>
      </div>

      <div className="relative w-full">
        {samples.length === 0 ? (
          <div className="h-[210px] flex flex-col items-center justify-center rounded-lg border border-dashed border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/40 text-center px-4 transition-colors duration-200">
            {phase === 'latency' ? (
              <>
                <div className="w-36 h-1.5 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden mb-3">
                  <div className="h-full w-1/2 rounded-full bg-blue-600 animate-pulse" />
                </div>
                <p className="text-sm font-medium text-slate-800 dark:text-slate-200">
                  Calibrating idle latency baseline...
                </p>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  Download &amp; upload waveforms will begin streaming momentarily.
                </p>
              </>
            ) : (
              <>
                <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                  No active throughput trace yet
                </p>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 max-w-md">
                  Click Run All 3 Tests or Run Overall Test to capture smooth multi-stream download and upload stability waveforms.
                </p>
              </>
            )}
          </div>
        ) : (
          <svg
            viewBox={`0 0 ${width} ${height}`}
            className="w-full h-[210px] overflow-visible"
            onMouseLeave={() => setHoveredIdx(null)}
          >
            <defs>
              <linearGradient id="dlAreaGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#2563EB" stopOpacity="0.24" />
                <stop offset="100%" stopColor="#2563EB" stopOpacity="0.01" />
              </linearGradient>
              <linearGradient id="ulAreaGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#0D9488" stopOpacity="0.20" />
                <stop offset="100%" stopColor="#0D9488" stopOpacity="0.01" />
              </linearGradient>
            </defs>

            {yTicks.map((ratio) => {
              const y = padTop + innerH - ratio * innerH;
              const val = Math.round(ratio * maxMbps);
              return (
                <g key={ratio}>
                  <line
                    x1={padLeft}
                    y1={y}
                    x2={width - padRight}
                    y2={y}
                    stroke="currentColor"
                    strokeDasharray={ratio === 0 ? undefined : '3 3'}
                    strokeWidth="1"
                    className="text-slate-200 dark:text-slate-800"
                  />
                  <text
                    x={padLeft - 8}
                    y={y}
                    textAnchor="end"
                    dominantBaseline="middle"
                    className="fill-slate-400 dark:fill-slate-500 font-mono text-[10px]"
                  >
                    {val}
                  </text>
                </g>
              );
            })}

            {[0, 2, 4, 6, 8].map((sec) => {
              const x = padLeft + (sec / 8.5) * innerW;
              return (
                <text
                  key={sec}
                  x={x}
                  y={height - 6}
                  textAnchor="middle"
                  className="fill-slate-400 dark:fill-slate-500 font-mono text-[10px]"
                >
                  {sec}s
                </text>
              );
            })}

            {dl.area && <path d={dl.area} fill="url(#dlAreaGrad)" />}
            {dl.line && (
              <path
                d={dl.line}
                fill="none"
                stroke="#2563EB"
                strokeWidth="2.4"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            )}

            {ul.area && <path d={ul.area} fill="url(#ulAreaGrad)" />}
            {ul.line && (
              <path
                d={ul.line}
                fill="none"
                stroke="#0D9488"
                strokeWidth="2.4"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            )}

            {/* Leading active telemetry point */}
            {liveTip && (
              <g>
                <circle
                  cx={liveTip.point.x}
                  cy={liveTip.point.y}
                  r="8"
                  fill={liveTip.color}
                  opacity="0.22"
                />
                <circle
                  cx={liveTip.point.x}
                  cy={liveTip.point.y}
                  r="4"
                  fill="#ffffff"
                  stroke={liveTip.color}
                  strokeWidth="2.5"
                />
              </g>
            )}

            {combinedPoints.map((pt, idx) => (
              <circle
                key={`${pt.label}-${idx}`}
                cx={pt.x}
                cy={pt.y}
                r={hoveredIdx === idx ? 4.5 : 4}
                fill={hoveredIdx === idx ? pt.color : 'transparent'}
                stroke={hoveredIdx === idx ? '#ffffff' : 'transparent'}
                strokeWidth="1.5"
                className="cursor-crosshair"
                onMouseEnter={() => setHoveredIdx(idx)}
              />
            ))}

            {activePoint && (
              <g>
                <line
                  x1={activePoint.x}
                  y1={padTop}
                  x2={activePoint.x}
                  y2={padTop + innerH}
                  stroke={activePoint.color}
                  strokeWidth="1"
                  strokeDasharray="2 2"
                  opacity="0.6"
                />
                <rect
                  x={Math.min(width - 140, Math.max(padLeft, activePoint.x - 62))}
                  y={Math.max(4, activePoint.y - 36)}
                  width="126"
                  height="26"
                  rx="4"
                  className="fill-slate-900 dark:fill-slate-100"
                />
                <text
                  x={Math.min(width - 140, Math.max(padLeft, activePoint.x - 62)) + 63}
                  y={Math.max(4, activePoint.y - 36) + 16}
                  textAnchor="middle"
                  className="fill-white dark:fill-slate-900 font-mono text-[10px] font-medium"
                >
                  {activePoint.label} · {activePoint.s.mbps.toFixed(1)} Mbps @ {(activePoint.s.t / 1000).toFixed(1)}s
                </text>
              </g>
            )}
          </svg>
        )}
      </div>
    </div>
  );
}
