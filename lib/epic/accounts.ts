// Display names for account IDs (leaderboards carry IDs only, D3), via Epic's
// bulk lookup (max 100 per call), remembered per warm instance for a day.

import type { EpicClient } from './client.js';
import { BULK_ACCOUNT_LIMIT, chunk, endpoints } from './endpoints.js';
import { asArr, asObj, str } from './json.js';

const NAME_TTL_MS = 24 * 60 * 60_000;
const names = new Map<string, { at: number; name: string }>();

export async function resolveNames(client: EpicClient, ids: string[], now = Date.now()): Promise<Map<string, string>> {
  const missing = [...new Set(ids)].filter((id) => {
    const hit = names.get(id);
    return !hit || now - hit.at > NAME_TTL_MS;
  });
  for (const batch of chunk(missing, BULK_ACCOUNT_LIMIT)) {
    const body = await client.getJson(endpoints.accountsById(batch), `names x${batch.length}`);
    for (const a of asArr(body)) {
      const id = str(asObj(a)?.id);
      const name = str(asObj(a)?.displayName);
      if (id && name) names.set(id, { at: now, name });
    }
  }
  const out = new Map<string, string>();
  for (const id of ids) {
    const hit = names.get(id);
    if (hit) out.set(id, hit.name);
  }
  return out;
}

export async function lookupByName(
  client: EpicClient,
  displayName: string,
): Promise<{ id: string; displayName: string }> {
  const body = asObj(await client.getJson(endpoints.accountByName(displayName), 'name lookup'));
  const id = str(body?.id);
  const name = str(body?.displayName);
  if (!id || !name) throw new Error('Unexpected account lookup response');
  names.set(id, { at: Date.now(), name });
  return { id, displayName: name };
}

export function clearNameCache(): void {
  names.clear();
}
