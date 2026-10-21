// Usage:
//   npm run epic:device-auth -- --link [--expect NAME] [--write]
//   npm run epic:device-auth -- <authorizationCode> [--expect NAME] [--write]
//
// One-time setup for the *secondary* Epic account. --link prints a URL you open
// on any device, sign in and approve, so nothing secret is typed or pasted.
// --expect refuses to continue if a different account approved. --write saves
// the three EPIC_* device-auth variables to .env.local instead of printing them.

import { readFile, writeFile } from 'node:fs/promises';
import { endpoints } from '../lib/epic/endpoints';
import { argValue } from './probe/args';
import { createDeviceAuth, createDeviceAuthByLink, type CreatedDeviceAuth } from './deviceAuth';
import { loadLocalEnv, readClient, readDeviceCodeClient, upsertEnv } from './env';

const ENV_FILE = '.env.local';

async function main() {
  loadLocalEnv(ENV_FILE);
  const args = process.argv.slice(2);
  const write = args.includes('--write');
  const link = args.includes('--link');
  const expectDisplayName = argValue(args, '--expect');
  const code = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--expect');
  const doFetch = (i: string, init?: RequestInit) => fetch(i, init);

  const { client, missing } = readClient(process.env);
  if (!client) {
    console.error(`Missing ${missing.join(', ')}. Copy .env.example to ${ENV_FILE} first.`);
    process.exit(1);
  }

  let created: CreatedDeviceAuth;
  if (link) {
    const codeClient = readDeviceCodeClient(process.env);
    if (!codeClient) {
      console.error(`Missing EPIC_DEVICE_CODE_CLIENT_ID / EPIC_DEVICE_CODE_CLIENT_SECRET in ${ENV_FILE}.`);
      process.exit(1);
    }
    created = await createDeviceAuthByLink(
      doFetch,
      client,
      codeClient,
      (login) => {
        const mins = Math.round((login.expiresAt - Date.now()) / 60_000);
        console.log(`\nOpen this link, sign in${expectDisplayName ? ` as ${expectDisplayName}` : ''}, and approve:`);
        console.log(`  ${login.verificationUrl}`);
        console.log(`(code ${login.userCode}; expires in about ${mins} min; waiting...)\n`);
      },
      { expectDisplayName },
    );
  } else if (code) {
    created = await createDeviceAuth(doFetch, client, code, { expectDisplayName });
  } else {
    console.error(
      [
        'Usage: npm run epic:device-auth -- --link [--expect NAME] [--write]',
        '   or: npm run epic:device-auth -- <authorizationCode> [--expect NAME] [--write]',
        '',
        'For an authorization code: sign in to epicgames.com as the SECONDARY account, open',
        `  ${endpoints.authorizationCodeRedirect(client.id)}`,
        'and copy "authorizationCode" (it expires in a few minutes).',
      ].join('\n'),
    );
    process.exit(1);
  }

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
    console.log(`Saved to ${ENV_FILE}.`);
  } else {
    console.log('\nAdd these to .env.local and to Vercel (they are secrets):\n');
    for (const [k, v] of Object.entries(values)) console.log(`${k}=${v}`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
