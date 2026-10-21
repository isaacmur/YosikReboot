// The calendar feed's subscribe link (F5). Its secret comes from the signed-in
// API (D21). Anyone with the link sees the schedule, and nothing else.

import { useState } from 'react';
import type { CalendarFeed, EventType, Region } from '../../lib/types';
import { useApi } from '../api';
import { REGION_LABEL, TYPE_LABEL } from '../format';
import { Button, LoadState } from './ui';

export function FeedPanel({ region, type }: { region: Region; type?: EventType }) {
  const { data, error, loading, reload } = useApi<CalendarFeed>('/api/ics', 10 * 60_000);
  const [copied, setCopied] = useState(false);
  if (!data) return <LoadState loading={loading} error={error} onRetry={reload} rows={1} />;
  if (!data.token)
    return (
      <p className="text-sm text-muted">
        The calendar feed is off. To turn it on, add an <code className="text-ink">ICS_TOKEN</code> environment variable
        to your Vercel project (16 characters or more, for example from{' '}
        <code className="text-ink">openssl rand -hex 16</code>) and redeploy.
      </p>
    );
  const url = `${location.origin}/api/ics?${new URLSearchParams({ token: data.token, region, ...(type ? { type } : {}) })}`;
  const copy = () =>
    void navigator.clipboard?.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  return (
    <div className="space-y-3 text-sm">
      <p className="text-muted">
        Sessions in {REGION_LABEL[region]}
        {type ? `, ${TYPE_LABEL[type]} only,` : ''} from two weeks back onward. Calendar apps check for changes about
        once an hour.
      </p>
      <div className="flex gap-2">
        <input
          readOnly
          value={url}
          onFocus={(e) => e.target.select()}
          aria-label="Calendar feed link"
          className="h-9 min-w-0 flex-1 rounded-md border border-line bg-bg px-3 font-mono text-xs text-muted outline-none focus:border-accent"
        />
        <Button onClick={copy}>{copied ? 'Copied' : 'Copy'}</Button>
      </div>
      <Button variant="primary" onClick={() => (window.location.href = url.replace(/^https?:/, 'webcal:'))}>
        Open in Calendar
      </Button>
      <ul className="space-y-1 text-xs text-muted">
        <li>Apple Calendar: Open in Calendar, or File, New Calendar Subscription, and paste the link.</li>
        <li>Google Calendar: Other calendars, +, From URL, and paste the link.</li>
        <li>Anyone with the link can see the schedule. Change ICS_TOKEN to turn old links off.</li>
      </ul>
    </div>
  );
}
