import type { HealthResponse } from '../../lib/types';
import { useApi } from '../api';
import { Card, LoadState, Pill, SectionTitle } from '../components/ui';
import { formatAgo, formatDateTime, useNow } from '../format';
import { useSettings } from '../settings';

const STATUS_STYLE: Record<HealthResponse['status'], string> = {
  ok: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  degraded: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  down: 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300',
};

export default function Health() {
  const { data, error, loading, reload } = useApi<HealthResponse>('/api/health', 0);
  const [{ timeZone }] = useSettings();
  const now = useNow(10_000);
  const fmt = (iso?: string) => (iso ? `${formatDateTime(iso, timeZone)} (${formatAgo(iso, now)})` : '—');

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">API health</h1>
        <button onClick={reload} className="text-sm font-medium text-blue-600 underline dark:text-blue-400">
          Refresh
        </button>
      </div>
      {!data ? (
        <LoadState loading={loading} error={error} onRetry={reload} />
      ) : (
        <>
          <p className="mt-3">
            <Pill className={`${STATUS_STYLE[data.status]} text-sm`}>{data.status.toUpperCase()}</Pill>
            <span className="ml-2 text-xs text-zinc-500">checked {formatAgo(data.checkedAt, now)}</span>
          </p>
          {data.missingConfig.length > 0 && (
            <p className="mt-2 text-sm text-rose-700 dark:text-rose-300">
              Missing environment variables: {data.missingConfig.join(', ')}
            </p>
          )}
          <SectionTitle>Epic token</SectionTitle>
          <Card className="p-3 text-sm">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
              <dt className="text-zinc-500">Minted</dt>
              <dd>{fmt(data.token.mintedAt)}</dd>
              <dt className="text-zinc-500">Expires</dt>
              <dd>{data.token.expiresAt ? formatDateTime(data.token.expiresAt, timeZone) : '—'}</dd>
              <dt className="text-zinc-500">Failures in a row</dt>
              <dd>{data.token.consecutiveFailures}</dd>
              {data.token.lastError && (
                <>
                  <dt className="text-zinc-500">Last error</dt>
                  <dd className="text-rose-700 dark:text-rose-300">{data.token.lastError}</dd>
                </>
              )}
            </dl>
          </Card>
          <SectionTitle>Recent Epic calls</SectionTitle>
          <Card className="overflow-x-auto">
            {data.upstream.recent.length ? (
              <table className="w-full text-left text-sm">
                <thead className="text-xs text-zinc-500">
                  <tr>
                    <th className="p-2 font-medium">When</th>
                    <th className="p-2 font-medium">Call</th>
                    <th className="p-2 font-medium">Status</th>
                    <th className="p-2 text-right font-medium">ms</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                  {data.upstream.recent.map((c, i) => (
                    <tr key={`${c.at}-${i}`}>
                      <td className="p-2 whitespace-nowrap">{formatAgo(c.at, now)}</td>
                      <td className="p-2">{c.label}</td>
                      <td
                        className={`p-2 ${c.status >= 200 && c.status < 400 ? '' : 'text-rose-700 dark:text-rose-300'}`}
                      >
                        {c.status || 'network'} {c.errorCode && <span className="text-xs">({c.errorCode})</span>}
                      </td>
                      <td className="p-2 text-right tabular-nums">{c.ms}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="p-3 text-sm text-zinc-500">No calls yet on this server instance.</p>
            )}
          </Card>
          <p className="mt-3 text-xs text-zinc-500">
            Each serverless instance keeps its own log since {formatAgo(data.instanceStartedAt, now)}, so this shows one
            instance's view.
          </p>
        </>
      )}
    </div>
  );
}
