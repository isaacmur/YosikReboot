import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router';
import { REGIONS, type Region } from '../../lib/types';
import { logout } from '../api';
import { Card, SELECT } from '../components/ui';
import { REGION_LABEL, zoneAbbrev } from '../format';
import { DEFAULT_SETTINGS, useSettings } from '../settings';

function timeZones(): string[] {
  try {
    return Intl.supportedValuesOf('timeZone');
  } catch {
    return [DEFAULT_SETTINGS.timeZone];
  }
}

export default function Settings() {
  const [settings, update] = useSettings();
  const navigate = useNavigate();
  const zones = useMemo(timeZones, []);

  return (
    <div>
      <h1 className="text-xl font-semibold">Settings</h1>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">Saved in this browser only.</p>
      <Card className="mt-4 divide-y divide-zinc-200 dark:divide-zinc-800">
        <label className="flex items-center justify-between gap-4 p-3">
          <span className="text-sm font-medium">Default region</span>
          <select
            value={settings.region}
            onChange={(e) => update({ region: e.target.value as Region })}
            className={SELECT}
          >
            {REGIONS.map((r) => (
              <option key={r} value={r}>
                {REGION_LABEL[r]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center justify-between gap-4 p-3">
          <span className="text-sm font-medium">Time zone</span>
          <select
            value={settings.timeZone}
            onChange={(e) => update({ timeZone: e.target.value })}
            className={`${SELECT} max-w-[55%]`}
          >
            {(zones.includes(settings.timeZone) ? zones : [settings.timeZone, ...zones]).map((z) => (
              <option key={z} value={z}>
                {z.replace(/_/g, ' ')} ({zoneAbbrev(z)})
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center justify-between gap-4 p-3">
          <span className="text-sm font-medium">
            Live board refresh
            <span className="block text-xs font-normal text-zinc-500">Used by live leaderboards (Phase 2)</span>
          </span>
          <select
            value={settings.refreshSec}
            onChange={(e) => update({ refreshSec: Number(e.target.value) })}
            className={SELECT}
          >
            {[30, 60, 120, 300].map((s) => (
              <option key={s} value={s}>
                {s < 60 ? `${s} s` : `${s / 60} min`}
              </option>
            ))}
          </select>
        </label>
      </Card>
      <div className="mt-6 flex items-center justify-between">
        <span className="flex gap-4">
          <Link to="/follows" className="text-sm font-medium text-blue-600 underline dark:text-blue-400">
            Follows
          </Link>
          <Link to="/health" className="text-sm font-medium text-blue-600 underline dark:text-blue-400">
            API health
          </Link>
        </span>
        <button
          onClick={async () => {
            await logout();
            navigate('/login', { replace: true });
          }}
          className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium dark:border-zinc-700"
        >
          Sign out
        </button>
      </div>
    </div>
  );
}
