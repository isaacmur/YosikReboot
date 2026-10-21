import type { Entry } from '../lib/types';

/** Keeps each team's first row. Ranks shift while a board is live or settling, so a team can turn up on two pages. */
export function dedupeTeams(entries: Entry[]): Entry[] {
  const seen = new Set<string>();
  return entries.filter((e) => {
    if (seen.has(e.teamKey)) return false;
    seen.add(e.teamKey);
    return true;
  });
}
