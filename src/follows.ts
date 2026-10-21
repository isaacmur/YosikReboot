// Followed players (F22), keyed by account ID and kept in this browser.
// Export/import moves the list between devices.

import { createStore } from './store';

export interface Follow {
  id: string;
  name: string;
  isMe?: boolean;
  addedAt: string;
}

const isAccountId = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{32}$/.test(v);

export function parseFollows(raw: unknown): Follow[] {
  const list = Array.isArray(raw) ? raw : (raw as { follows?: unknown })?.follows;
  if (!Array.isArray(list)) throw new Error('Not a follow list');
  const seen = new Set<string>();
  const out: Follow[] = [];
  for (const f of list as Record<string, unknown>[]) {
    if (!f || !isAccountId(f.id) || seen.has(f.id) || typeof f.name !== 'string') continue;
    seen.add(f.id);
    out.push({
      id: f.id,
      name: f.name.slice(0, 32),
      ...(f.isMe === true ? { isMe: true } : {}),
      addedAt: typeof f.addedAt === 'string' ? f.addedAt : new Date().toISOString(),
    });
  }
  // At most one "me".
  let me = false;
  for (const f of out) {
    if (f.isMe && me) delete f.isMe;
    if (f.isMe) me = true;
  }
  return out;
}

const store = createStore<Follow[]>('yr.follows.v1', parseFollows, []);

export const useFollows = store.use;
export const getFollows = store.get;

export function addFollow(id: string, name: string): void {
  if (store.get().some((f) => f.id === id)) return;
  store.set([...store.get(), { id, name, addedAt: new Date().toISOString() }]);
}

export function removeFollow(id: string): void {
  store.set(store.get().filter((f) => f.id !== id));
}

/** Marks one follow as you (or none with `null`). */
export function setMe(id: string | null): void {
  store.set(
    store
      .get()
      .map(({ id: fid, name, addedAt }) => ({ id: fid, name, addedAt, ...(fid === id ? { isMe: true } : {}) })),
  );
}

export function renameFollows(names: Map<string, string>): void {
  const next = store
    .get()
    .map((f) => (names.has(f.id) && names.get(f.id) !== f.name ? { ...f, name: names.get(f.id)! } : f));
  if (next.some((f, i) => f !== store.get()[i])) store.set(next);
}

export function exportFollows(): string {
  return JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), follows: store.get() }, null, 2);
}

/** Merges an exported list into this one; returns how many were added. Keeps your own "me" if set. */
export function importFollows(text: string): number {
  const incoming = parseFollows(JSON.parse(text));
  const have = new Set(store.get().map((f) => f.id));
  const keepMe = !store.get().some((f) => f.isMe);
  const added = incoming
    .filter((f) => !have.has(f.id))
    .map(({ id, name, addedAt, isMe }) => ({ id, name, addedAt, ...(isMe && keepMe ? { isMe: true } : {}) }));
  store.set([...store.get(), ...added]);
  return added.length;
}
