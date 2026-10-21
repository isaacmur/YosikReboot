// Turns a raw probe capture into fixtures that are safe to publish. Account
// IDs become stable stand-ins (so joins between files still work), display
// names become PlayerNNNNN, country flags and spectate tokens are redacted.
// Shapes, ranks, points, event IDs, scoring and payout data are untouched.

import { REDACTED } from './scrub';

// Bounded by "not a hex digit" rather than \b, so IDs after an encoded
// separator (`%2C<id>`) or inside other words are still caught.
const HEX32 = /(?<![0-9a-f])[0-9a-f]{32}(?![0-9a-f])/g;
/** Stand-in IDs look like `f000…0042`: valid 32-char hex, obviously fake. */
const STAND_IN = /^f0+\d+$/;
const GEO = /^(GroupIdentity_GeoIdentity_).+$/;
const NAME_IN_URL = /(\/displayName\/)([^/?]+)/g;

/** Keys whose values are credentials or near enough. */
const REDACT_VALUE_KEYS = new Set(['liveSpectateAccessToken']);

export interface AnonymizerOptions {
  /** Public, non-personal IDs to leave alone (e.g. OAuth client IDs). */
  keepIds?: Iterable<string>;
}

export class Anonymizer {
  private readonly ids = new Map<string, string>();
  private readonly names = new Map<string, string>();
  private readonly keep: Set<string>;

  constructor(opts: AnonymizerOptions = {}) {
    this.keep = new Set(opts.keepIds ?? []);
  }

  /** How many distinct IDs and names were replaced so far. */
  get counts() {
    return { ids: this.ids.size, names: this.names.size };
  }

  id(real: string): string {
    if (this.keep.has(real) || STAND_IN.test(real)) return real;
    let v = this.ids.get(real);
    if (!v) {
      v = `f${String(this.ids.size + 1).padStart(31, '0')}`;
      this.ids.set(real, v);
    }
    return v;
  }

  name(real: string): string {
    if (/^Player\d{5}$/.test(real)) return real;
    let v = this.names.get(real);
    if (!v) {
      v = `Player${String(this.names.size + 1).padStart(5, '0')}`;
      this.names.set(real, v);
    }
    return v;
  }

  private text(s: string): string {
    return s.replace(HEX32, (m) => this.id(m));
  }

  /** Anonymizes one parsed JSON document. Use one instance per capture so IDs stay consistent across files. */
  value(v: unknown, key?: string): unknown {
    if (typeof v === 'string') {
      if (key === 'displayName') return this.name(v);
      if (key && REDACT_VALUE_KEYS.has(key)) return v ? REDACTED : v;
      if (GEO.test(v)) return v.replace(GEO, `$1${REDACTED}`);
      if (key === 'url') {
        v = v.replace(NAME_IN_URL, (_, pre: string, n: string) => `${pre}${this.name(decodeURIComponent(n))}`);
      }
      return this.text(v as string);
    }
    if (Array.isArray(v)) return v.map((x) => this.value(x, key));
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v)) out[this.text(k)] = this.value(x, k);
      return out;
    }
    return v;
  }
}

export interface Leaks {
  ids: number;
  names: number;
  countries: number;
  tokens: number;
}

/**
 * Independent check of anonymized output: collects every ID, display name,
 * country flag and spectate token from the raw documents and counts how many
 * still appear anywhere in the output text.
 */
export function findLeaks(rawDocs: unknown[], outputText: string, keepIds: Iterable<string> = []): Leaks {
  const keep = new Set(keepIds);
  const ids = new Set<string>();
  const names = new Set<string>();
  const countries = new Set<string>();
  const tokens = new Set<string>();
  const walk = (v: unknown, key?: string): void => {
    if (typeof v === 'string') {
      for (const m of v.match(HEX32) ?? []) if (!keep.has(m) && !STAND_IN.test(m)) ids.add(m);
      if (key === 'displayName' && !/^Player\d{5}$/.test(v)) names.add(v);
      if (key && REDACT_VALUE_KEYS.has(key) && v && v !== REDACTED) tokens.add(v);
      const geo = /^GroupIdentity_GeoIdentity_(.+)$/.exec(v);
      if (geo && geo[1] !== REDACTED) countries.add(v);
    } else if (Array.isArray(v)) v.forEach((x) => walk(x, key));
    else if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) {
        walk(k);
        walk(x, k);
      }
    }
  };
  rawDocs.forEach((d) => walk(d));
  const count = (set: Set<string>, present: (s: string) => boolean) => [...set].filter(present).length;
  return {
    ids: count(ids, (s) => outputText.includes(s)),
    names: count(names, (s) => outputText.includes(JSON.stringify(s)) || outputText.includes(`/displayName/${encodeURIComponent(s)}`)),
    countries: count(countries, (s) => outputText.includes(s)),
    tokens: count(tokens, (s) => outputText.includes(s)),
  };
}

/** Files that hold no player data and are published as captured. */
export const PASS_THROUGH = new Set(['cms-tournamentinformation.json']);
