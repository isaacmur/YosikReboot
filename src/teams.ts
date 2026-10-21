// Saved teams (F24): duos, trios and squads kept together across events. A team
// is keyed like a board row (sorted member IDs), so a row finds its team by key.
// Kept in this browser with the follows, and exported and imported with them.

import { createStore } from './store';

export interface TeamMember {
  id: string;
  name: string;
}

export interface Team {
  key: string;
  name: string;
  members: TeamMember[];
  addedAt: string;
}

/** Same as a board row's `teamKey`. */
export const teamKeyOf = (ids: string[]) => [...ids].sort().join(':');

const isAccountId = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{32}$/.test(v);

export function parseTeams(raw: unknown): Team[] {
  if (!Array.isArray(raw)) return [];
  const out = new Map<string, Team>();
  for (const t of raw as Record<string, unknown>[]) {
    if (!t || typeof t.name !== 'string' || !t.name.trim() || !Array.isArray(t.members)) continue;
    const members = (t.members as Record<string, unknown>[])
      .filter((m) => m && isAccountId(m.id))
      .map((m) => ({ id: m.id as string, name: typeof m.name === 'string' ? m.name.slice(0, 32) : '' }));
    const key = teamKeyOf(members.map((m) => m.id));
    if (members.length < 2 || members.length > 4 || new Set(members.map((m) => m.id)).size !== members.length) continue;
    if (out.has(key)) continue;
    out.set(key, {
      key,
      name: t.name.trim().slice(0, 32),
      members,
      addedAt: typeof t.addedAt === 'string' ? t.addedAt : new Date().toISOString(),
    });
  }
  return [...out.values()];
}

const store = createStore<Team[]>('yr.teams.v1', parseTeams, []);

export const useTeams = store.use;
export const getTeams = store.get;

/** Saves a team, or renames it if those players are already saved together. */
export function saveTeam(name: string, members: TeamMember[]): void {
  const [team] = parseTeams([{ name, members, addedAt: new Date().toISOString() }]);
  if (!team) return;
  const prev = store.get().find((t) => t.key === team.key);
  store.set(
    prev ? store.get().map((t) => (t.key === team.key ? { ...t, name: team.name } : t)) : [...store.get(), team],
  );
}

export function removeTeam(key: string): void {
  store.set(store.get().filter((t) => t.key !== key));
}

/** Adds teams not saved yet (from an import); returns how many were added. */
export function mergeTeams(incoming: Team[]): number {
  const have = new Set(store.get().map((t) => t.key));
  const added = incoming.filter((t) => !have.has(t.key));
  if (added.length) store.set([...store.get(), ...added]);
  return added.length;
}
