// Shared types. Only the parts that don't depend on Epic's response shapes live
// here for now; Event / Window / Entry are added in Phase 1 once Phase 0 has
// verified the shapes (see docs/EPIC_API_NOTES.md).

export const REGIONS = ['NAC', 'NAE', 'NAW', 'EU', 'BR', 'OCE', 'ME', 'ASIA'] as const;
export type Region = (typeof REGIONS)[number];

export type WindowState = 'upcoming' | 'live' | 'wrapping' | 'final';
