import type { ClientCredentials, DeviceAuth } from '../lib/auth/epicToken';

type Env = Record<string, string | undefined>;

/** Loads .env.local into process.env if it exists (Node's built-in loader). */
export function loadLocalEnv(path = '.env.local'): void {
  try {
    process.loadEnvFile(path);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
}

function pick(env: Env, names: string[]): { values: Record<string, string>; missing: string[] } {
  const values: Record<string, string> = {};
  const missing: string[] = [];
  for (const n of names) {
    const v = env[n]?.trim();
    if (v) values[n] = v;
    else missing.push(n);
  }
  return { values, missing };
}

export function readClient(env: Env): { client?: ClientCredentials; missing: string[] } {
  const { values, missing } = pick(env, ['EPIC_CLIENT_ID', 'EPIC_CLIENT_SECRET']);
  if (missing.length) return { missing };
  return { client: { id: values.EPIC_CLIENT_ID!, secret: values.EPIC_CLIENT_SECRET! }, missing };
}

/** The optional second client; returns undefined unless both halves are set. */
export function readExchangeClient(env: Env): ClientCredentials | undefined {
  const id = env.EPIC_EVENTS_CLIENT_ID?.trim();
  const secret = env.EPIC_EVENTS_CLIENT_SECRET?.trim();
  return id && secret ? { id, secret } : undefined;
}

/** Client for the device code (link) sign-in; returns undefined unless both halves are set. */
export function readDeviceCodeClient(env: Env): ClientCredentials | undefined {
  const id = env.EPIC_DEVICE_CODE_CLIENT_ID?.trim();
  const secret = env.EPIC_DEVICE_CODE_CLIENT_SECRET?.trim();
  return id && secret ? { id, secret } : undefined;
}

export function readDevice(env: Env): { device?: DeviceAuth; missing: string[] } {
  const { values, missing } = pick(env, ['EPIC_ACCOUNT_ID', 'EPIC_DEVICE_ID', 'EPIC_DEVICE_SECRET']);
  if (missing.length) return { missing };
  return {
    device: {
      accountId: values.EPIC_ACCOUNT_ID!,
      deviceId: values.EPIC_DEVICE_ID!,
      secret: values.EPIC_DEVICE_SECRET!,
    },
    missing,
  };
}

/** Sets or replaces KEY=value lines in a .env file's text, keeping everything else. */
export function upsertEnv(text: string, values: Record<string, string>): string {
  const lines = text.length ? text.replace(/\n$/, '').split('\n') : [];
  const remaining = new Map(Object.entries(values));
  const out = lines.map((line) => {
    const m = /^\s*([A-Z0-9_]+)\s*=/.exec(line);
    const key = m?.[1];
    if (key && remaining.has(key)) {
      const v = remaining.get(key)!;
      remaining.delete(key);
      return `${key}=${v}`;
    }
    return line;
  });
  for (const [k, v] of remaining) out.push(`${k}=${v}`);
  return `${out.join('\n')}\n`;
}
