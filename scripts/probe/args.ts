import { REGIONS, type Region } from '../../lib/types';

export function argValue(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
}

export function parseRegions(value: string | undefined): Region[] {
  if (!value) return [...REGIONS];
  const wanted = value.split(',').map((r) => r.trim().toUpperCase());
  const bad = wanted.filter((r) => !(REGIONS as readonly string[]).includes(r));
  if (bad.length) throw new Error(`Unknown region(s): ${bad.join(', ')}. Use ${REGIONS.join(', ')}.`);
  return wanted as Region[];
}

export function parseRateTest(value: string | undefined): number {
  if (value === undefined) return 0;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 200) throw new Error('--rate-test takes a whole number from 0 to 200');
  return n;
}

const LABEL = /^[\w.-]+$/;

export function parseLabel(value: string | undefined, now: Date): string {
  const label = value ?? now.toISOString().replace(/[:.]/g, '-');
  if (!LABEL.test(label) || label === '.' || label === '..') {
    throw new Error('--label may only contain letters, digits, _ . -');
  }
  return label;
}
