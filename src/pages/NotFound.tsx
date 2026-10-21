import { Link } from 'react-router';

export default function NotFound() {
  return (
    <section className="flex flex-col items-center py-16 text-center">
      <p className="font-display text-8xl leading-none font-bold text-accent">404</p>
      <h1 className="mt-3 font-display text-2xl font-bold tracking-wide uppercase">Page not found</h1>
      <Link
        to="/"
        className="mt-5 inline-flex h-10 items-center rounded-md bg-accent px-4 text-sm font-semibold text-accent-ink hover:brightness-110"
      >
        Back to home
      </Link>
    </section>
  );
}
