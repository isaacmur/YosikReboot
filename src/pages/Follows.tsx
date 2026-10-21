import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import type { PlayerLookup } from '../../lib/types';
import { ApiError, apiGet } from '../api';
import { DownloadIcon, PlusIcon, SearchIcon, UploadIcon, XIcon } from '../components/icons';
import { Button, Chip, Empty, PageTitle, Panel, SectionHeader } from '../components/ui';
import { saveFile } from '../csv';
import {
  addFollow,
  exportFollows,
  importFollows,
  removeFollow,
  renameFollows,
  setMe,
  useFollows,
  type Follow,
} from '../follows';
import { plural } from '../format';
import { removeTeam, saveTeam, useTeams } from '../teams';

let namesRefreshed = false;

/** Saved teams (F24): duos and trios that stay together on every board. */
function Teams({ follows }: { follows: Follow[] }) {
  const teams = useTeams();
  const [draft, setDraft] = useState<{ name: string; ids: string[] }>();
  const picked = draft?.ids ?? [];
  const toggle = (id: string) =>
    setDraft(
      (d) => d && { ...d, ids: d.ids.includes(id) ? d.ids.filter((x) => x !== id) : [...d.ids, id].slice(0, 4) },
    );
  const save = (e: FormEvent) => {
    e.preventDefault();
    if (!draft) return;
    const members = follows.filter((f) => draft.ids.includes(f.id)).map((f) => ({ id: f.id, name: f.name }));
    saveTeam(draft.name.trim() || members.map((m) => m.name).join(' / '), members);
    setDraft(undefined);
  };
  return (
    <>
      <SectionHeader
        title="Teams"
        action={
          follows.length >= 2 &&
          !draft && (
            <Button size="sm" variant="ghost" onClick={() => setDraft({ name: '', ids: [] })}>
              <PlusIcon size={14} /> New team
            </Button>
          )
        }
      />
      {draft && (
        <Panel className="mb-3 p-3">
          <form onSubmit={save} className="space-y-3">
            <input
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder="Team name (optional)"
              aria-label="Team name"
              maxLength={32}
              className="h-9 w-full rounded-md border border-line bg-surface px-3 text-sm outline-none placeholder:text-faint focus:border-accent"
            />
            <fieldset>
              <legend className="text-xs text-muted">Pick 2 to 4 players</legend>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {follows.map((f) => (
                  <label
                    key={f.id}
                    className={`inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border px-2.5 text-xs font-semibold ${picked.includes(f.id) ? 'border-accent/60 bg-accent-soft' : 'border-line bg-raised'}`}
                  >
                    <input
                      type="checkbox"
                      checked={picked.includes(f.id)}
                      onChange={() => toggle(f.id)}
                      className="accent-[var(--accent)]"
                    />
                    {f.name}
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="flex gap-2">
              <Button type="submit" variant="primary" size="sm" disabled={picked.length < 2}>
                Save team
              </Button>
              <Button type="button" size="sm" onClick={() => setDraft(undefined)}>
                Cancel
              </Button>
            </div>
          </form>
        </Panel>
      )}
      {teams.length ? (
        <Panel className="overflow-hidden">
          <ul className="divide-y divide-line">
            {teams.map((t) => (
              <li key={t.key} className="flex items-center gap-3 px-3 py-2.5">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{t.name}</span>
                  <span className="block truncate text-xs text-muted">{t.members.map((m) => m.name).join(' / ')}</span>
                </span>
                <button
                  onClick={() => removeTeam(t.key)}
                  aria-label={`Remove team ${t.name}`}
                  className="grid size-8 shrink-0 place-items-center rounded-md text-faint transition hover:bg-live/10 hover:text-live"
                >
                  <XIcon size={16} />
                </button>
              </li>
            ))}
          </ul>
        </Panel>
      ) : (
        !draft && (
          <Empty>
            Save duos and trios as teams to see them pinned together on every board. Pick players here, or tap a row on
            a leaderboard and choose Save as team.
          </Empty>
        )
      )}
    </>
  );
}

export default function Follows() {
  const follows = useFollows();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string }>();
  const fileRef = useRef<HTMLInputElement>(null);

  // Display names change: refresh them once per visit to the app.
  useEffect(() => {
    if (namesRefreshed || !follows.length) return;
    namesRefreshed = true;
    apiGet<PlayerLookup[]>(`/api/player?ids=${follows.map((f) => f.id).join(',')}`)
      .then((list) => renameFollows(new Map(list.map((p) => [p.id, p.displayName]))))
      .catch(() => {});
  }, [follows]);

  async function add(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(undefined);
    try {
      const p = await apiGet<PlayerLookup>(`/api/player?name=${encodeURIComponent(name.trim())}`);
      if (follows.some((f) => f.id === p.id)) setMessage({ ok: true, text: `You already follow ${p.displayName}.` });
      else {
        addFollow(p.id, p.displayName);
        setMessage({ ok: true, text: `Following ${p.displayName}.` });
        setName('');
      }
    } catch (err) {
      setMessage({ ok: false, text: err instanceof ApiError ? err.message : 'Lookup failed.' });
    } finally {
      setBusy(false);
    }
  }

  async function importFile(file: File) {
    try {
      const n = importFollows(await file.text());
      const added = [n.follows && plural(n.follows, 'follow'), n.teams && plural(n.teams, 'team')].filter(Boolean);
      setMessage({ ok: true, text: added.length ? `Added ${added.join(' and ')}.` : 'Nothing new to add.' });
    } catch {
      setMessage({ ok: false, text: "That file isn't a YosikReboot follow list." });
    }
  }

  return (
    <div>
      <PageTitle
        sub={
          <>
            Saved in this browser. Mark one as you to see your results on{' '}
            <Link to="/me" className="font-semibold text-accent-bright hover:underline">
              Me
            </Link>
            .
          </>
        }
      >
        Follows
      </PageTitle>

      <form onSubmit={add} className="flex gap-2">
        <label className="relative min-w-0 flex-1">
          <SearchIcon size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-faint" />
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Epic display name"
            aria-label="Epic display name"
            required
            className="h-9 w-full rounded-md border border-line bg-surface pr-3 pl-9 text-sm outline-none placeholder:text-faint focus:border-accent"
          />
        </label>
        <Button type="submit" variant="primary" disabled={busy || !name.trim()}>
          {busy ? 'Finding…' : 'Follow'}
        </Button>
      </form>
      {message && (
        <p role="status" className={`mt-2 text-sm ${message.ok ? 'text-ok' : 'text-live'}`}>
          {message.text}
        </p>
      )}

      <div className="mt-4">
        {follows.length ? (
          <Panel className="overflow-hidden">
            <ul className="divide-y divide-line">
              {follows.map((f) => (
                <li key={f.id} className="flex items-center gap-3 px-3 py-2.5">
                  <span
                    className={`skew grid size-9 shrink-0 place-items-center rounded-[4px] ${f.isMe ? 'bg-accent' : 'bg-raised'}`}
                  >
                    <span
                      className={`font-display text-lg font-bold ${f.isMe ? 'text-accent-ink' : 'text-accent-bright'}`}
                    >
                      {f.name.slice(0, 1).toUpperCase()}
                    </span>
                  </span>
                  <span className="flex min-w-0 flex-1 items-center gap-2">
                    <Link to={`/players/${f.id}`} className="truncate font-semibold hover:underline">
                      {f.name}
                    </Link>
                    {f.isMe && <Chip tone="accent">You</Chip>}
                  </span>
                  <Button size="sm" variant="ghost" onClick={() => setMe(f.isMe ? null : f.id)}>
                    {f.isMe ? 'Not me' : 'This is me'}
                  </Button>
                  <button
                    onClick={() => removeFollow(f.id)}
                    aria-label={`Remove ${f.name}`}
                    className="grid size-8 shrink-0 place-items-center rounded-md text-faint transition hover:bg-live/10 hover:text-live"
                  >
                    <XIcon size={16} />
                  </button>
                </li>
              ))}
            </ul>
          </Panel>
        ) : (
          <Empty>No follows yet. Add yourself first, then anyone you want to keep an eye on.</Empty>
        )}
      </div>

      <Teams follows={follows} />

      <SectionHeader title="Move to another device" />
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          onClick={() => saveFile('yosikreboot-follows.json', exportFollows(), 'application/json')}
          disabled={!follows.length}
        >
          <DownloadIcon size={14} /> Export list
        </Button>
        <Button size="sm" onClick={() => fileRef.current?.click()}>
          <UploadIcon size={14} /> Import list
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void importFile(file);
            e.target.value = '';
          }}
        />
      </div>
      <p className="mt-2 text-xs text-faint">
        Export on one device and import on another to keep both your follows and your teams the same.
      </p>
    </div>
  );
}
