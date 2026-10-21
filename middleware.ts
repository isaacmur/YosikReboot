// Vercel Routing Middleware: runs before the CDN cache, so cached API responses
// are gated too (design decision D1). Only /api/login is open. The calendar feed
// (/api/ics with a `token`) is unlocked by its own secret instead of the cookie,
// because calendar apps can't send cookies (D21).

import { next } from '@vercel/functions/middleware';
import { feedTokenMatches, isAuthorized } from './lib/auth/cookie.js';
import { apiError } from './lib/http.js';

export const config = { matcher: '/api/:path*' };

const OPEN_PATHS = new Set(['/api/login']);

export default async function middleware(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const { pathname } = url;
  if (OPEN_PATHS.has(pathname)) return next();
  if (pathname === '/api/ics' && url.searchParams.has('token')) {
    if (await feedTokenMatches(url.searchParams.get('token'), process.env.ICS_TOKEN?.trim())) return next();
    return apiError(401, 'unauthorized', 'This calendar link is wrong or turned off.');
  }
  if (await isAuthorized(request, process.env.COOKIE_SECRET)) return next();
  return apiError(401, 'unauthorized', 'Sign in first.');
}
