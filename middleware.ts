// Vercel Routing Middleware: runs before the CDN cache, so cached API responses
// are gated too (design decision D1). Only /api/login is open.

import { next } from '@vercel/functions/middleware';
import { isAuthorized } from './lib/auth/cookie.js';
import { apiError } from './lib/http.js';

export const config = { matcher: '/api/:path*' };

const OPEN_PATHS = new Set(['/api/login']);

export default async function middleware(request: Request): Promise<Response> {
  const { pathname } = new URL(request.url);
  if (OPEN_PATHS.has(pathname)) return next();
  if (await isAuthorized(request, process.env.COOKIE_SECRET)) return next();
  return apiError(401, 'unauthorized', 'Sign in first.');
}
