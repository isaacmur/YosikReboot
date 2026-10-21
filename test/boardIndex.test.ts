// Reading board pages a few at a time, with retries (D26).

import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearIndex, indexedPages, litePage, readPage, runPool } from '../src/boardIndex';

const page = (n: number) => ({
  eventId: 'e',
  windowId: 'w',
  board: 'b',
  page: n,
  totalPages: 5,
  fetchedAt: '',
  entries: [],
});

describe('runPool', () => {
  it('keeps at most `limit` jobs running, in order', async () => {
    let running = 0;
    let most = 0;
    const started: number[] = [];
    await runPool([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      started.push(n);
      running++;
      most = Math.max(most, running);
      await new Promise((r) => setTimeout(r, 5));
      running--;
    });
    expect(most).toBe(3);
    expect(started).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('starts nothing new once told to stop, and stops on the first failure', async () => {
    const started: number[] = [];
    await runPool(
      [1, 2, 3, 4, 5],
      1,
      async (n) => void started.push(n),
      () => started.length >= 2,
    );
    expect(started).toEqual([1, 2]);

    started.length = 0;
    await expect(
      runPool([1, 2, 3, 4], 1, async (n) => {
        started.push(n);
        if (n === 2) throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(started).toEqual([1, 2]);
  });
});

describe('readPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('waits and retries when the API is overloaded, but not on other errors', async () => {
    vi.useFakeTimers();
    const statuses = [503, 502, 200];
    let calls = 0;
    vi.stubGlobal('fetch', async () => {
      const status = statuses[calls++]!;
      return status === 200
        ? Response.json(page(0))
        : Response.json({ error: { code: 'epic_rate_limited', message: 'slow down' } }, { status });
    });
    const read = readPage({ event: 'e', window: 'w', board: 'b', page: 0, lite: true });
    await vi.advanceTimersByTimeAsync(7000);
    await expect(read).resolves.toMatchObject({ page: 0 });
    expect(calls).toBe(3);

    calls = 0;
    vi.stubGlobal('fetch', async () => {
      calls++;
      return Response.json({ error: { code: 'bad_page', message: 'page must be 0-99.' } }, { status: 400 });
    });
    await expect(readPage({ event: 'e', window: 'w', board: 'b', page: 0 })).rejects.toThrow('page must be 0-99.');
    expect(calls).toBe(1);
  });
});

describe('litePage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    clearIndex();
  });

  it('keeps final pages, and live ones for a minute', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      urls.push(url);
      return Response.json(page(Number(new URL(url, 'https://app.test').searchParams.get('page'))));
    });
    const q = { event: 'e', window: 'w', board: 'b' };
    await litePage({ ...q, page: 1 }, { final: true });
    await litePage({ ...q, page: 1 }, { final: true });
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain('lite=1');
    expect(indexedPages(q)).toBe(1);

    let t = 0;
    const now = () => t;
    const live = { event: 'e', window: 'live', board: 'b' };
    await litePage({ ...live, page: 0 }, { final: false, now });
    t = 59_000;
    await litePage({ ...live, page: 0 }, { final: false, now });
    expect(urls).toHaveLength(2);
    t = 61_000;
    await litePage({ ...live, page: 0 }, { final: false, now });
    expect(urls).toHaveLength(3);
  });
});
