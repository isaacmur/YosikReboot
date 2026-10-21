import type { HealthResponse } from '../../lib/types';
import { useApi } from '../api';
import { RefreshIcon } from '../components/icons';
import { Button, Empty, LoadState, PageTitle, Panel, SectionHeader } from '../components/ui';
import { formatAgo, formatDateTime, useNow } from '../format';
import { useSettings } from '../settings';

const STATUS: Record<HealthResponse['status'], { label: string; tone: string }> = {
  ok: { label: 'All good', tone: 'bg-ok text-black' },
  degraded: { label: 'Degraded', tone: 'bg-wrap text-black' },
  down: { label: 'Down', tone: 'bg-live text-white' },
};

export default function Health() {
  const { data, error, loading, reload } = useApi<HealthResponse>('/api/health', 0);
  const [{ timeZone }] = useSettings();
  const now = useNow(10_000);
  const fmt = (iso?: string) => (iso ? `${formatDateTime(iso, timeZone)} (${formatAgo(iso, now)})` : '—');

  return (
    <div className="max-w-3xl">
      <div className="flex items-start justify-between gap-3">
        <PageTitle sub="What the server's Epic connection looks like right now.">API health</PageTitle>
        <Button size="sm" onClick={reload}>
          <RefreshIcon size={14} className={loading ? 'animate-spin' : ''} /> Refresh
        </Button>
      </div>
      {!data ? (
        <LoadState loading={loading} error={error} onRetry={reload} />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <span className={`skew inline-flex rounded-[4px] px-3 py-1 ${STATUS[data.status].tone}`}>
              <span className="font-display text-xl leading-6 font-bold tracking-wide uppercase">
                {STATUS[data.status].label}
              </span>
            </span>
            <span className="text-xs text-muted">checked {formatAgo(data.checkedAt, now)}</span>
          </div>
          {data.missingConfig.length > 0 && (
            <p className="mt-3 rounded-md border border-live/40 bg-live/10 px-3 py-2 text-sm">
              Missing environment variables: {data.missingConfig.join(', ')}
            </p>
          )}

          <SectionHeader title="Epic token" />
          <Panel className="p-4 text-sm">
            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5">
              <dt className="text-muted">Minted</dt>
              <dd>{fmt(data.token.mintedAt)}</dd>
              <dt className="text-muted">Expires</dt>
              <dd>{data.token.expiresAt ? formatDateTime(data.token.expiresAt, timeZone) : '—'}</dd>
              <dt className="text-muted">Failures in a row</dt>
              <dd className="nums">{data.token.consecutiveFailures}</dd>
              {data.token.lastError && (
                <>
                  <dt className="text-muted">Last error</dt>
                  <dd className="text-live">{data.token.lastError}</dd>
                </>
              )}
            </dl>
          </Panel>

          <SectionHeader title="Recent Epic calls" />
          {data.upstream.recent.length ? (
            <Panel className="overflow-x-auto">
              <table className="nums w-full text-left text-sm">
                <thead className="text-[10px] tracking-wider text-faint uppercase">
                  <tr className="border-b border-line">
                    <th className="px-3 py-2 font-semibold">When</th>
                    <th className="px-3 py-2 font-semibold">Call</th>
                    <th className="px-3 py-2 font-semibold">Status</th>
                    <th className="px-3 py-2 text-right font-semibold">ms</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {data.upstream.recent.map((c, i) => (
                    <tr key={`${c.at}-${i}`}>
                      <td className="px-3 py-2 whitespace-nowrap text-muted">{formatAgo(c.at, now)}</td>
                      <td className="px-3 py-2">{c.label}</td>
                      <td className={`px-3 py-2 ${c.status >= 200 && c.status < 400 ? 'text-ok' : 'text-live'}`}>
                        {c.status || 'network'} {c.errorCode && <span className="text-xs">({c.errorCode})</span>}
                      </td>
                      <td className="px-3 py-2 text-right text-muted">{c.ms}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panel>
          ) : (
            <Empty>No calls yet on this server instance.</Empty>
          )}
          <p className="mt-3 text-xs text-faint">
            Each serverless instance keeps its own log, this one since {formatAgo(data.instanceStartedAt, now)}, so this
            is one instance's view.
          </p>
        </>
      )}
    </div>
  );
}
