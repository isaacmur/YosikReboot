// Readable text from Epic's IDs (shared by the schedule and payout parsers).

/** `Qual1Round1Day2` -> `Qual 1 Round 1 Day 2`, `Final_Day1` -> `Final Day 1` */
export function humanize(s: string): string {
  return s
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Za-z])(\d)/g, '$1 $2')
    .replace(/(\d)([A-Za-z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
}
