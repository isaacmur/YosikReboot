// Tiny localStorage-backed stores (follows, scan results). Reads and writes are
// wrapped: in a private window or with storage blocked they fall back to memory.

import { useSyncExternalStore } from 'react';

export function createStore<T>(key: string, parse: (raw: unknown) => T, fallback: T) {
  let current: T = fallback;
  try {
    const raw = localStorage.getItem(key);
    if (raw !== null) current = parse(JSON.parse(raw));
  } catch {
    current = fallback;
  }
  const listeners = new Set<() => void>();
  const subscribe = (l: () => void) => {
    listeners.add(l);
    return () => listeners.delete(l);
  };
  return {
    get: () => current,
    set(next: T) {
      current = next;
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        // Keep it for this tab only.
      }
      listeners.forEach((l) => l());
    },
    use: () => useSyncExternalStore(subscribe, () => current),
  };
}
