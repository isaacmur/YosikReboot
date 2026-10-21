// Per-browser settings in localStorage (F36). Reads and writes are wrapped so a
// private window or blocked storage just means defaults.

import { useSyncExternalStore } from 'react';
import { isRegion, type Region } from '../lib/types';

export const THEMES = ['system', 'dark', 'light'] as const;
export type Theme = (typeof THEMES)[number];

export interface Settings {
  region: Region;
  timeZone: string;
  /** Live leaderboard refresh, used from Phase 2. */
  refreshSec: number;
  /** Color theme; "system" follows the device. */
  theme: Theme;
}

export const DEFAULT_SETTINGS: Settings = {
  region: 'NAE',
  timeZone: 'America/New_York',
  refreshSec: 60,
  theme: 'system',
};
const KEY = 'yr.settings.v1';

export function isTimeZone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || !tz) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Saved settings, with anything missing or invalid replaced by the default. */
export function parseSettings(value: unknown): Settings {
  const raw = (value && typeof value === 'object' ? value : {}) as Partial<Settings>;
  return {
    region: isRegion(raw.region) ? raw.region : DEFAULT_SETTINGS.region,
    timeZone: isTimeZone(raw.timeZone) ? raw.timeZone : DEFAULT_SETTINGS.timeZone,
    refreshSec:
      typeof raw.refreshSec === 'number' && raw.refreshSec >= 30 && raw.refreshSec <= 600
        ? raw.refreshSec
        : DEFAULT_SETTINGS.refreshSec,
    theme: THEMES.find((t) => t === raw.theme) ?? DEFAULT_SETTINGS.theme,
  };
}

function read(): Settings {
  try {
    return parseSettings(JSON.parse(localStorage.getItem(KEY) ?? '{}'));
  } catch {
    return DEFAULT_SETTINGS;
  }
}

let current = read();
const listeners = new Set<() => void>();

export function updateSettings(patch: Partial<Settings>): void {
  current = { ...current, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // Storage unavailable: keep the change for this tab only.
  }
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useSettings(): [Settings, (patch: Partial<Settings>) => void] {
  return [useSyncExternalStore(subscribe, () => current), updateSettings];
}
