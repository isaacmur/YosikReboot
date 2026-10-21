// Loose readers for the events response, just enough to pick which windows to
// probe. They assume the field names community libraries use (events[].eventWindows[],
// templates[]) and skip anything that doesn't match rather than throwing.

import { asArr, asObj, num, str } from '../../lib/epic/json.js';
import { windowState } from '../../lib/status.js';
import type { WindowState } from '../../lib/types.js';

export interface ProbeWindow {
  eventId: string;
  windowId: string;
  begin: string;
  end: string;
  payoutDelayMin?: number;
  templateId?: string;
  playlistId?: string;
}

export type SampleKind = WindowState | 'duos';
export type Samples = Partial<Record<SampleKind, ProbeWindow>>;

export { asArr, asObj } from '../../lib/epic/json.js';

export function playlistsByTemplate(download: unknown): Map<string, string> {
  const out = new Map<string, string>();
  for (const t of asArr(asObj(download)?.templates)) {
    const id = str(asObj(t)?.eventTemplateId);
    const playlist = str(asObj(t)?.playlistId);
    if (id && playlist) out.set(id, playlist);
  }
  return out;
}

export function listWindows(download: unknown): ProbeWindow[] {
  const playlists = playlistsByTemplate(download);
  const out: ProbeWindow[] = [];
  for (const e of asArr(asObj(download)?.events)) {
    const ev = asObj(e);
    const eventId = str(ev?.eventId);
    if (!eventId) continue;
    for (const w of asArr(ev?.eventWindows)) {
      const win = asObj(w);
      const windowId = str(win?.eventWindowId);
      const begin = str(win?.beginTime);
      const end = str(win?.endTime);
      if (!windowId || !begin || !end) continue;
      const templateId = str(win?.eventTemplateId);
      out.push({
        eventId,
        windowId,
        begin,
        end,
        payoutDelayMin: num(win?.payoutDelay),
        templateId,
        playlistId: templateId ? playlists.get(templateId) : undefined,
      });
    }
  }
  return out;
}

/** Guess team size from a playlist ID like "Playlist_ShowdownTournament_Duos". */
export function teamSizeHint(playlistId?: string): number | undefined {
  if (!playlistId) return undefined;
  const p = playlistId.toLowerCase();
  if (p.includes('solo')) return 1;
  if (p.includes('duo')) return 2;
  if (p.includes('trio')) return 3;
  if (p.includes('squad')) return 4;
  return undefined;
}

/** One window per state (plus a duos one), preferring the most recent. */
export function pickSampleWindows(windows: ProbeWindow[], now: Date): Samples {
  const byState: Record<WindowState, ProbeWindow[]> = { upcoming: [], live: [], wrapping: [], final: [] };
  for (const w of windows) byState[windowState(w, now)].push(w);

  const latestEnd = (a: ProbeWindow, b: ProbeWindow) => Date.parse(b.end) - Date.parse(a.end);
  const soonestBegin = (a: ProbeWindow, b: ProbeWindow) => Date.parse(a.begin) - Date.parse(b.begin);

  const samples: Samples = {};
  const upcoming = [...byState.upcoming].sort(soonestBegin)[0];
  const live = [...byState.live].sort(latestEnd)[0];
  const wrapping = [...byState.wrapping].sort(latestEnd)[0];
  const finals = [...byState.final].sort(latestEnd);
  if (upcoming) samples.upcoming = upcoming;
  if (live) samples.live = live;
  if (wrapping) samples.wrapping = wrapping;
  if (finals[0]) samples.final = finals[0];
  const duos = finals.find((w) => teamSizeHint(w.playlistId) === 2);
  if (duos) samples.duos = duos;
  return samples;
}
