// Replay stats (D31): event parsing and the route, with synthetic events.

import { describe, expect, it } from 'vitest';
import { makeReplayHandler } from '../api/replay';
import type { FetchLike } from '../lib/auth/epicToken';
import { EpicClient, fixedToken } from '../lib/epic/client';
import { parseElim, parseMatchStats } from '../lib/epic/replay';
import type { ReplaySummary } from '../lib/types';
import { elimEvent, statsEvent } from './helpers/replays';

const A = 'a'.repeat(32);
const B = 'b'.repeat(32);
const MATCH = 'c'.repeat(32);

describe('replay events', () => {
  it('reads eliminations and knocks, by account or bot, across header sizes', () => {
    expect(parseElim(elimEvent({ eliminated: B, eliminator: A }))).toEqual({
      eliminated: B,
      eliminator: A,
      knocked: false,
    });
    expect(parseElim(elimEvent({ eliminated: B, eliminator: A, knocked: true, header: 85 }))).toMatchObject({
      knocked: true,
    });
    expect(parseElim(elimEvent({ eliminated: 'bot', eliminator: A }))).toMatchObject({
      eliminated: 'bot',
      eliminator: A,
    });
    expect(parseElim(new Uint8Array(20))).toBeUndefined();
  });

  it('reads match stats, adding weapon and other damage', () => {
    const s = parseMatchStats(
      statsEvent({
        accuracy: 0.1143,
        eliminations: 4,
        weaponDamage: 700,
        otherDamage: 93,
        damageTaken: 650,
        materialsGathered: 1200,
      }),
    );
    expect(s).toMatchObject({ eliminations: 4, damageToPlayers: 793, damageTaken: 650, materialsGathered: 1200 });
    expect(s!.accuracy).toBeCloseTo(0.1143, 4);
    expect(parseMatchStats(new Uint8Array(10))).toBeUndefined();
  });
});

/** Replay storage: metadata, signed links (POST), and the event files behind them. */
function fakeStorage(o: { status?: number; appStatus?: number } = {}) {
  const calls: string[] = [];
  const files: Record<string, Uint8Array<ArrayBuffer>> = {
    'e1.bin': elimEvent({ eliminated: B, eliminator: A, knocked: true }),
    'e2.bin': elimEvent({ eliminated: B, eliminator: A }),
    [`${A}-stats.bin`]: statsEvent({
      accuracy: 0.2,
      eliminations: 1,
      weaponDamage: 300,
      damageTaken: 120,
      materialsGathered: 900,
    }),
    'junk.bin': new Uint8Array(3),
  };
  const fetchImpl =
    (who: string): FetchLike =>
    async (url, init) => {
      const u = new URL(url);
      calls.push(`${who} ${init?.method ?? 'GET'} ${u.hostname}${u.pathname.endsWith('/') ? ' links' : ''}`);
      const auth = (init?.headers as Record<string, string> | undefined)?.Authorization;
      if (u.hostname === 'cdn.test') return new Response(files[u.pathname.slice(1)]!);
      if (who === 'app' && o.appStatus)
        return Response.json({ errorCode: 'errors.com.epicgames.common.forbidden' }, { status: o.appStatus });
      expect(auth).toMatch(/^bearer /);
      if (u.pathname.endsWith('.json')) {
        if (o.status) return Response.json({ errorCode: 'errors.com.epicgames.not_found' }, { status: o.status });
        return Response.json({
          LengthInMS: 1_380_000,
          bIsLive: false,
          Events: [
            { Id: 'e1', Group: 'playerElim', Time1: 60_000 },
            { Id: 'e2', Group: 'playerElim', Time1: 90_000 },
            { Id: `${A}-stats`, Group: 'AthenaMatchStats', Metadata: 'AthenaMatchStats' },
            { Id: 'junk', Group: 'AthenaMatchStats', Metadata: 'AthenaMatchStats' },
            { Id: 'zone', Group: 'timecode' },
          ],
        });
      }
      const asked = (JSON.parse(String(init?.body)) as { files: string[] }).files;
      return Response.json({
        files: Object.fromEntries(asked.map((f) => [f, { readLink: `https://cdn.test/${f}`, size: 1 }])),
      });
    };
  const client = (who: string) =>
    new EpicClient({
      tokens: fixedToken({ accessToken: who, accountId: '', clientId: '', expiresAt: Infinity }),
      fetch: fetchImpl(who),
      minGapMs: 0,
    });
  const handler = makeReplayHandler({
    client: () => client('app'),
    fallback: () => client('svc'),
    fetch: fetchImpl('cdn'),
  });
  return { handler, calls };
}

const get = (match: string) => new Request(`https://app.test/api/replay?match=${match}`);

describe('GET /api/replay', () => {
  it("reads a game's eliminations and stats, counts its events, and caches it a week", async () => {
    const { handler, calls } = fakeStorage();
    const res = await handler(get(MATCH));
    expect(res.status).toBe(200);
    expect(res.headers.get('vercel-cdn-cache-control')).toMatch(/max-age=604800/);
    const body = (await res.json()) as ReplaySummary;
    expect(body.events).toEqual({ playerElim: 2, AthenaMatchStats: 2, timecode: 1 });
    expect(body.elims).toEqual([
      { at: 60_000, eliminated: B, eliminator: A, knocked: true },
      { at: 90_000, eliminated: B, eliminator: A, knocked: false },
    ]);
    expect(body.stats).toEqual([expect.objectContaining({ player: A, damageToPlayers: 300, materialsGathered: 900 })]);
    expect(body.notes).toEqual(["1 of 4 events couldn't be read (encrypted, or a newer layout)."]);
    // Only the event parts are fetched: no gameplay data.
    expect(calls.filter((c) => c.startsWith('cdn'))).toHaveLength(4);
  });

  it('says when Epic no longer has the replay, and checks the match ID', async () => {
    const { handler } = fakeStorage({ status: 404 });
    const res = await handler(get(MATCH));
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('replay_gone');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect((await handler(get('nope'))).status).toBe(400);
  });

  it("tries the service account's token if the app token is refused", async () => {
    const { handler, calls } = fakeStorage({ appStatus: 403 });
    expect((await handler(get(MATCH))).status).toBe(200);
    expect(calls.some((c) => c.startsWith('svc'))).toBe(true);
  });
});
