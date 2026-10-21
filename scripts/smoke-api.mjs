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

const h = await (await health.GET()).json();
check('health reports missing Epic config', h.status === 'down' && h.missingConfig.includes('EPIC_DEVICE_SECRET'));

if (failed) {
  console.error(`${failed} smoke check(s) failed`);
  process.exit(1);
}
