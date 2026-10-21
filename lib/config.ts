// Server-side configuration from environment variables (Vercel project settings,
// or .env.local for local tools). Never import this from src/.

import type { ClientCredentials, DeviceAuth } from './auth/epicToken.js';

export class ConfigError extends Error {
  constructor(readonly missing: string[]) {
    super(`Missing environment variables: ${missing.join(', ')}`);
    this.name = 'ConfigError';
  }
}

type Env = Record<string, string | undefined>;

function requireVars(env: Env, names: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  const missing: string[] = [];
  for (const n of names) {
    const v = env[n]?.trim();
    if (v) out[n] = v;
    else missing.push(n);
  }
  if (missing.length) throw new ConfigError(missing);
  return out;
}

export function authConfig(env: Env = process.env): { passphrase: string; cookieSecret: string } {
  const v = requireVars(env, ['APP_PASSPHRASE', 'COOKIE_SECRET']);
  return { passphrase: v.APP_PASSPHRASE!, cookieSecret: v.COOKIE_SECRET! };
}

export function epicConfig(env: Env = process.env): { client: ClientCredentials; device: DeviceAuth } {
  const v = requireVars(env, [
    'EPIC_CLIENT_ID',
    'EPIC_CLIENT_SECRET',
    'EPIC_ACCOUNT_ID',
    'EPIC_DEVICE_ID',
    'EPIC_DEVICE_SECRET',
  ]);
  return {
    client: { id: v.EPIC_CLIENT_ID!, secret: v.EPIC_CLIENT_SECRET! },
    device: { accountId: v.EPIC_ACCOUNT_ID!, deviceId: v.EPIC_DEVICE_ID!, secret: v.EPIC_DEVICE_SECRET! },
  };
}
