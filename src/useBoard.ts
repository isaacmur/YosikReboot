// The pages of one leaderboard loaded in this view (F14). Each refresh re-reads
// page 0, the loaded pages on screen and the watched pages (follows' rows and
// cutoffs); a watched page that isn't loaded is read in lite mode, just for its
// ranks and points. Other pages load as you scroll or jump. A page's newest copy
// always wins, so refreshes and on-demand loads can land in any order.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import type { LeaderboardPage, WindowState } from '../lib/types';
import { apiGet, AuthError } from './api';
import { useLive, type LiveQuery } from './live';
import { forgetBoard, recordPage } from './movement';

/** Loaded pages re-read per refresh besides page 0, and lite pages. */
const MAX_REFRESH = 4;
const MAX_LITE = 3;

type Pages = Record<number, LeaderboardPage>;

export interface BoardPages {
  /** Pages shown, with names and matches. */
  pages: Pages;
  /** Watched pages that aren't shown, read without names. */
  lite: Pages;
  totalPages: number;
  live: LiveQuery<true>;
  /** Pages loading on request. */
  pending: number[];
  loadError?: Error;
  loadPage: (page: number, lite?: boolean) => Promise<void>;
  /** Ref for a page's block of rows, so the pages on screen are the ones that refresh. */
  observe: (page: number) => (el: HTMLElement | null) => () => void;
}

export function useBoard(o: {
  eventId: string;
  windowId: string;
  board: string;
  state: WindowState;
  liveMs: number;
  /** Pages to keep fresh besides the ones on screen. */
  watch: () => number[];
}): BoardPages {
  const navigate = useNavigate();
  const location = useLocation();
  const boardKey = `${o.eventId}|${o.windowId}|${o.board}`;
  const query = useCallback(
    (page: number, lite: boolean) =>
      new URLSearchParams({
        event: o.eventId,
        window: o.windowId,
        board: o.board,
        page: String(page),
        ...(lite ? { lite: '1' } : {}),
      }).toString(),
    [o.eventId, o.windowId, o.board],
  );
  const [pages, setPages] = useState<Pages>({});
  const [lite, setLite] = useState<Pages>({});
  const [pending, setPending] = useState<number[]>([]);
  const [loadError, setLoadError] = useState<Error>();
  const pagesRef = useRef(pages);
  pagesRef.current = pages;
  const watchRef = useRef(o.watch);
  watchRef.current = o.watch;
  const tracking = o.state === 'live' || o.state === 'wrapping';
  const trackRef = useRef(tracking);
  trackRef.current = tracking;

  useEffect(() => {
    if (o.state === 'final') forgetBoard(boardKey);
  }, [o.state, boardKey]);

  const accept = useCallback(
    (p: LeaderboardPage, isLite: boolean) => {
      if (trackRef.current) recordPage(boardKey, p);
      (isLite ? setLite : setPages)((prev) =>
        prev[p.page] && prev[p.page]!.fetchedAt > p.fetchedAt ? prev : { ...prev, [p.page]: p },
      );
    },
    [boardKey],
  );

  // --- Pages on screen
  const visible = useRef(new Set<number>());
  const observer = useRef<IntersectionObserver>(undefined);
  const refs = useRef(new Map<number, (el: HTMLElement | null) => () => void>());
  const observe = useCallback((page: number) => {
    let ref = refs.current.get(page);
    if (!ref) {
      ref = (el) => {
        observer.current ??= new IntersectionObserver((entries) => {
          for (const e of entries) {
            const p = Number((e.target as HTMLElement).dataset.page);
            if (e.isIntersecting) visible.current.add(p);
            else visible.current.delete(p);
          }
        });
        if (el) observer.current.observe(el);
        return () => {
          if (el) observer.current?.unobserve(el);
          visible.current.delete(page);
        };
      };
      refs.current.set(page, ref);
    }
    return ref;
  }, []);
  useEffect(() => () => observer.current?.disconnect(), []);

  // --- Scheduled refreshes
  const load = async (): Promise<true> => {
    const loaded = pagesRef.current;
    const watched = watchRef.current();
    const full = new Set([0]);
    for (const p of [...visible.current, ...watched]) if (loaded[p] && full.size <= MAX_REFRESH) full.add(p);
    const liteWanted = [...new Set(watched)].filter((p) => !loaded[p]).slice(0, MAX_LITE);
    const jobs: [number, boolean][] = [...[...full].map((p): [number, boolean] => [p, false])];
    for (const p of liteWanted) jobs.push([p, true]);
    const results = await Promise.allSettled(
      jobs.map(([p, l]) => apiGet<LeaderboardPage>(`/api/leaderboard?${query(p, l)}`)),
    );
    let failure: unknown;
    results.forEach((r, i) => {
      if (r.status === 'fulfilled') accept(r.value, jobs[i]![1]);
      else failure ??= r.reason;
    });
    if (failure) throw failure;
    return true;
  };
  const live = useLive(query(0, false), load, o.state, o.liveMs);

  // --- Pages on request (scrolling, jumping, cutoffs)
  const inFlight = useRef(new Map<string, Promise<void>>());
  const loadPage = useCallback(
    (page: number, isLite = false) => {
      const q = query(page, isLite);
      const running = inFlight.current.get(q);
      if (running) return running;
      if (!isLite) {
        setPending((p) => [...p, page]);
        setLoadError(undefined);
      }
      const job = apiGet<LeaderboardPage>(`/api/leaderboard?${q}`)
        .then((p) => accept(p, isLite))
        .catch((err: Error) => {
          if (err instanceof AuthError) navigate('/login', { replace: true, state: { from: location.pathname } });
          else if (!isLite) setLoadError(err);
        })
        .finally(() => {
          inFlight.current.delete(q);
          if (!isLite) setPending((p) => p.filter((x) => x !== page));
        });
      inFlight.current.set(q, job);
      return job;
    },
    [query, accept, navigate, location.pathname],
  );

  const newest = Object.values(pages).reduce<LeaderboardPage | undefined>(
    (best, p) => (!best || p.fetchedAt > best.fetchedAt ? p : best),
    undefined,
  );
  return {
    pages,
    lite,
    totalPages: newest?.totalPages ?? 0,
    live,
    pending,
    loadError,
    loadPage,
    observe,
  };
}
