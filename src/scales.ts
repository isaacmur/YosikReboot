// Axis scales for the charts in components/Charts.tsx.

/** Rounds up to 1, 2, 2.5 or 5 times a power of ten, for a clean top tick. */
export function niceMax(v: number): number {
  if (!(v > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((m) => m >= v)!;
}

/** Powers of ten from `lo` to `hi` (ranks on a log scale). */
export function logTicks(lo: number, hi: number): number[] {
  const out: number[] = [];
  for (let t = 10 ** Math.floor(Math.log10(Math.max(1, lo))); t <= Math.max(hi, 1); t *= 10) out.push(t);
  return out;
}

/**
 * A rank axis: powers of ten when the ranks span ten times or more, otherwise
 * whole-number steps (never a 0th or a 2.5th), so a narrow range still gets labels.
 */
export function rankTicks(lo: number, hi: number): { ticks: number[]; log: boolean } {
  if (hi >= Math.max(1, lo) * 10) return { ticks: logTicks(lo, hi), log: true };
  const ticks = [
    ...new Set(
      niceTicks(lo, hi)
        .filter(Number.isInteger)
        .map((t) => Math.max(1, t)),
    ),
  ];
  return { ticks, log: false };
}

/** 950, 1.2K */
export const compact = (n: number) => (n >= 1000 ? `${+(n / 1000).toFixed(1)}K` : String(n));

/**
 * A clean axis around [lo, hi] for a trend line, not forced down to 0: about
 * `count` ticks on a 1, 2, 2.5 or 5 step, never finer than 1 (points are whole).
 */
export function niceTicks(lo: number, hi: number, count = 4): number[] {
  const top = hi > lo ? hi : lo + 1;
  const raw = (top - lo) / (count - 1);
  const p = 10 ** Math.floor(Math.log10(raw));
  const step = Math.max(
    1,
    [1, 2, 2.5, 5, 10].map((m) => m * p).find((s) => s >= raw)!,
  );
  const out: number[] = [];
  for (let t = Math.floor(lo / step) * step; ; t += step) {
    out.push(t);
    if (t >= top) break;
  }
  return out;
}
