// Loads the compiled API routes and middleware as plain Node ESM, the way Vercel
// runs them, so an import that only resolves under a bundler (e.g. a missing
// `.js` extension) fails here instead of in production. Exercises only paths
// that need no network.

const SECRET = 'smoke-cookie-secret-0123456789';
process.env.APP_PASSPHRASE = 'smoke-passphrase';
process.env.COOKIE_SECRET = SECRET;
for (const k of Object.keys(process.env)) if (k.startsWith('EPIC_')) delete process.env[k];

const root = new URL('../.api-smoke/', import.meta.url);
const load = (p) => import(new URL(p, root).href);

const login = await load('api/login.js');
const events = await load('api/events.js');
const health = await load('api/health.js');
const leaderboard = await load('api/leaderboard.js');
const windowRoute = await load('api/window.js');
const player = await load('api/player.js');
const ics = await load('api/ics.js');
const sync = await load('api/sync.js');
const replay = await load('api/replay.js');
const middleware = (await load('middleware.js')).default;

let failed = 0;
const check = (name, ok) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`);
  if (!ok) failed++;
};

const loginRes = await login.POST(
  new Request('https://smoke.test/api/login', {
    method: 'POST',
    body: JSON.stringify({ passphrase: 'smoke-passphrase' }),
  }),
);
const cookie = loginRes.headers.get('set-cookie') ?? '';
check('login sets a session cookie', loginRes.status === 200 && cookie.startsWith('yr_session=v1.'));

const blocked = await middleware(new Request('https://smoke.test/api/events?region=NAE'));
check('middleware blocks without a session', blocked.status === 401);
const passed = await middleware(
  new Request('https://smoke.test/api/events?region=NAE', { headers: { cookie: cookie.split(';')[0] } }),
);
check('middleware passes a valid session', passed.headers.get('x-middleware-next') === '1');

const badRegion = await events.GET(new Request('https://smoke.test/api/events?region=XX'));
check('events rejects a bad region', badRegion.status === 400);

const badBoard = await leaderboard.GET(new Request('https://smoke.test/api/leaderboard?window=x'));
check('leaderboard rejects missing event', badBoard.status === 400);
const badWindow = await windowRoute.GET(new Request('https://smoke.test/api/window?event=e'));
check('window rejects missing window', badWindow.status === 400);
const badPlayer = await player.GET(new Request('https://smoke.test/api/player?ids=nothex'));
check('player rejects bad ids', badPlayer.status === 400);

const syncBad = await sync.POST(new Request('https://smoke.test/api/sync?step=nope', { method: 'POST' }));
check('sync rejects an unknown step', syncBad.status === 400);
const syncRows = await sync.POST(new Request('https://smoke.test/api/sync?step=rows', { method: 'POST', body: '{}' }));
check('sync refuses rows without a sign-in', syncRows.status === 409);
const syncHistory = await sync.POST(
  new Request('https://smoke.test/api/sync?step=history', { method: 'POST', body: '{"events":["e_NAC"]}' }),
);
check('sync refuses history without a sign-in', syncHistory.status === 409);
const syncEnd = await sync.DELETE(new Request('https://smoke.test/api/sync', { method: 'DELETE' }));
check(
  'sync end clears its cookie',
  syncEnd.status === 200 && /Max-Age=0/.test(syncEnd.headers.get('set-cookie') ?? ''),
);

const badMatch = await replay.GET(new Request('https://smoke.test/api/replay?match=nope'));
check('replay rejects a bad match ID', badMatch.status === 400);

process.env.ICS_TOKEN = 'smoke-feed-token-0123456789';
const feedOk = await middleware(new Request('https://smoke.test/api/ics?token=smoke-feed-token-0123456789'));
check('middleware passes the calendar feed on its token', feedOk.headers.get('x-middleware-next') === '1');
const feedBad = await middleware(new Request('https://smoke.test/api/ics?token=guess'));
check('middleware blocks a wrong calendar token', feedBad.status === 401);
const feedLink = await ics.GET(new Request('https://smoke.test/api/ics'));
check('feed link needs a session', feedLink.status === 401);

const h = await (await health.GET()).json();
check('health reports missing Epic config', h.status === 'down' && h.missingConfig.includes('EPIC_DEVICE_SECRET'));

if (failed) {
  console.error(`${failed} smoke check(s) failed`);
  process.exit(1);
}
