// Tournament server replays (D31). Epic records every competitive game (a
// session's `ServerReplays` flag) and keeps it about one to two weeks. A replay
// is read by match ID, the `sessionId` on each game in a team's history: its
// metadata lists the parts, a POST returns signed links to them (good for 15
// minutes), and only the small event parts are read here: eliminations and
// knocks (`playerElim`) and per-player match stats (`AthenaMatchStats`). Byte
// layouts follow the open-source replay-reader (github.com/xNocken/replay-reader,
// MIT). Unverified against this season's replays until the first real read.

import type { FetchLike } from '../auth/epicToken.js';
import type { ReplayElim, ReplayPlayerStats, ReplaySummary } from '../types.js';
import type { EpicClient } from './client.js';
import { endpoints } from './endpoints.js';
import { asArr, asObj, num, str } from './json.js';

/** Events read per game, at most: every elimination and knock fits. */
const MAX_EVENTS = 400;
const CONCURRENCY = 16;

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

/** A player in an elimination: type 3 is a bot, 17 an account ID (one spare byte, then 16), 16 a name. */
function readPlayer(b: Uint8Array, at: number): { id: string; next: number } | undefined {
  const type = b[at];
  if (type === 3) return { id: 'bot', next: at + 1 };
  if (type === 17 && at + 18 <= b.length) return { id: hex(b.subarray(at + 2, at + 18)), next: at + 18 };
  if (type === 16 && at + 5 <= b.length) {
    const len = new DataView(b.buffer, b.byteOffset + at + 1, 4).getInt32(0, true);
    const bytes = len < 0 ? -len * 2 : len;
    if (len === 0 || at + 5 + bytes > b.length) return undefined;
    const raw = b.subarray(at + 5, at + 5 + bytes);
    const name = (len < 0 ? new TextDecoder('utf-16le') : new TextDecoder()).decode(raw).replace(/\0+$/, '');
    return { id: name, next: at + 5 + bytes };
  }
  return undefined;
}

/**
 * An elimination event: a header to skip (its size changed with Fortnite's
 * versions, newest first), the eliminated player, the eliminator, the weapon
 * type (one byte) and whether it was a knock (four bytes, lowest bit).
 */
export function parseElim(b: Uint8Array): Omit<ReplayElim, 'at'> | undefined {
  for (const skip of [165, 85, 45, 40, 12]) {
    const eliminated = readPlayer(b, skip);
    if (!eliminated) continue;
    const eliminator = readPlayer(b, eliminated.next);
    if (!eliminator || eliminator.next + 5 > b.length) continue;
    return {
      eliminated: eliminated.id,
      eliminator: eliminator.id,
      knocked: (b[eliminator.next + 1]! & 1) === 1,
    };
  }
  return undefined;
}

/** `AthenaMatchStats`: four bytes, accuracy (float), then ten counts. */
export function parseMatchStats(b: Uint8Array): Omit<ReplayPlayerStats, 'player'> | undefined {
  if (b.length < 48) return undefined;
  const v = new DataView(b.buffer, b.byteOffset, b.length);
  const u = (i: number) => v.getUint32(8 + i * 4, true);
  const accuracy = v.getFloat32(4, true);
  if (!Number.isFinite(accuracy)) return undefined;
  return {
    accuracy,
    assists: u(0),
    eliminations: u(1),
    damageToPlayers: u(2) + u(3),
    revives: u(4),
    damageTaken: u(5),
    damageToStructures: u(6),
    materialsGathered: u(7),
    materialsUsed: u(8),
    distance: u(9),
  };
}

const kindOf = (e: Record<string, unknown>) => {
  const group = str(e.Group) ?? '?';
  const meta = str(e.Metadata);
  return meta && meta !== group ? `${group}/${meta}` : group;
};
const isElim = (e: Record<string, unknown>) => str(e.Group) === 'playerElim';
const isStats = (e: Record<string, unknown>) =>
  str(e.Metadata) === 'AthenaMatchStats' || str(e.Group) === 'AthenaMatchStats';

/** An account ID named in an event's ID or labels, other than the match's own. */
function playerOf(e: Record<string, unknown>, matchId: string): string | null {
  for (const s of [str(e.Id), str(e.Group), str(e.Metadata)])
    for (const m of (s ?? '').matchAll(/[0-9a-f]{32}/gi)) if (m[0].toLowerCase() !== matchId) return m[0].toLowerCase();
  return null;
}

async function pool<T>(items: T[], limit: number, job: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) await job(items[next++]!);
    }),
  );
}

/**
 * Reads one game's replay: its eliminations and per-player stats, plus a count
 * of every kind of event it held. Undefined when Epic no longer has it.
 */
export async function readReplay(
  client: EpicClient,
  fetchImpl: FetchLike,
  matchId: string,
): Promise<ReplaySummary | undefined> {
  const meta = asObj(await client.getJson(endpoints.replayMetadata(matchId), 'replay metadata'));
  if (!meta) return undefined;
  const all = asArr(meta.Events)
    .map(asObj)
    .filter((e): e is Record<string, unknown> => !!e && !!str(e.Id));
  const events: Record<string, number> = {};
  for (const e of all) events[kindOf(e)] = (events[kindOf(e)] ?? 0) + 1;
  const wanted = all.filter((e) => isElim(e) || isStats(e)).slice(0, MAX_EVENTS);
  const notes: string[] = [];
  const encrypted = meta.bIsEncrypted ?? meta.bEncrypted ?? meta.EncryptionKey;
  if (encrypted) notes.push('The replay says it is encrypted.');

  const elims: ReplayElim[] = [];
  const stats: ReplayPlayerStats[] = [];
  let unreadable = 0;
  if (wanted.length) {
    const links = asObj(
      asObj(
        await client.postJson(
          endpoints.replayFiles(matchId),
          { files: wanted.map((e) => `${str(e.Id)}.bin`) },
          'replay links',
        ),
      )?.files,
    );
    await pool(wanted, CONCURRENCY, async (e) => {
      const link = str(asObj(links?.[`${str(e.Id)}.bin`])?.readLink);
      if (!link) return void unreadable++;
      const res = await fetchImpl(link);
      if (!res.ok) return void unreadable++;
      const b = new Uint8Array(await res.arrayBuffer());
      if (isElim(e)) {
        const elim = parseElim(b);
        if (elim) elims.push({ at: num(e.Time1) ?? 0, ...elim });
        else unreadable++;
      } else {
        const s = parseMatchStats(b);
        if (s) stats.push({ player: playerOf(e, matchId), ...s });
        else unreadable++;
      }
    });
  }
  if (unreadable)
    notes.push(`${unreadable} of ${wanted.length} events couldn't be read (encrypted, or a newer layout).`);
  if (!all.length) notes.push('The replay has no events.');
  elims.sort((a, b) => a.at - b.at);
  return {
    matchId,
    lengthMs: num(meta.LengthInMS) ?? 0,
    live: meta.bIsLive === true,
    events,
    elims,
    stats,
    notes,
  };
}
