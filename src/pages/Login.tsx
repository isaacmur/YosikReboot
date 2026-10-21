import { useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { AuthError, login } from '../api';
import { Button } from '../components/ui';

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
    <div className="relative flex min-h-dvh items-center justify-center overflow-hidden px-4">
      {/* Backdrop: a violet glow and two slanted bands. */}
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        <div className="absolute -top-1/3 left-1/2 h-[70vh] w-[70vh] -translate-x-1/2 rounded-full bg-accent/25 blur-[120px]" />
        <div className="skew absolute -right-24 bottom-[12%] h-24 w-[70vw] bg-accent/10" />
        <div className="skew absolute -left-24 top-[16%] h-10 w-[55vw] bg-accent/10" />
      </div>
      <div className="relative w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <span className="skew grid size-14 place-items-center rounded-md bg-accent shadow-[0_10px_40px_-10px_var(--accent)]">
            <span className="font-display text-4xl leading-none font-bold text-accent-ink">Y</span>
          </span>
          <h1 className="mt-4 font-display text-4xl leading-none font-bold tracking-wide uppercase">
            Yosik<span className="text-accent-bright">Reboot</span>
          </h1>
          <p className="mt-2 text-sm text-muted">Fortnite competitive, live.</p>
        </div>
        <form onSubmit={submit} className="space-y-3 rounded-xl border border-line bg-surface/80 p-5 backdrop-blur">
          <label className="block text-xs font-semibold tracking-wider text-muted uppercase" htmlFor="passphrase">
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
            className="h-11 w-full rounded-md border border-line-strong bg-bg px-3 outline-none focus:border-accent"
          />
          {error && (
            <p role="alert" className="text-sm text-live">
              {error}
            </p>
          )}
          <Button type="submit" variant="primary" size="lg" className="w-full" disabled={busy || !passphrase}>
            {busy ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
      </div>
    </div>
  );
}
