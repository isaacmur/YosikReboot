import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import type { PlayerLookup } from '../../lib/types';
import { ApiError, apiGet } from '../api';
import { Card, Pill } from '../components/ui';
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
      <h1 className="text-xl font-semibold">Follows</h1>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
        Players you follow, saved in this browser. Mark one as you to see your results on{' '}
        <Link to="/me" className="underline">
          Me
        </Link>
        .
      </p>

      <form onSubmit={add} className="mt-4 flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Epic display name"
          aria-label="Epic display name"
          required
          className="min-w-0 flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
        />
        <button
          type="submit"
          disabled={busy || !name.trim()}
          className="rounded-lg bg-zinc-900 px-4 py-2 font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
        >
          {busy ? 'Finding…' : 'Follow'}
        </button>
      </form>
      {message && (
        <p
          role="status"
          className={`mt-2 text-sm ${message.ok ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-700 dark:text-rose-300'}`}
        >
          {message.text}
        </p>
      )}

      <Card className="mt-4">
        {follows.length ? (
          <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {follows.map((f) => (
              <li key={f.id} className="flex items-center justify-between gap-2 p-3">
                <span className="min-w-0 truncate font-medium">
                  {f.name}{' '}
                  {f.isMe && (
                    <Pill className="bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                      You
                    </Pill>
                  )}
                </span>
                <span className="flex shrink-0 gap-3 text-sm">
                  <button
                    onClick={() => setMe(f.isMe ? null : f.id)}
                    className="text-blue-600 underline dark:text-blue-400"
                  >
                    {f.isMe ? 'Not me' : 'This is me'}
                  </button>
                  <button onClick={() => removeFollow(f.id)} className="text-rose-700 underline dark:text-rose-300">
                    Remove
                  </button>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="p-4 text-sm text-zinc-500">
            No follows yet. Add yourself first, then anyone you want to keep an eye on.
          </p>
        )}
      </Card>

      <div className="mt-4 flex flex-wrap gap-2 text-sm">
        <button
          onClick={download}
          disabled={!follows.length}
          className="rounded-lg border border-zinc-300 px-3 py-1.5 font-medium disabled:opacity-50 dark:border-zinc-700"
        >
          Export list
        </button>
        <button
          onClick={() => fileRef.current?.click()}
          className="rounded-lg border border-zinc-300 px-3 py-1.5 font-medium dark:border-zinc-700"
        >
          Import list
        </button>
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
      <p className="mt-2 text-xs text-zinc-500">
        Export on one device and import on another to keep both lists the same.
      </p>
    </div>
  );
}
