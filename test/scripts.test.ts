import { describe, expect, it } from 'vitest';
import type { FetchLike } from '../lib/auth/epicToken';
import { createDeviceAuth } from '../scripts/deviceAuth';
import { readClient, readDevice, readExchangeClient, upsertEnv } from '../scripts/env';
import { parseLabel, parseRateTest, parseRegions } from '../scripts/probe/args';
import { REDACTED, scrub } from '../scripts/probe/scrub';
import { listWindows, pickSampleWindows, teamSizeHint } from '../scripts/probe/select';

describe('scrub', () => {
  it('redacts credential keys at any depth, case-insensitively', () => {
    const out = scrub({ access_token: 'a', nested: [{ Secret: 's', deviceId: 'd', keep: 1 }], refresh_token: 'r' });
    expect(out).toEqual({ access_token: REDACTED, nested: [{ Secret: REDACTED, deviceId: REDACTED, keep: 1 }], refresh_token: REDACTED });
  });

  it('replaces known secret values inside any string', () => {
    expect(scrub({ url: 'https://x/kill/abcdefgh12345?y' }, ['abcdefgh12345'])).toEqual({ url: `https://x/kill/${REDACTED}?y` });
  });

  it('ignores short or empty secrets so it cannot shred ordinary text', () => {
    expect(scrub('a b c', ['a', '', undefined])).toBe('a b c');
  });

  it('leaves competitive token lists alone (key is "tokens", not a credential)', () => {
    expect(scrub({ tokens: ['ARENA_S99_Division1'] })).toEqual({ tokens: ['ARENA_S99_Division1'] });
  });
});

describe('env', () => {
  it('reports missing variables', () => {
    expect(readClient({ EPIC_CLIENT_ID: 'x' }).missing).toEqual(['EPIC_CLIENT_SECRET']);
    expect(readDevice({}).missing).toEqual(['EPIC_ACCOUNT_ID', 'EPIC_DEVICE_ID', 'EPIC_DEVICE_SECRET']);
    expect(readDevice({ EPIC_ACCOUNT_ID: 'a', EPIC_DEVICE_ID: ' d ', EPIC_DEVICE_SECRET: 's' }).device).toEqual({
      accountId: 'a',
      deviceId: 'd',
      secret: 's',
    });
  });

  it('only uses the exchange client when both halves are set', () => {
    expect(readExchangeClient({ EPIC_EVENTS_CLIENT_ID: 'x', EPIC_EVENTS_CLIENT_SECRET: '' })).toBeUndefined();
    expect(readExchangeClient({ EPIC_EVENTS_CLIENT_ID: 'x', EPIC_EVENTS_CLIENT_SECRET: 'y' })).toEqual({ id: 'x', secret: 'y' });
  });

  it('upserts keys without touching other lines', () => {
    const before = '# comment\nEPIC_CLIENT_ID=abc\nEPIC_DEVICE_ID=\n';
    expect(upsertEnv(before, { EPIC_DEVICE_ID: 'dev', EPIC_ACCOUNT_ID: 'acc' })).toBe(
      '# comment\nEPIC_CLIENT_ID=abc\nEPIC_DEVICE_ID=dev\nEPIC_ACCOUNT_ID=acc\n',
    );
    expect(upsertEnv('', { A: '1' })).toBe('A=1\n');
  });
});

describe('probe args', () => {
  it('parses and validates regions', () => {
    expect(parseRegions(undefined)).toHaveLength(8);
    expect(parseRegions('nae, eu')).toEqual(['NAE', 'EU']);
    expect(() => parseRegions('NAE,MARS')).toThrow(/MARS/);
  });

  it('validates the rate test count', () => {
    expect(parseRateTest(undefined)).toBe(0);
    expect(parseRateTest('20')).toBe(20);
    expect(() => parseRateTest('abc')).toThrow();
    expect(() => parseRateTest('1000')).toThrow();
  });

  it('defaults the label to a filename-safe timestamp and rejects path tricks', () => {
    expect(parseLabel(undefined, new Date('2026-10-21T18:00:00.123Z'))).toBe('2026-10-21T18-00-00-123Z');
    expect(parseLabel('live-fncs', new Date())).toBe('live-fncs');
    for (const bad of ['../x', '..', 'a/b', '']) expect(() => parseLabel(bad, new Date())).toThrow();
  });
});

describe('sample window selection', () => {
  const now = new Date('2026-10-21T18:00:00Z');
  const t = (min: number) => new Date(now.getTime() + min * 60_000).toISOString();
  const download = {
    events: [
      {
        eventId: 'e1',
        eventWindows: [
          { eventWindowId: 'old', beginTime: t(-600), endTime: t(-500), payoutDelay: 30, eventTemplateId: 'duo' },
          { eventWindowId: 'recent', beginTime: t(-300), endTime: t(-200), payoutDelay: 30, eventTemplateId: 'solo' },
          { eventWindowId: 'wrap', beginTime: t(-100), endTime: t(-10), payoutDelay: 30 },
          { eventWindowId: 'live', beginTime: t(-5), endTime: t(60) },
          { eventWindowId: 'later', beginTime: t(500), endTime: t(600) },
          { eventWindowId: 'soon', beginTime: t(100), endTime: t(200) },
          { eventWindowId: 'broken' },
        ],
      },
      { eventWindows: [] },
    ],
    templates: [
      { eventTemplateId: 'duo', playlistId: 'Playlist_ShowdownTournament_Duos' },
      { eventTemplateId: 'solo', playlistId: 'Playlist_ShowdownTournament_Solo' },
    ],
  };

  it('skips malformed windows and joins playlists from templates', () => {
    const ws = listWindows(download);
    expect(ws.map((w) => w.windowId)).toEqual(['old', 'recent', 'wrap', 'live', 'later', 'soon']);
    expect(ws[0]!.playlistId).toBe('Playlist_ShowdownTournament_Duos');
    expect(listWindows(undefined)).toEqual([]);
    expect(listWindows({ events: 'nope' })).toEqual([]);
  });

  it('picks the most relevant window per state', () => {
    const s = pickSampleWindows(listWindows(download), now);
    expect(s.upcoming?.windowId).toBe('soon');
    expect(s.live?.windowId).toBe('live');
    expect(s.wrapping?.windowId).toBe('wrap');
    expect(s.final?.windowId).toBe('recent');
    expect(s.duos?.windowId).toBe('old');
  });

  it('guesses team size from playlist names', () => {
    expect(teamSizeHint('Playlist_X_Trios')).toBe(3);
    expect(teamSizeHint('Playlist_X_Squads')).toBe(4);
    expect(teamSizeHint('Playlist_X')).toBeUndefined();
    expect(teamSizeHint(undefined)).toBeUndefined();
  });
});

describe('createDeviceAuth', () => {
  function server(opts: { verifyFails?: boolean } = {}) {
    const seen: string[] = [];
    const f: FetchLike = async (url, init) => {
      const body = String(init?.body ?? '');
      seen.push(`${init?.method ?? 'GET'} ${new URL(url).pathname} ${body}`);
      if (url.endsWith('/oauth/token')) {
        if (body.startsWith('grant_type=authorization_code')) {
          return Response.json({ access_token: 'login-tok', account_id: 'acc1', displayName: 'Alt' });
        }
        if (opts.verifyFails) return Response.json({ errorCode: 'x' }, { status: 400 });
        return Response.json({ access_token: 'verify-tok', account_id: 'acc1' });
      }
      if (url.endsWith('/acc1/deviceAuth')) return Response.json({ accountId: 'acc1', deviceId: 'dev1', secret: 'sec1' });
      return new Response(null, { status: 204 });
    };
    return { f, seen };
  }

  it('logs in with the code, creates the device auth, verifies it, and kills both sessions', async () => {
    const { f, seen } = server();
    const out = await createDeviceAuth(f, { id: 'c', secret: 's' }, '  code123 ');
    expect(out).toEqual({ device: { accountId: 'acc1', deviceId: 'dev1', secret: 'sec1' }, displayName: 'Alt', verified: true });
    expect(seen).toEqual([
      'POST /account/api/oauth/token grant_type=authorization_code&code=code123',
      'POST /account/api/public/account/acc1/deviceAuth {}',
      'POST /account/api/oauth/token grant_type=device_auth&account_id=acc1&device_id=dev1&secret=sec1',
      'DELETE /account/api/oauth/sessions/kill/verify-tok ',
      'DELETE /account/api/oauth/sessions/kill/login-tok ',
    ]);
  });

  it('still returns the credentials if verification fails', async () => {
    const { f } = server({ verifyFails: true });
    const out = await createDeviceAuth(f, { id: 'c', secret: 's' }, 'code');
    expect(out.verified).toBe(false);
    expect(out.device.secret).toBe('sec1');
  });
});
