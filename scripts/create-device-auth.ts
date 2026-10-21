// Usage: npm run epic:device-auth -- <authorizationCode> [--write]
//
// Run locally once, signed in to the *secondary* Epic account. Prints the three
// EPIC_* device-auth variables; --write also saves them to .env.local.

import { readFile, writeFile } from 'node:fs/promises';
import { endpoints } from '../lib/epic/endpoints';
import { createDeviceAuth } from './deviceAuth';
import { loadLocalEnv, readClient, upsertEnv } from './env';

const ENV_FILE = '.env.local';

async function main() {
  loadLocalEnv(ENV_FILE);
  const args = process.argv.slice(2);
  const write = args.includes('--write');
  const code = args.find((a) => !a.startsWith('--'));

  const { client, missing } = readClient(process.env);
  if (!client) {
    console.error(`Missing ${missing.join(', ')}. Copy .env.example to ${ENV_FILE} first.`);
    process.exit(1);
  }
  if (!code) {
    console.error(
      [
        'Usage: npm run epic:device-auth -- <authorizationCode> [--write]',
        '',
        '1. In a browser, sign in to epicgames.com as the SECONDARY account.',
        `2. Open ${endpoints.authorizationCodeRedirect(client.id)}`,
        '3. Copy the "authorizationCode" value from the JSON (it expires in a few minutes).',
        '4. Run this command with it.',
      ].join('\n'),
    );
    process.exit(1);
  }

  const created = await createDeviceAuth((i, init) => fetch(i, init), client, code);
  const values = {
    EPIC_ACCOUNT_ID: created.device.accountId,
    EPIC_DEVICE_ID: created.device.deviceId,
    EPIC_DEVICE_SECRET: created.device.secret,
  };
  console.log(`Device auth created for ${created.displayName ?? created.device.accountId}.`);
  console.log(created.verified ? 'Verified: a token was minted from it.' : 'WARNING: minting from it failed; check the client ID.');

  if (write) {
    let existing = '';
    try {
      existing = await readFile(ENV_FILE, 'utf8');
    } catch {
      // New file.
    }
    await writeFile(ENV_FILE, upsertEnv(existing, values), { mode: 0o600 });
    console.log(`Saved to ${ENV_FILE}. Also add these three to Vercel's environment variables.`);
  } else {
    console.log('\nAdd these to .env.local and to Vercel (they are secrets):\n');
    for (const [k, v] of Object.entries(values)) console.log(`${k}=${v}`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
