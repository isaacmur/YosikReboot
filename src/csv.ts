// CSV export (F31) for leaderboards and your results, built in the browser from
// data already loaded. Text that a spreadsheet would run as a formula (a display
// name starting with "=", "+", "-" or "@") gets a leading apostrophe.

import type { Entry } from '../lib/types';

export type Cell = string | number | null | undefined;

function cell(v: Cell): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  const s = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: Cell[][]): string {
  return rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

/** One line per team, best rank first. `teamName` labels saved teams. */
export function boardCsv(entries: Entry[], teamName?: (teamKey: string) => string | undefined): string {
  return toCsv([
    ['Rank', 'Team', 'Players', 'Account IDs', 'Points', 'Games', 'Wins', 'Elims', 'Avg place'],
    ...[...entries]
      .sort((a, b) => a.rank - b.rank)
      .map((e) => [
        e.rank,
        teamName?.(e.teamKey),
        e.members.map((m) => m.name ?? m.id).join(' / '),
        e.members.map((m) => m.id).join(' '),
        e.points,
        e.matches,
        e.victories,
        e.elims,
        e.avgPlace,
      ]),
  ]);
}

/** A file name from readable parts: "solo-ranked-cup-event-8-unreal.csv". */
export function fileName(parts: string[], ext = 'csv'): string {
  const slug = parts
    .join(' ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
  return `${slug || 'export'}.${ext}`;
}

/** Hands the browser a file to save. CSV starts with a byte-order mark so Excel reads names as UTF-8. */
export function saveFile(name: string, text: string, type = 'text/csv'): void {
  const body = type === 'text/csv' ? `\uFEFF${text}` : text;
  const url = URL.createObjectURL(new Blob([body], { type: `${type};charset=utf-8` }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
