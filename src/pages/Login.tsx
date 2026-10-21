import { useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { AuthError, login } from '../api';
import { Card } from '../components/ui';

export default function Login() {
  const navigate = useNavigate();
  const from = (useLocation().state as { from?: string } | null)?.from ?? '/';
  const [passphrase, setPassphrase] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await login(passphrase);
      navigate(from.startsWith('/') && !from.startsWith('/login') ? from : '/', { replace: true });
    } catch (err) {
      setError(err instanceof AuthError ? 'Wrong passphrase.' : err instanceof Error ? err.message : 'Sign-in failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-[70dvh] items-center justify-center">
      <Card className="w-full max-w-sm p-6">
        <h1 className="text-xl font-semibold">YosikReboot</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">Enter the passphrase to continue.</p>
        <form onSubmit={submit} className="mt-4 space-y-3">
          <label className="block text-sm font-medium" htmlFor="passphrase">
            Passphrase
          </label>
          <input
            id="passphrase"
            type="password"
            autoComplete="current-password"
            autoFocus
            required
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-950"
          />
          {error && (
            <p role="alert" className="text-sm text-rose-700 dark:text-rose-300">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={busy || !passphrase}
            className="w-full rounded-lg bg-zinc-900 px-3 py-2 font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
          >
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </Card>
    </div>
  );
}
