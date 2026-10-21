import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin, ViteDevServer } from 'vite';
import { defineConfig } from 'vitest/config';

/**
 * Dev only: serves /api/* from the real handlers in api/, behind the real
 * middleware.ts, so `npm run dev` behaves like Vercel. Reads .env.local.
 */
function devApi(): Plugin {
  return {
    name: 'yosik-dev-api',
    apply: 'serve',
    configureServer(server: ViteDevServer) {
      try {
        process.loadEnvFile('.env.local');
      } catch {
        // No .env.local: routes report missing config.
      }
      server.middlewares.use('/api', (req, res, nextMiddleware) => {
        handle(server, req, res).catch(nextMiddleware);
      });
    },
  };
}

/** Request body as text; the API only takes JSON. */
async function readBody(req: IncomingMessage): Promise<string | undefined> {
  if (req.method === 'GET' || req.method === 'HEAD') return undefined;
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

async function handle(server: ViteDevServer, req: IncomingMessage, res: ServerResponse) {
  // Connect strips the /api mount point from req.url.
  const url = new URL(`/api${req.url ?? ''}`, `http://${req.headers.host ?? 'localhost'}`);
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
  const request = new Request(url, { method: req.method, headers, body: await readBody(req) });

  const send = async (r: Response) => {
    res.statusCode = r.status;
    r.headers.forEach((value, key) => {
      if (key !== 'set-cookie') res.setHeader(key, value);
    });
    const cookies = r.headers.getSetCookie();
    if (cookies.length) res.setHeader('set-cookie', cookies);
    res.end(Buffer.from(await r.arrayBuffer()));
  };

  const gate = await server.ssrLoadModule('/middleware.ts');
  const verdict: Response = await gate.default(request);
  if (verdict.headers.get('x-middleware-next') !== '1') return send(verdict);

  const name = url.pathname.replace(/^\/api\//, '').replace(/\/$/, '');
  if (!/^[a-z-]+$/.test(name)) return send(new Response('Not found', { status: 404 }));
  let mod: Record<string, unknown>;
  try {
    mod = await server.ssrLoadModule(`/api/${name}.ts`);
  } catch {
    return send(new Response('Not found', { status: 404 }));
  }
  const handler = mod[request.method];
  if (typeof handler !== 'function') return send(new Response('Method not allowed', { status: 405 }));
  return send(await (handler as (r: Request) => Promise<Response> | Response)(request));
}

export default defineConfig({
  plugins: [react(), tailwindcss(), devApi()],
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
