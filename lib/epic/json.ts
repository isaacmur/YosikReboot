// Defensive readers for Epic's JSON: wrong or missing types become undefined /
// empty instead of throwing, so one odd field can't break a whole response.

export function asObj(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
}

export function asArr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

export const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined);

export const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

export const strings = (v: unknown): string[] => asArr(v).filter((x): x is string => typeof x === 'string');
