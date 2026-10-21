// Event search (F8): find any event or session by name across all regions'
// schedules. Every word typed has to match somewhere: a word in the event's name,
// tags, region or ID, or in a session's label, ID or date. Whole words beat word
// starts, which beat matches inside a word, which beat letters in order ("slendr").

import type { EventInfo, EventWindow } from '../lib/types';
import { formatDay, MODE_LABEL, TEAM_LABEL, TYPE_LABEL } from './format';

export interface SearchHit {
  event: EventInfo;
  /** Sessions the query picked out; empty when it matched the event as a whole. */
  windows: EventWindow[];
  score: number;
}

/** Lowercase words, accents dropped, CamelCase and IDs split: "S42_CashCup_Event6Round1" -> s42 cash cup event 6 round 1. */
export function words(text: string): string[] {
  return text
    .replace(/([a-z])([A-Z0-9])/g, '$1 $2')
    .replace(/([0-9])([A-Za-z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

const inOrder = (needle: string, word: string) => {
  let i = 0;
  for (const c of word) if (c === needle[i]) i++;
  return i === needle.length;
};

/**
 * 4 whole word, 3 word start, 2 inside a word (2+ characters), 1 letters in order
 * (3+ characters), 0 no match. A lone "2" only matches a word that is or starts with 2.
 */
export function tokenScore(token: string, list: string[]): number {
  let best = 0;
  for (const w of list) {
    if (w === token) return 4;
    if (w.startsWith(token)) best = Math.max(best, 3);
    else if (token.length >= 2 && w.includes(token)) best = Math.max(best, 2);
    else if (best < 1 && token.length >= 3 && inOrder(token, w)) best = 1;
  }
  return best;
}

function eventWords(e: EventInfo): string[] {
  return words(
    [
      e.name,
      e.subtitle ?? '',
      TYPE_LABEL[e.type],
      e.mode === 'OTHER' ? '' : MODE_LABEL[e.mode],
      e.zeroBuild ? 'Zero Build ZB' : '',
      e.teamSize ? TEAM_LABEL[e.teamSize] : '',
      e.mobileOnly ? 'Mobile' : '',
      e.homeRegion,
      e.id,
    ].join(' '),
  );
}

const windowWords = (w: EventWindow, tz: string) => words(`${w.label} ${w.id} ${formatDay(w.begin, tz)}`);

/** Best matches first; among equals, events from `prefer` (your region) first. */
export function searchEvents(events: EventInfo[], query: string, tz: string, prefer?: string): SearchHit[] {
  const tokens = words(query);
  if (!tokens.length) return [];
  const hits: SearchHit[] = [];
  for (const event of events) {
    const ew = eventWords(event);
    const sessions = event.windows.map((w) => ({ w, words: windowWords(w, tz) }));
    let score = 0;
    /** Words a session matches better than the event does, with the event's score. */
    const sessionTokens: [string, number][] = [];
    let matched = true;
    for (const t of tokens) {
      const atEvent = tokenScore(t, ew);
      const atSession = Math.max(0, ...sessions.map((s) => tokenScore(t, s.words)));
      if (!atEvent && !atSession) {
        matched = false;
        break;
      }
      if (atSession > atEvent) sessionTokens.push([t, atEvent]);
      score += Math.max(atEvent, atSession);
    }
    if (!matched) continue;
    // Those words narrow the hit to the sessions that have them; sessions whose
    // label has them side by side, as typed ("round 2"), win over the rest.
    let picked = sessionTokens.length
      ? sessions.filter((s) => sessionTokens.every(([t, atEvent]) => tokenScore(t, s.words) > atEvent))
      : [];
    const typed = new Set(sessionTokens.map(([t]) => t));
    const pairs = tokens.slice(1).flatMap((b, i) => (typed.has(tokens[i]!) && typed.has(b) ? [[tokens[i]!, b]] : []));
    if (pairs.length && picked.length > 1) {
      const together = (label: string[]) =>
        pairs.filter(([a, b]) =>
          label.some((w, i) => tokenScore(a!, [w]) >= 3 && tokenScore(b!, [label[i + 1] ?? '']) >= 3),
        ).length;
      const best = Math.max(...picked.map((s) => together(words(s.w.label))));
      if (best > 0) picked = picked.filter((s) => together(words(s.w.label)) === best);
    }
    const windows = picked.map((s) => s.w);
    if (sessionTokens.length && !windows.length) continue;
    if (words(event.name).join(' ').startsWith(tokens.join(' '))) score += 3;
    hits.push({ event, windows, score });
  }
  const mine = (h: SearchHit) => (h.event.homeRegion === prefer ? 0 : 1);
  return hits.sort((a, b) => b.score - a.score || mine(a) - mine(b));
}
