import type { ButtonHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';
import { useEffect, useRef, useState } from 'react';
import type { EventState } from '../../lib/status';
import type { EventArt, WindowState } from '../../lib/types';
import { formatCountdown } from '../format';
import { ChevronDown, XIcon } from './icons';

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

// --- Status ------------------------------------------------------------------

const STATE: Record<WindowState | EventState, { label: string; tone: string }> = {
  live: { label: 'Live', tone: 'bg-live text-white' },
  wrapping: { label: 'Settling', tone: 'bg-wrap text-black' },
  upcoming: { label: 'Upcoming', tone: 'bg-soon text-soon-ink' },
  final: { label: 'Final', tone: 'bg-raised text-muted' },
  ended: { label: 'Ended', tone: 'bg-raised text-muted' },
};

/** Slanted status tag; "Live" pulses. */
export function StateTag({ state, className }: { state: WindowState | EventState; className?: string }) {
  const s = STATE[state];
  return (
    <span className={cx('skew inline-flex rounded-[3px] px-2 py-0.5', s.tone, className)}>
      <span className="flex items-center gap-1.5 font-display text-[13px] leading-4 font-bold tracking-wider uppercase">
        {state === 'live' && <span className="live-dot size-1.5 rounded-full bg-white" aria-hidden />}
        {s.label}
      </span>
    </span>
  );
}

/** Flat label chip for event facts (type, mode, team size). */
export function Chip({ children, tone = 'plain' }: { children: ReactNode; tone?: 'plain' | 'accent' | 'onArt' }) {
  const tones = {
    plain: 'border-line text-muted',
    accent: 'border-accent/40 bg-accent-soft text-accent-bright',
    onArt: 'border-white/20 bg-black/35 text-white/90 backdrop-blur-sm',
  };
  return (
    <span
      className={cx(
        'inline-flex items-center rounded-[4px] border px-1.5 py-px text-[11px] font-semibold whitespace-nowrap',
        tones[tone],
      )}
    >
      {children}
    </span>
  );
}

// --- Surfaces and text -----------------------------------------------------------

export function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('rounded-lg border border-line bg-surface', className)}>{children}</div>;
}

export function SectionHeader({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="mt-8 mb-3 flex items-end justify-between gap-3 first:mt-0">
      <h2 className="font-display text-lg leading-none font-bold tracking-wide uppercase">{title}</h2>
      {action && <div className="text-sm">{action}</div>}
    </div>
  );
}

export function PageTitle({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <div className="mb-5">
      <h1 className="font-display text-3xl leading-none font-bold tracking-wide uppercase">{children}</h1>
      {sub && <p className="mt-2 text-sm text-muted">{sub}</p>}
    </div>
  );
}

// --- Controls ------------------------------------------------------------------

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
};

export function Button({ variant = 'secondary', size = 'md', className, ...rest }: ButtonProps) {
  const variants = {
    primary: 'bg-accent text-accent-ink hover:brightness-110',
    secondary: 'border border-line-strong bg-raised text-ink hover:border-faint',
    ghost: 'text-accent-bright hover:bg-accent-soft',
  };
  const sizes = { sm: 'h-8 px-3 text-xs', md: 'h-9 px-4 text-sm', lg: 'h-11 px-5 text-sm' };
  return (
    <button
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-md font-semibold transition disabled:pointer-events-none disabled:opacity-45',
        variants[variant],
        sizes[size],
        className,
      )}
      {...rest}
    />
  );
}

const PILL_TONES = {
  plain: { box: 'border-line-strong bg-raised hover:border-faint', text: 'text-ink', icon: 'text-muted' },
  /** A filter that's switched on. */
  active: { box: 'border-accent/60 bg-accent-soft', text: 'text-ink', icon: 'text-accent-bright' },
  /** On top of tournament art. */
  onArt: {
    box: 'border-white/20 bg-black/45 backdrop-blur-sm hover:bg-black/60',
    text: 'text-white',
    icon: 'text-white/75',
  },
};

/** Native select (best picker on phones) dressed as a pill. */
export function PillSelect({
  icon,
  tone = 'plain',
  className,
  children,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & { icon?: ReactNode; tone?: keyof typeof PILL_TONES }) {
  const t = PILL_TONES[tone];
  return (
    <label className={cx('relative inline-flex h-9 items-center rounded-md border text-sm', t.box, className)}>
      {icon && <span className={cx('pointer-events-none absolute left-2.5', t.icon)}>{icon}</span>}
      <select
        className={cx(
          'h-full w-full cursor-pointer appearance-none bg-transparent pr-8 font-semibold outline-none',
          t.text,
          icon ? 'pl-8' : 'pl-3',
        )}
        {...rest}
      >
        {children}
      </select>
      <ChevronDown size={16} className={cx('pointer-events-none absolute right-2', t.icon)} />
    </label>
  );
}

/** Underline tabs with a slanted accent marker. */
export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
}: {
  tabs: { id: T; label: ReactNode }[];
  value: T;
  onChange: (id: T) => void;
  label: string;
}) {
  return (
    <div role="tablist" aria-label={label} className="no-scrollbar flex gap-5 overflow-x-auto border-b border-line">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={t.id === value}
          onClick={() => onChange(t.id)}
          className={cx(
            'relative shrink-0 pb-2.5 font-display text-[15px] font-bold tracking-wide uppercase transition',
            t.id === value ? 'text-ink' : 'text-faint hover:text-muted',
          )}
        >
          {t.label}
          {t.id === value && <span className="skew absolute inset-x-0 -bottom-px h-[3px] bg-accent" aria-hidden />}
        </button>
      ))}
    </div>
  );
}

/** Compact segmented control that scrolls sideways when it doesn't fit (Ranked Cup tiers). */
export function Segmented<T extends string>({
  items,
  value,
  onChange,
  label,
}: {
  items: { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
  label: string;
}) {
  return (
    <div role="tablist" aria-label={label} className="no-scrollbar -mx-4 flex gap-1.5 overflow-x-auto px-4">
      {items.map((it) => (
        <button
          key={it.id}
          role="tab"
          aria-selected={it.id === value}
          onClick={() => onChange(it.id)}
          className={cx(
            'h-8 shrink-0 rounded-md px-3 text-xs font-bold tracking-wide uppercase transition',
            it.id === value ? 'bg-accent text-accent-ink' : 'border border-line bg-surface text-muted hover:text-ink',
          )}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

/**
 * A native modal dialog: a bottom sheet on phones, a centered panel on wider
 * screens. Escape, the close button and a tap outside all close it.
 */
export function Sheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (open && !d?.open) d?.showModal();
    if (!open && d?.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-label={title}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className="m-0 mt-auto max-h-[88dvh] w-full max-w-none rounded-t-xl border border-line-strong bg-surface p-0 text-ink shadow-2xl backdrop:bg-black/60 backdrop:backdrop-blur-[2px] sm:m-auto sm:max-w-lg sm:rounded-xl"
    >
      {open && (
        <div className="flex max-h-[88dvh] flex-col">
          <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
            <h2 className="font-display text-lg leading-none font-bold tracking-wide uppercase">{title}</h2>
            <button
              onClick={onClose}
              aria-label="Close"
              className="grid size-8 place-items-center rounded-md text-muted transition hover:bg-raised hover:text-ink"
            >
              <XIcon size={16} />
            </button>
          </div>
          <div className="overflow-y-auto overscroll-contain p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            {children}
          </div>
        </div>
      )}
    </dialog>
  );
}

// --- Time ----------------------------------------------------------------------

export function Countdown({ to, now, prefix = 'in' }: { to: string; now: Date; prefix?: string }) {
  return (
    <span className="nums">
      {prefix && `${prefix} `}
      {formatCountdown(Date.parse(to) - now.getTime())}
    </span>
  );
}

// --- Loading, empty and error states -------------------------------------------------

/** Pass a `rounded-*` class to change the corners (classes here never compete with the caller's). */
export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={cx('animate-pulse bg-raised', !/\brounded/.test(className) && 'rounded-md', className)} />;
}

export function ListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2" aria-busy aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-16" />
      ))}
    </div>
  );
}

export function Empty({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-line-strong px-4 py-8 text-center text-sm text-muted">
      <p>{children}</p>
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function ErrorNote({ error, onRetry }: { error: Error; onRetry?: () => void }) {
  return (
    <div className="rounded-lg border border-live/40 bg-live/10 px-4 py-3 text-sm">
      <p>Couldn't load this: {error.message}</p>
      {onRetry && (
        <button onClick={onRetry} className="mt-1 font-semibold text-accent-bright underline underline-offset-2">
          Try again
        </button>
      )}
    </div>
  );
}

export function LoadState({
  loading,
  error,
  onRetry,
  rows,
}: {
  loading: boolean;
  error?: Error;
  onRetry?: () => void;
  rows?: number;
}) {
  if (error) return <ErrorNote error={error} onRetry={onRetry} />;
  if (loading) return <ListSkeleton rows={rows} />;
  return null;
}

// --- Tournament art ----------------------------------------------------------------

/** Epic's image CDN resizes on request (`?resize=1&w=`), so thumbnails stay small. */
export function artSrc(url: string, width: number): string {
  const w = Math.round(width * Math.min(globalThis.devicePixelRatio || 1, 2));
  return `${url}${url.includes('?') ? '&' : '?'}resize=1&w=${w}`;
}

/** The event's own colors as a gradient: the fallback when there's no art, and the tint behind it. */
export function artGradient(art: EventArt): string {
  const a = art.left ? `#${art.left}` : '#2a1a4a';
  const b = art.right ? `#${art.right}` : art.primary ? `#${art.primary}` : '#120c22';
  return `linear-gradient(135deg, ${a}, ${b})`;
}

export function Art({
  art,
  kind,
  width,
  fill,
  className,
  imgClassName,
}: {
  art: EventArt;
  /** Preferred image; falls back through the others, then to the event colors. */
  kind: 'square' | 'tile' | 'background';
  width: number;
  /** Cover the nearest positioned parent instead of sizing itself. */
  fill?: boolean;
  className?: string;
  imgClassName?: string;
}) {
  const order = {
    square: ['square', 'tile', 'background'],
    tile: ['tile', 'background', 'square'],
    background: ['background', 'tile', 'square'],
  } as const;
  const url = order[kind].map((k) => art[k]).find(Boolean);
  const [failedUrl, setFailedUrl] = useState<string>();
  return (
    <div
      className={cx(fill ? 'absolute inset-0' : 'relative', 'overflow-hidden', className)}
      style={{ backgroundImage: artGradient(art) }}
    >
      {url && url !== failedUrl && (
        <img
          key={url}
          src={artSrc(url, width)}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setFailedUrl(url)}
          className={cx('absolute inset-0 size-full object-cover', imgClassName)}
        />
      )}
    </div>
  );
}
