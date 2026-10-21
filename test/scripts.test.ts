import { describe, expect, it } from 'vitest';
import type { FetchLike } from '../lib/auth/epicToken';
import {
  createDeviceAuth,
  createDeviceAuthByLink,
  WrongAccountError,
  type DeviceCodeLogin,
} from '../scripts/deviceAuth';
import { readClient, readDevice, readDeviceCodeClient, readExchangeClient, upsertEnv } from '../scripts/env';
import { parseLabel, parseRateTest, parseRegions } from '../scripts/probe/args';
import { REDACTED, sanitizeAccount, sanitizeToken, scrub } from '../scripts/probe/scrub';
import { listWindows, pickSampleWindows, teamSizeHint } from '../scripts/probe/select';

describe('scrub', () => {
  it('redacts credential keys at any depth, case-insensitively', () => {
    const out = scrub({ access_token: 'a', nested: [{ Secret: 's', deviceId: 'd', keep: 1 }], refresh_token: 'r' });
    expect(out).toEqual({
      access_token: REDACTED,
      nested: [{ Secret: REDACTED, deviceId: REDACTED, keep: 1 }],
      refresh_token: REDACTED,
    });
  });

  it('replaces known secret values inside any string', () => {
    expect(scrub({ url: 'https://x/kill/abcdefgh12345?y' }, ['abcdefgh12345'])).toEqual({
      url: `https://x/kill/${REDACTED}?y`,
    });
  });

  it('ignores short or empty secrets so it cannot shred ordinary text', () => {
    expect(scrub('a b c', ['a', '', undefined])).toBe('a b c');
  });

  it('leaves competitive token lists alone (key is "tokens", not a credential)', () => {
    expect(scrub({ tokens: ['ARENA_S99_Division1'] })).toEqual({ tokens: ['ARENA_S99_Division1'] });
  });
});

describe('sanitizeAccount / sanitizeToken', () => {
  it('keeps id and displayName, redacts everything else but keeps the keys', () => {
    expect(sanitizeAccount([{ id: 'a', displayName: 'n', email: 'e@x', externalAuths: { psn: {} } }])).toEqual([
      { id: 'a', displayName: 'n', email: REDACTED, externalAuths: REDACTED },
    ]);
  });

  it('leaves Epic error bodies alone', () => {
    const err = { errorCode: 'errors.com.epicgames.account.invalid_account_id_count', errorMessage: 'm' };
    expect(sanitizeAccount(err)).toEqual(err);
  });

  it('drops only personal fields from the token response', () => {
    expect(sanitizeToken({ country: 'US', expires_in: 7200 })).toEqual({ country: REDACTED, expires_in: 7200 });
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
    expect(readExchangeClient({ EPIC_EVENTS_CLIENT_ID: 'x', EPIC_EVENTS_CLIENT_SECRET: 'y' })).toEqual({
      id: 'x',
      secret: 'y',
    });
    expect(readDeviceCodeClient({ EPIC_DEVICE_CODE_CLIENT_ID: 'x' })).toBeUndefined();
    expect(readDeviceCodeClient({ EPIC_DEVICE_CODE_CLIENT_ID: 'x', EPIC_DEVICE_CODE_CLIENT_SECRET: 'y' })).toEqual({
      id: 'x',
      secret: 'y',
    });
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
      if (url.endsWith('/acc1/deviceAuth'))
        return Response.json({ accountId: 'acc1', deviceId: 'dev1', secret: 'sec1' });
      return new Response(null, { status: 204 });
    };
    return { f, seen };
  }

  it('logs in with the code, creates the device auth, verifies it, and kills both sessions', async () => {
    const { f, seen } = server();
    const out = await createDeviceAuth(f, { id: 'c', secret: 's' }, '  code123 ');
    expect(out).toEqual({
      device: { accountId: 'acc1', deviceId: 'dev1', secret: 'sec1' },
      displayName: 'Alt',
      verified: true,
    });
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

describe('createDeviceAuth: expected account guard', () => {
  it('refuses a different account and signs that session out', async () => {
    const seen: string[] = [];
    const f: FetchLike = async (url, init) => {
      seen.push(`${init?.method ?? 'GET'} ${new URL(url).pathname}`);
      if (url.endsWith('/oauth/token'))
        return Response.json({ access_token: 'main-tok', account_id: 'main', displayName: 'MyMainAccount' });
      return new Response(null, { status: 204 });
    };
    const err = await createDeviceAuth(f, { id: 'c', secret: 's' }, 'code', {
      expectDisplayName: 'MyAltAccount',
    }).catch((e) => e);
    expect(err).toBeInstanceOf(WrongAccountError);
    expect(err.message).toMatch(/Signed in as MyMainAccount, not MyAltAccount/);
    expect(seen).toEqual(['POST /account/api/oauth/token', 'DELETE /account/api/oauth/sessions/kill/main-tok']);
  });
});

describe('createDeviceAuthByLink', () => {
  const app = { id: 'android', secret: 'a' };
  const switchClient = { id: 'switch', secret: 'b' };

  // Synthetic: walks the device code flow (client token -> link -> pending x2 -> approved).
  function server(opts: { pending?: number; displayName?: string; slowDown?: boolean; deny?: boolean } = {}) {
    const seen: string[] = [];
    let polls = 0;
    const f: FetchLike = async (url, init) => {
      const body = String(init?.body ?? '');
      const auth = new Headers(init?.headers).get('authorization') ?? '';
      const path = new URL(url).pathname;
      seen.push(`${init?.method ?? 'GET'} ${path} ${body}`.trim());
      if (path.endsWith('/oauth/token')) {
        const grant = new URLSearchParams(body).get('grant_type');
        if (grant === 'client_credentials') return Response.json({ access_token: 'client-tok' });
        if (grant === 'device_code') {
          polls += 1;
          if (opts.deny)
            return Response.json(
              { errorCode: 'errors.com.epicgames.account.oauth.authorization_denied' },
              { status: 400 },
            );
          if (opts.slowDown && polls === 1)
            return Response.json({ errorCode: 'errors.com.epicgames.account.oauth.slow_down' }, { status: 400 });
          if (polls <= (opts.pending ?? 2))
            return Response.json(
              { errorCode: 'errors.com.epicgames.account.oauth.authorization_pending' },
              { status: 400 },
            );
          return Response.json({ access_token: 'switch-tok', account_id: 'alt' });
        }
        if (grant === 'exchange_code') {
          expect(auth).toBe(`basic ${Buffer.from('android:a').toString('base64')}`);
          return Response.json({
            access_token: 'android-tok',
            account_id: 'alt',
            displayName: opts.displayName ?? 'MyAltAccount',
          });
        }
        if (grant === 'device_auth') return Response.json({ access_token: 'verify-tok', account_id: 'alt' });
      }
      if (path.endsWith('/oauth/deviceAuthorization')) {
        expect(auth).toBe('bearer client-tok');
        return Response.json({
          user_code: 'ABCD1234',
          device_code: 'dc-1',
          verification_uri: 'https://www.epicgames.com/activate',
          verification_uri_complete: 'https://www.epicgames.com/activate?userCode=ABCD1234',
          expires_in: 600,
          interval: 10,
        });
      }
      if (path.endsWith('/oauth/exchange')) {
        expect(auth).toBe('bearer switch-tok');
        return Response.json({ code: 'xchg' });
      }
      if (path.endsWith('/alt/deviceAuth')) {
        expect(auth).toBe('bearer android-tok');
        return Response.json({ accountId: 'alt', deviceId: 'dev', secret: 'sec' });
      }
      return new Response(null, { status: 204 });
    };
    return { f, seen, polls: () => polls };
  }

  function clock() {
    let t = 0;
    const waits: number[] = [];
    return { now: () => t, sleep: async (ms: number) => void (waits.push(ms), (t += ms)), waits };
  }

  it('shows the link, waits for approval, exchanges into the app client, and creates the device auth there', async () => {
    const { f, seen, polls } = server();
    const c = clock();
    let shown: DeviceCodeLogin | undefined;
    const out = await createDeviceAuthByLink(f, app, switchClient, (l) => (shown = l), {
      ...c,
      expectDisplayName: 'myaltaccount',
    });
    expect(shown).toMatchObject({
      verificationUrl: 'https://www.epicgames.com/activate?userCode=ABCD1234',
      userCode: 'ABCD1234',
      expiresAt: 600_000,
    });
    expect(polls()).toBe(3);
    expect(c.waits).toEqual([10_000, 10_000, 10_000]);
    expect(out).toEqual({
      device: { accountId: 'alt', deviceId: 'dev', secret: 'sec' },
      displayName: 'MyAltAccount',
      verified: true,
    });
    expect(seen.filter((l) => l.startsWith('DELETE'))).toEqual([
      'DELETE /account/api/oauth/sessions/kill/switch-tok',
      'DELETE /account/api/oauth/sessions/kill/verify-tok',
      'DELETE /account/api/oauth/sessions/kill/android-tok',
    ]);
  });

  it('backs off by 5 s when Epic says slow_down', async () => {
    const { f } = server({ pending: 1, slowDown: true });
    const c = clock();
    await createDeviceAuthByLink(f, app, switchClient, () => {}, c);
    expect(c.waits).toEqual([10_000, 15_000]);
  });

  it('gives up when the link expires', async () => {
    const { f } = server({ pending: 1000 });
    const c = clock();
    await expect(createDeviceAuthByLink(f, app, switchClient, () => {}, c)).rejects.toThrow(
      /expired before it was approved/,
    );
    expect(c.waits).toHaveLength(60);
  });

  it('stops on a real error such as a denied approval', async () => {
    const { f } = server({ deny: true });
    await expect(createDeviceAuthByLink(f, app, switchClient, () => {}, clock())).rejects.toMatchObject({
      errorCode: 'errors.com.epicgames.account.oauth.authorization_denied',
    });
  });

  it('refuses when someone other than the expected account approves', async () => {
    const { f, seen } = server({ displayName: 'MyMainAccount' });
    await expect(
      createDeviceAuthByLink(f, app, switchClient, () => {}, { ...clock(), expectDisplayName: 'MyAltAccount' }),
    ).rejects.toBeInstanceOf(WrongAccountError);
    expect(seen.some((l) => l.includes('/alt/deviceAuth'))).toBe(false);
  });
});
