import { useMemo, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { REGIONS, type Region } from '../../lib/types';
import { logout } from '../api';
import { ActivityIcon, ChevronRight, LogOutIcon, UsersIcon } from '../components/icons';
import { Button, PageTitle, Panel, PillSelect, SectionHeader } from '../components/ui';
import { REGION_LABEL, zoneAbbrev } from '../format';
import { DEFAULT_SETTINGS, useSettings } from '../settings';

function timeZones(): string[] {
  try {
    return Intl.supportedValuesOf('timeZone');
  } catch {
    return [DEFAULT_SETTINGS.timeZone];
  }
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3">
      <span className="min-w-0">
        <span className="block text-sm font-semibold">{label}</span>
        {hint && <span className="block text-xs text-muted">{hint}</span>}
      </span>
      {children}
    </div>
  );
}

function LinkRow({ to, icon, label }: { to: string; icon: ReactNode; label: string }) {
  return (
    <Link to={to} className="flex items-center gap-3 px-4 py-3 text-sm font-semibold transition hover:bg-raised/60">
      <span className="text-accent-bright">{icon}</span>
      <span className="flex-1">{label}</span>
      <ChevronRight size={16} className="text-faint" />
    </Link>
  );
}

export default function Settings() {
  const [settings, update] = useSettings();
  const navigate = useNavigate();
  const zones = useMemo(timeZones, []);

  return (
    <div className="max-w-2xl">
      <PageTitle sub="Saved in this browser only.">Settings</PageTitle>
      <Panel className="divide-y divide-line">
        <Row label="Region" hint="Whose schedule you see">
          <PillSelect
            value={settings.region}
            onChange={(e) => update({ region: e.target.value as Region })}
            aria-label="Region"
          >
            {REGIONS.map((r) => (
              <option key={r} value={r}>
                {REGION_LABEL[r]}
              </option>
            ))}
          </PillSelect>
        </Row>
        <Row label="Time zone" hint="For every date and time">
          <PillSelect
            value={settings.timeZone}
            onChange={(e) => update({ timeZone: e.target.value })}
            aria-label="Time zone"
            className="max-w-[55%]"
          >
            {(zones.includes(settings.timeZone) ? zones : [settings.timeZone, ...zones]).map((z) => (
              <option key={z} value={z}>
                {z.replace(/_/g, ' ')} ({zoneAbbrev(z)})
              </option>
            ))}
          </PillSelect>
        </Row>
        <Row label="Live refresh" hint="How often a live leaderboard updates">
          <PillSelect
            value={settings.refreshSec}
            onChange={(e) => update({ refreshSec: Number(e.target.value) })}
            aria-label="Live refresh"
          >
            {[30, 60, 120, 300].map((s) => (
              <option key={s} value={s}>
                {s < 60 ? `${s} s` : `${s / 60} min`}
              </option>
            ))}
          </PillSelect>
        </Row>
      </Panel>

      <SectionHeader title="More" />
      <Panel className="divide-y divide-line">
        <LinkRow to="/follows" icon={<UsersIcon size={17} />} label="Follows" />
        <LinkRow to="/health" icon={<ActivityIcon size={17} />} label="API health" />
      </Panel>

      <Button
        className="mt-6"
        onClick={async () => {
          await logout();
          navigate('/login', { replace: true });
        }}
      >
        <LogOutIcon size={15} /> Sign out
      </Button>
    </div>
  );
}
