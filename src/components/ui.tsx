import type { ReactNode } from 'react';
import type { EventState } from '../../lib/status';
import type { WindowState } from '../../lib/types';
import { formatCountdown } from '../format';

export function Pill({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${className}`}
    >
      {children}
    </span>
  );
}

export const TAG = 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300';

const STATE_STYLE: Record<WindowState | EventState, [string, string]> = {
  live: ['Live', 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300'],
  wrapping: ['Wrapping up', 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'],
  upcoming: ['Upcoming', 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300'],
  final: ['Final', TAG],
  ended: ['Ended', TAG],
};

export function StateBadge({ state }: { state: WindowState | EventState }) {
  const [label, style] = STATE_STYLE[state];
  return (
    <Pill className={style}>
      {state === 'live' && (
        <span className="relative flex size-2" aria-hidden>
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-rose-500 opacity-75" />
          <span className="relative inline-flex size-2 rounded-full bg-rose-500" />
        </span>
      )}
      {label}
    </Pill>
  );
}

/** "in 2h 13m" / "ends in 41m 05s", from a `now` the caller ticks. */
export function Countdown({ to, now, prefix = 'in' }: { to: string; now: Date; prefix?: string }) {
  return (
    <span className="tabular-nums">
      {prefix} {formatCountdown(Date.parse(to) - now.getTime())}
    </span>
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900 ${className}`}>
      {children}
    </div>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h2 className="mt-6 mb-2 text-sm font-semibold tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
      {children}
    </h2>
  );
}

/** Loading and error states for a fetched section. */
export function LoadState({ loading, error, onRetry }: { loading: boolean; error?: Error; onRetry?: () => void }) {
  if (error) {
    return (
      <Card className="p-4 text-sm">
        <p className="text-rose-700 dark:text-rose-300">Couldn't load this: {error.message}</p>
        {onRetry && (
          <button onClick={onRetry} className="mt-2 font-medium text-blue-600 underline dark:text-blue-400">
            Try again
          </button>
        )}
      </Card>
    );
  }
  if (loading) return <p className="py-6 text-center text-sm text-zinc-500">Loading…</p>;
  return null;
}

export const SELECT =
  'rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900';
