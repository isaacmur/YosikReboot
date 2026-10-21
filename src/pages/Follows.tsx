import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import type { PlayerLookup } from '../../lib/types';
import { ApiError, apiGet } from '../api';
import { DownloadIcon, SearchIcon, UploadIcon, XIcon } from '../components/icons';
import { Button, Chip, Empty, PageTitle, Panel } from '../components/ui';
import { addFollow, exportFollows, importFollows, removeFollow, renameFollows, setMe, useFollows } from '../follows';

let namesRefreshed = false;

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

  function download() {
    const url = URL.createObjectURL(new Blob([exportFollows()], { type: 'application/json' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: 'yosikreboot-follows.json' });
    a.click();
    URL.revokeObjectURL(url);
  }

  async function importFile(file: File) {
    try {
      const n = importFollows(await file.text());
      setMessage({ ok: true, text: n ? `Added ${n} follow${n === 1 ? '' : 's'}.` : 'Nothing new to add.' });
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
                    <span className="truncate font-semibold">{f.name}</span>
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

      <div className="mt-4 flex flex-wrap gap-2">
        <Button size="sm" onClick={download} disabled={!follows.length}>
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
      <p className="mt-2 text-xs text-faint">Export on one device and import on another to keep both lists the same.</p>
    </div>
  );
}
