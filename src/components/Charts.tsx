// Charts: points per game (F29), placement over time (F23) and cutoff points
// over time (F28). Drawn in SVG at the container's pixel width so text stays
// small and sharp. One series each, in the accent color: thin marks, hairline
// grid, the extreme labelled, and a tooltip on hover and keyboard focus. Every
// chart sits next to a table with the same numbers.

import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { MatchResult } from '../../lib/types';
import { formatTime, ordinal } from '../format';
import { compact, logTicks, niceMax, niceTicks } from '../scales';

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(Math.floor(el.getBoundingClientRect().width));
    const ro = new ResizeObserver(([e]) => e && setWidth(Math.floor(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

/**
 * Value first and strong, details after. Sits above (x, y) in the plot's own
 * coordinates, measured so it never spills past the chart's edges.
 */
function Tip({ x, y, width, children }: { x: number; y: number; width: number; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.offsetWidth);
    const ro = new ResizeObserver(() => setW(el.offsetWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div
      ref={ref}
      role="status"
      className="pointer-events-none absolute z-10 w-max max-w-[16rem] -translate-y-full rounded-md border border-line-strong bg-raised px-2 py-1 text-xs shadow-lg"
      style={{
        left: Math.min(Math.max(x - w / 2, 0), Math.max(0, width - w)),
        top: y,
        visibility: w ? 'visible' : 'hidden',
      }}
    >
      {children}
    </div>
  );
}

/** A column with a 4px rounded top and a square base. */
const column = (x: number, y: number, w: number, h: number) => {
  const r = Math.min(4, h, w / 2);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
};

const PAD = { l: 32, r: 8, t: 20, b: 22 };

/** Points scored in each game, oldest first; wins are marked W under their column. */
export function MatchChart({ sessions, tz }: { sessions: MatchResult[]; tz: string }) {
  const [ref, width] = useWidth();
  const [active, setActive] = useState<number>();
  const H = 150;
  const values = sessions.map((s) => s.points ?? 0);
  const max = niceMax(Math.max(...values, 1));
  const plotW = Math.max(0, width - PAD.l - PAD.r);
  const plotH = H - PAD.t - PAD.b;
  const band = values.length ? plotW / values.length : 0;
  const barW = Math.max(2, Math.min(24, band - 4));
  const y = (v: number) => PAD.t + plotH - (v / max) * plotH;
  const top = values.indexOf(Math.max(...values));
  const every = Math.ceil(14 / Math.max(band, 1));
  const at = (i: number) => PAD.l + band * i + band / 2;
  return (
    <figure>
      <figcaption className="text-[10px] font-semibold tracking-wider text-faint uppercase">Points per game</figcaption>
      <div ref={ref} className="relative">
        {width > 0 && (
          <svg width={width} height={H} role="img" aria-label={`Points per game: ${values.join(', ')}`}>
            {[0, max / 2, max].map((t) => (
              <g key={t}>
                <line x1={PAD.l} x2={width - PAD.r} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeWidth={1} />
                <text x={PAD.l - 6} y={y(t)} dy="0.32em" textAnchor="end" className="nums fill-faint text-[10px]">
                  {compact(t)}
                </text>
              </g>
            ))}
            {values.map((v, i) => {
              const h = y(0) - y(v);
              const s = sessions[i]!;
              return (
                <g key={i}>
                  {h > 0 && (
                    <path
                      d={column(at(i) - barW / 2, y(v), barW, h)}
                      fill="var(--accent)"
                      opacity={active === undefined || active === i ? 1 : 0.5}
                    />
                  )}
                  {(i % every === 0 || s.victory) && (
                    <text
                      x={at(i)}
                      y={H - 6}
                      textAnchor="middle"
                      className={`nums text-[10px] ${s.victory ? 'fill-ink font-bold' : 'fill-faint'}`}
                    >
                      {s.victory ? 'W' : i + 1}
                    </text>
                  )}
                  {i === top && v > 0 && (
                    <text
                      x={at(i)}
                      y={y(v) - 5}
                      textAnchor="middle"
                      className="nums fill-ink text-[10px] font-semibold"
                    >
                      {v}
                    </text>
                  )}
                  <rect
                    x={PAD.l + band * i}
                    y={PAD.t}
                    width={band}
                    height={plotH + PAD.b}
                    fill="transparent"
                    tabIndex={0}
                    aria-label={`Game ${i + 1}: ${v} points`}
                    className="outline-none"
                    onPointerEnter={() => setActive(i)}
                    onPointerLeave={() => setActive(undefined)}
                    onFocus={() => setActive(i)}
                    onBlur={() => setActive(undefined)}
                  />
                </g>
              );
            })}
          </svg>
        )}
        {active !== undefined && sessions[active] && (
          <Tip x={at(active)} y={y(values[active]!) - 6} width={width}>
            <span className="nums font-bold text-ink">{values[active]} pts</span>{' '}
            <span className="text-muted">
              game {active + 1} ·{' '}
              {sessions[active]!.victory ? 'win' : sessions[active]!.place ? `#${sessions[active]!.place}` : '—'} ·{' '}
              {sessions[active]!.elims} elims
              {sessions[active]!.endedAt ? ` · ${formatTime(sessions[active]!.endedAt, tz)}` : ''}
            </span>
          </Tip>
        )}
      </div>
    </figure>
  );
}

export interface LinePoint {
  value: number;
  /** Shown in the tooltip, e.g. "Cash Cup · Event 6 Round 1 · Oct 18". */
  label: string;
}

/**
 * One value per step, oldest first, as a 2px line with markers. `ranks` draws
 * a log scale with 1st at the top (placements); otherwise a linear scale from 0.
 */
export function LineChart({
  points,
  title,
  ranks = false,
  format = (v) => v.toLocaleString('en-US'),
}: {
  points: LinePoint[];
  title: string;
  ranks?: boolean;
  format?: (v: number) => string;
}) {
  const [ref, width] = useWidth();
  const [active, setActive] = useState<number>();
  const H = 160;
  const values = points.map((p) => p.value);
  const plotW = Math.max(0, width - PAD.l - PAD.r - 8);
  const plotH = H - PAD.t - PAD.b;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  // A trend's axis fits its values; a line doesn't need a zero baseline.
  const ticks = ranks ? logTicks(lo, hi) : niceTicks(lo, hi);
  const [tMin, tMax] = ranks
    ? [Math.log10(Math.max(1, ticks[0]!)), Math.log10(Math.max(hi, ticks[ticks.length - 1]!, 2))]
    : [ticks[0]!, ticks[ticks.length - 1]!];
  const scaled = (v: number) => (ranks ? Math.log10(Math.max(1, v)) : v);
  // Ranks: 1st at the top. Values: 0 at the bottom.
  const y = (v: number) => {
    const f = (scaled(v) - tMin) / (tMax - tMin || 1);
    return ranks ? PAD.t + f * plotH : PAD.t + plotH - f * plotH;
  };
  const x = (i: number) => PAD.l + 8 + (points.length > 1 ? (i / (points.length - 1)) * plotW : plotW / 2);
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join('');
  // The area wash reads as "amount from zero", so it's drawn only when the axis starts at 0.
  const wash = !ranks && tMin === 0;
  const best = ranks ? values.indexOf(lo) : values.indexOf(hi);
  const nearest = (px: number) => points.reduce((b, _, i) => (Math.abs(x(i) - px) < Math.abs(x(b) - px) ? i : b), 0);
  return (
    <figure>
      <figcaption className="text-[10px] font-semibold tracking-wider text-faint uppercase">{title}</figcaption>
      <div ref={ref} className="relative">
        {width > 0 && points.length > 0 && (
          <svg
            width={width}
            height={H}
            role="img"
            aria-label={`${title}: ${values.map(format).join(', ')}`}
            onPointerMove={(e) => setActive(nearest(e.clientX - e.currentTarget.getBoundingClientRect().left))}
            onPointerLeave={() => setActive(undefined)}
          >
            {ticks.map((t) => (
              <g key={t}>
                <line x1={PAD.l} x2={width - PAD.r} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeWidth={1} />
                <text x={PAD.l - 6} y={y(t)} dy="0.32em" textAnchor="end" className="nums fill-faint text-[10px]">
                  {ranks ? ordinal(t) : compact(t)}
                </text>
              </g>
            ))}
            {wash && (
              <path
                d={`${line}L${x(points.length - 1).toFixed(1)},${y(0)}L${x(0).toFixed(1)},${y(0)}Z`}
                fill="var(--accent)"
                opacity={0.1}
              />
            )}
            <path
              d={line}
              fill="none"
              stroke="var(--accent)"
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            {active !== undefined && (
              <line
                x1={x(active)}
                x2={x(active)}
                y1={PAD.t}
                y2={PAD.t + plotH}
                stroke="var(--line-strong)"
                strokeWidth={1}
              />
            )}
            {points.map((p, i) => (
              <g key={i}>
                <circle
                  cx={x(i)}
                  cy={y(p.value)}
                  r={active === i ? 5 : 4}
                  fill="var(--accent)"
                  stroke="var(--surface)"
                  strokeWidth={2}
                />
                <circle
                  cx={x(i)}
                  cy={y(p.value)}
                  r={12}
                  fill="transparent"
                  tabIndex={0}
                  aria-label={`${p.label}: ${format(p.value)}`}
                  className="outline-none"
                  onFocus={() => setActive(i)}
                  onBlur={() => setActive(undefined)}
                />
              </g>
            ))}
            {points.length > 1 && (
              <text
                x={x(best)}
                y={y(values[best]!) - 10}
                textAnchor="middle"
                className="nums fill-ink text-[10px] font-semibold"
              >
                {format(values[best]!)}
              </text>
            )}
          </svg>
        )}
        {active !== undefined && points[active] && (
          <Tip x={x(active)} y={y(points[active].value) - 10} width={width}>
            <span className="nums font-bold text-ink">{format(points[active].value)}</span>{' '}
            <span className="text-muted">{points[active].label}</span>
          </Tip>
        )}
      </div>
    </figure>
  );
}
