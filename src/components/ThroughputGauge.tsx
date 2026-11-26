import { useEffect, useRef, useState } from 'react';
import type { TestPhase } from '../types/network';

interface ThroughputGaugeProps {
  phase: TestPhase;
  liveMbps: number;
  downloadMbps: number | null;
  uploadMbps: number | null;
  bdixDownloadMbps: number | null;
  cdnMedianMbps: number | null;
  loadedLatencyMs: number | null;
  idleLatencyMs: number | null;
}

const PHASE_LABELS: Record<TestPhase, string> = {
  idle: 'Ready to run 3 tests',
  latency: 'Test 1/3 · Measuring idle latency & jitter',
  download: 'Test 1/3 · Overall WiFi download speed',
  upload: 'Test 1/3 · Overall WiFi upload speed',
  bdix: 'Test 2/3 · Measuring BDIX peering & speed',
  cdn: 'Test 3/3 · Benchmarking CDN edge speed',
  complete: 'All selected tests complete',
  cancelled: 'Test stopped',
  error: 'Measurement error',
};

export function ThroughputGauge({
  phase,
  liveMbps,
  downloadMbps,
  uploadMbps,
  bdixDownloadMbps,
  cdnMedianMbps,
  loadedLatencyMs,
  idleLatencyMs,
}: ThroughputGaugeProps) {
  const isActivelyMeasuringRate =
    phase === 'download' ||
    phase === 'upload' ||
    phase === 'bdix' ||
    phase === 'cdn';

  const isAnyRunning = isActivelyMeasuringRate || phase === 'latency';

  const targetValue = isActivelyMeasuringRate
    ? liveMbps
    : downloadMbps ?? bdixDownloadMbps ?? cdnMedianMbps ?? 0;

  // 60fps critically-smoothed value & arc interpolation
  const [animatedValue, setAnimatedValue] = useState(targetValue);
  const targetRef = useRef(targetValue);
  const currentRef = useRef(targetValue);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    targetRef.current = targetValue;
  }, [targetValue]);

  useEffect(() => {
    const prefersReduced =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    if (prefersReduced) {
      currentRef.current = targetRef.current;
      setAnimatedValue(targetRef.current);
      return;
    }

    let lastTime = performance.now();

    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - lastTime) / 1000);
      lastTime = now;

      const diff = targetRef.current - currentRef.current;
      if (Math.abs(diff) > 0.01) {
        // Exponential smoothing tuned for 60fps fluid needle & rolling counter
        const alpha = 1 - Math.exp(-9.5 * dt);
        currentRef.current += diff * alpha;
        setAnimatedValue(currentRef.current);
      } else if (currentRef.current !== targetRef.current) {
        currentRef.current = targetRef.current;
        setAnimatedValue(targetRef.current);
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const rateCaption =
    phase === 'upload'
      ? 'Overall Upload Rate'
      : phase === 'bdix'
        ? 'BDIX Speed'
        : phase === 'cdn'
          ? 'CDN Edge Speed'
          : phase === 'download'
            ? 'Overall Download Rate'
            : phase === 'latency'
              ? 'Probing Latency'
              : downloadMbps !== null
                ? 'Overall Download'
                : bdixDownloadMbps !== null
                  ? 'BDIX Speed'
                  : cdnMedianMbps !== null
                    ? 'CDN Median Speed'
                    : 'Throughput';

  const normalized =
    animatedValue <= 0
      ? 0
      : Math.min(1, Math.log10(1 + animatedValue) / Math.log10(1001));

  const radius = 104;
  const cx = 140;
  const cy = 132;
  const startAngle = 150;
  const sweepAngle = 240;
  const endAngle = startAngle + sweepAngle;
  const tipAngle = startAngle + sweepAngle * normalized;

  const polarToCartesian = (angleDeg: number, r = radius) => {
    const rad = (angleDeg * Math.PI) / 180;
    return {
      x: cx + r * Math.cos(rad),
      y: cy + r * Math.sin(rad),
    };
  };

  const describeArc = (fromDeg: number, toDeg: number) => {
    const start = polarToCartesian(fromDeg);
    const end = polarToCartesian(toDeg);
    const largeArc = toDeg - fromDeg <= 180 ? '0' : '1';
    return `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} A ${radius} ${radius} 0 ${largeArc} 1 ${end.x.toFixed(2)} ${end.y.toFixed(2)}`;
  };

  const fullArcPath = describeArc(startAngle, endAngle);
  const tipPos = polarToCartesian(tipAngle);
  const scaleTicks = [0, 10, 50, 100, 250, 500, 1000];

  const strokeColor =
    phase === 'upload'
      ? '#0D9488'
      : phase === 'bdix'
        ? '#059669'
        : phase === 'cdn'
          ? '#6366F1'
          : '#2563EB';

  const dashOffset = 1000 * (1 - normalized);

  return (
    <div className="flex flex-col items-center justify-between h-full">
      <div className="relative w-full max-w-[300px]">
        <svg
          viewBox="0 0 280 220"
          className="w-full h-auto overflow-visible"
          role="img"
          aria-label={`Speed gauge showing ${animatedValue.toFixed(1)} Mbps`}
        >
          {/* Background track */}
          <path
            d={fullArcPath}
            fill="none"
            stroke="currentColor"
            strokeWidth="12"
            strokeLinecap="round"
            className="text-slate-200 dark:text-slate-800"
          />

          {/* Tick markers */}
          {scaleTicks.map((tick) => {
            const norm = Math.log10(1 + tick) / Math.log10(1001);
            const deg = startAngle + sweepAngle * norm;
            const inner = polarToCartesian(deg, radius - 16);
            const outer = polarToCartesian(deg, radius - 10);
            const label = polarToCartesian(deg, radius + 18);
            const isPassed = normalized >= norm - 0.01;
            return (
              <g key={tick}>
                <line
                  x1={inner.x}
                  y1={inner.y}
                  x2={outer.x}
                  y2={outer.y}
                  stroke={isPassed && animatedValue > 0.5 ? strokeColor : 'currentColor'}
                  strokeWidth="1.5"
                  className={
                    isPassed && animatedValue > 0.5
                      ? 'transition-colors duration-200'
                      : 'text-slate-300 dark:text-slate-700'
                  }
                />
                <text
                  x={label.x}
                  y={label.y}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  className="fill-slate-400 dark:fill-slate-500 font-mono text-[9px]"
                >
                  {tick === 1000 ? '1G' : tick}
                </text>
              </g>
            );
          })}

          {/* Continuous pathLength=1000 arc for liquid 60fps strokeDashoffset */}
          <path
            d={fullArcPath}
            pathLength={1000}
            fill="none"
            stroke={strokeColor}
            strokeWidth="12"
            strokeLinecap="round"
            strokeDasharray="1000"
            strokeDashoffset={dashOffset}
            style={{
              opacity: normalized > 0.002 ? 1 : 0,
              transition: 'stroke 240ms cubic-bezier(0.16, 1, 0.3, 1), opacity 180ms ease',
            }}
          />

          {/* Leading tip indicator dot during active measurement */}
          {normalized > 0.004 && (
            <g>
              {isActivelyMeasuringRate && (
                <circle
                  cx={tipPos.x}
                  cy={tipPos.y}
                  r="10"
                  fill={strokeColor}
                  opacity="0.22"
                />
              )}
              <circle
                cx={tipPos.x}
                cy={tipPos.y}
                r="5"
                fill="#ffffff"
                stroke={strokeColor}
                strokeWidth="3"
              />
            </g>
          )}

          <text
            x={cx}
            y={cy - 12}
            textAnchor="middle"
            className="fill-slate-500 dark:fill-slate-400 text-[11px] font-medium"
          >
            {rateCaption}
          </text>
          <text
            x={cx}
            y={cy + 22}
            textAnchor="middle"
            className="fill-slate-900 dark:fill-slate-50 font-mono text-[38px] font-bold tracking-tight tabular-nums"
          >
            {animatedValue > 0.05
              ? animatedValue.toFixed(animatedValue >= 100 ? 1 : 2)
              : '0.0'}
          </text>
          <text
            x={cx}
            y={cy + 46}
            textAnchor="middle"
            className="fill-slate-500 dark:fill-slate-400 font-mono text-[12px] font-medium"
          >
            Mbps
          </text>
        </svg>
      </div>

      <div className="w-full pt-3 border-t border-slate-200/80 dark:border-slate-800/80">
        <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 mb-2">
          <span className="truncate pr-2">{PHASE_LABELS[phase]}</span>
          {(phase === 'download' || phase === 'upload') && loadedLatencyMs !== null ? (
            <span className="font-mono tabular-nums text-slate-700 dark:text-slate-300 shrink-0">
              Loaded RTT: {loadedLatencyMs.toFixed(0)} ms
            </span>
          ) : idleLatencyMs !== null ? (
            <span className="font-mono tabular-nums text-slate-700 dark:text-slate-300 shrink-0">
              Idle RTT: {idleLatencyMs.toFixed(1)} ms
            </span>
          ) : null}
        </div>

        {/* Smooth compositor-only activity rail while probing */}
        <div className="h-1 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden mb-3">
          {isAnyRunning ? (
            <div
              className="h-full w-1/3 rounded-full animate-pulse"
              style={{
                backgroundColor: strokeColor,
                transform: `translateX(${Math.round(normalized * 200)}%)`,
                transition: 'transform 160ms linear, background-color 240ms ease',
              }}
            />
          ) : (
            <div
              className="h-full w-full origin-left rounded-full"
              style={{
                backgroundColor: strokeColor,
                transform: `scaleX(${phase === 'complete' ? 1 : 0})`,
                transition: 'transform 350ms cubic-bezier(0.16, 1, 0.3, 1)',
              }}
            />
          )}
        </div>

        <div className="grid grid-cols-3 gap-3 text-left">
          <div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">Overall ↓/↑</div>
            <div className="mt-0.5 font-mono text-sm font-semibold text-slate-900 dark:text-slate-100 tabular-nums">
              {downloadMbps !== null ? `${downloadMbps.toFixed(1)}` : '—'}
              <span className="text-slate-400 font-normal"> / </span>
              {uploadMbps !== null ? `${uploadMbps.toFixed(1)}` : '—'}
            </div>
          </div>
          <div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">BDIX Speed</div>
            <div className="mt-0.5 font-mono text-sm font-semibold text-slate-900 dark:text-slate-100 tabular-nums">
              {bdixDownloadMbps !== null ? `${bdixDownloadMbps.toFixed(1)} Mbps` : '—'}
            </div>
          </div>
          <div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">CDN Speed</div>
            <div className="mt-0.5 font-mono text-sm font-semibold text-slate-900 dark:text-slate-100 tabular-nums">
              {cdnMedianMbps !== null ? `${cdnMedianMbps.toFixed(1)} Mbps` : '—'}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
