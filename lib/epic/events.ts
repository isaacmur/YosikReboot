// Turns Epic's `events/download` response into the app's EventInfo shape:
// classification, readable labels, plain-language entry rules, CMS display data.

import {
  REGIONS,
  isRegion,
  type EventInfo,
  type EventType,
  type EventWindow,
  type Mode,
  type PlatformGroup,
  type Region,
  type TeamSize,
} from '../types.js';
import type { CmsIndex } from './cms.js';
import { asArr, asObj, num, str, strings } from './json.js';

const REGION_SUFFIX = new RegExp(`_(${REGIONS.join('|')})$`);

export function homeRegion(eventId: string): Region | 'GLOBAL' {
  const m = REGION_SUFFIX.exec(eventId);
  return m && isRegion(m[1]) ? m[1] : 'GLOBAL';
}

/** `epicgames_S42_RankedCupSolo_NAC` -> `S42_RankedCupSolo` */
function eventBase(eventId: string): string {
  return eventId.replace(/^epicgames_/, '').replace(REGION_SUFFIX, '');
}

const TYPE_BY_TOURNAMENT: Record<string, EventType> = {
  FNCS: 'FNCS',
  RankedCup: 'RANKED_CUP',
  ShopCup: 'PROMO_CUP',
  CashCup: 'CASH_CUP',
  VictoryCup: 'VICTORY_CUP',
};

export function classifyType(tournamentType: string | undefined, eventId: string): EventType {
  if (/PerformanceEvaluation|PerfEval/i.test(eventId)) return 'PERF_EVAL';
  const byMeta = tournamentType ? TYPE_BY_TOURNAMENT[tournamentType] : undefined;
  if (byMeta) return byMeta;
  // Fallback for events without the metadata field.
  if (/RankedCup/i.test(eventId)) return 'RANKED_CUP';
  if (/CashCup/i.test(eventId)) return 'CASH_CUP';
  if (/VictoryCup/i.test(eventId)) return 'VICTORY_CUP';
  if (/FNCS/i.test(eventId) && !/Cup/i.test(eventId)) return 'FNCS';
  return 'OTHER';
}

/** Reload playlists carry an `RE_` prefix or a Reload map codename. */
const RELOAD = /(^|_)RE_|BlastBerry|DashBerry|SourSpawn|PiperBoot|JumpBear/;

export function classifyMode(playlists: string[], eventId: string): Mode {
  if (playlists.some((p) => RELOAD.test(p)) || /Reload/i.test(eventId)) return 'RELOAD';
  if (playlists.some((p) => /ShowdownTournament/.test(p))) return 'BR';
  return 'OTHER';
}

export function isZeroBuild(playlists: string[], eventId: string): boolean {
  return playlists.some((p) => /NoBuild/i.test(p)) || /_ZB(_|$)|ZB$/.test(eventBase(eventId));
}

export function teamSizeOf(playlists: string[], eventId: string): TeamSize | null {
  for (const s of [...playlists, eventId]) {
    if (/Solo/i.test(s)) return 1;
    if (/Duo/i.test(s)) return 2;
    if (/Trio/i.test(s)) return 3;
    if (/Squad/i.test(s)) return 4;
  }
  return null;
}

const PLATFORM_GROUPS: Record<string, PlatformGroup> = {
  Windows: 'PC',
  Mac: 'PC',
  PS4: 'CONSOLE',
  PS5: 'CONSOLE',
  XB1: 'CONSOLE',
  XboxOne: 'CONSOLE',
  XboxOneGDK: 'CONSOLE',
  XSX: 'CONSOLE',
  Switch: 'CONSOLE',
  Switch2: 'CONSOLE',
  IOS: 'MOBILE',
  Android: 'MOBILE',
};

export function platformGroups(platforms: string[]): PlatformGroup[] {
  const groups = new Set<PlatformGroup>();
  for (const p of platforms) groups.add(PLATFORM_GROUPS[p] ?? 'CLOUD');
  return (['PC', 'CONSOLE', 'MOBILE', 'CLOUD'] as const).filter((g) => groups.has(g));
}

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

/**
 * The part of a window ID that isn't already in the event ID, made readable:
 * leading segments the event ID shares (season, series) are dropped, e.g.
 * `S42_FNCSSolo_LastChanceLobby` under `S42_FNCSSolo_LastChanceQualifier` -> "Last Chance Lobby".
 * Returns '' when the window ID adds nothing; normalizeEvents then calls it "Session".
 */
export function windowLabel(windowId: string, eventId: string): string {
  const eventSegs = eventBase(eventId).toLowerCase().split('_');
  const winSegs = windowId.replace(REGION_SUFFIX, '').split('_');
  let i = 0;
  while (i < winSegs.length && i < eventSegs.length && eventSegs[i]!.startsWith(winSegs[i]!.toLowerCase())) i++;
  return humanize(winSegs.slice(i).join('_'));
}

const humanToken = (t: string) => humanize(t.replace(/^S\d+_/, ''));

/** Plain-language entry rules. Unknown requirement kinds are skipped, not guessed at. */
export function requirements(window: Record<string, unknown>): string[] {
  const out: string[] = [];
  const all = strings(window.requireAllTokens).filter((t) => t !== 'fake_token');
  if (strings(window.requireAllTokens).includes('fake_token')) out.push('Invite only');
  if (all.length) out.push(`Qualified players only (${all.map(humanToken).join(', ')})`);
  const any = strings(window.requireAnyTokens);
  if (any.length) out.push(`Requires one of: ${any.map(humanToken).join(', ')}`);
  const extra = asArr(window.additionalRequirements).flatMap((r) => (Array.isArray(r) ? strings(r) : strings([r])));
  if (extra.includes('mfa')) out.push('Two-factor authentication on');
  const ranked = [...new Set(extra.map((r) => /^currentRanking:([\w-]+):\d+$/.exec(r)?.[1]).filter(Boolean))];
  for (const track of ranked) out.push(`Needs a rank in ${humanize(track!.replace(/^ranked-/, ''))} ranked`);
  return out;
}

function playlistsByTemplate(raw: Record<string, unknown>): Map<string, string> {
  const out = new Map<string, string>();
  for (const t of asArr(raw.templates)) {
    const id = str(asObj(t)?.eventTemplateId);
    const playlist = str(asObj(t)?.playlistId);
    if (id && playlist) out.set(id, playlist);
  }
  return out;
}

function normalizeWindow(w: Record<string, unknown>, eventId: string): EventWindow | undefined {
  const id = str(w.eventWindowId);
  const begin = str(w.beginTime);
  const end = str(w.endTime);
  if (!id || !begin || !end || Number.isNaN(Date.parse(begin)) || Number.isNaN(Date.parse(end))) return undefined;
  return {
    id,
    eventId,
    round: num(w.round) ?? 0,
    label: windowLabel(id, eventId),
    begin: new Date(begin).toISOString(),
    end: new Date(end).toISOString(),
    payoutDelayMin: num(w.payoutDelay) ?? null,
    isTBD: w.isTBD === true,
    requirements: requirements(w),
  };
}

export function normalizeEvents(rawDoc: unknown, cms: CmsIndex): EventInfo[] {
  const raw = asObj(rawDoc);
  if (!raw) return [];
  const playlists = playlistsByTemplate(raw);
  const out: EventInfo[] = [];
  for (const e of asArr(raw.events)) {
    const ev = asObj(e);
    const id = str(ev?.eventId);
    if (!ev || !id) continue;
    const rawWindows = asArr(ev.eventWindows)
      .map(asObj)
      .filter((w): w is Record<string, unknown> => !!w);
    const windows = rawWindows
      .map((w) => normalizeWindow(w, id))
      .filter((w): w is EventWindow => !!w)
      .sort((a, b) => a.begin.localeCompare(b.begin));
    if (!windows.length) continue;
    const unnamed = windows.filter((w) => !w.label);
    unnamed.forEach((w, i) => (w.label = unnamed.length > 1 ? `Session ${i + 1}` : 'Session'));
    const eventPlaylists = [
      ...new Set(rawWindows.map((w) => playlists.get(str(w.eventTemplateId) ?? '')).filter((p): p is string => !!p)),
    ];
    const meta = asObj(ev.metadata) ?? {};
    const displayId = str(ev.displayDataId);
    const display = displayId ? cms.get(displayId) : undefined;
    const level = num(meta.minimumAccountLevel);
    out.push({
      id,
      homeRegion: homeRegion(id),
      regions: strings(ev.regions).filter(isRegion),
      name: display?.title ?? humanize(eventBase(id).replace(/^S\d+_/, '')),
      subtitle: display?.subtitle,
      description: display?.description,
      type: classifyType(str(meta.tournamentType), id),
      mode: classifyMode(eventPlaylists, id),
      zeroBuild: isZeroBuild(eventPlaylists, id),
      teamSize: teamSizeOf(eventPlaylists, id),
      mobileOnly: /mobile/i.test(id) || /mobile/i.test(displayId ?? ''),
      platforms: platformGroups(strings(ev.platforms)),
      minAccountLevel: level && level > 0 ? level : null,
      art: {
        square: display?.square,
        tile: display?.tile,
        background: display?.background,
        primary: display?.primary,
        left: display?.left,
        right: display?.right,
      },
      windows,
    });
  }
  return out;
}
