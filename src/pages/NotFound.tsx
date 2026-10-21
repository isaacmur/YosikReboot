import { Link } from 'react-router';

export default function NotFound() {
  return (
    <section className="py-12 text-center">
      <h1 className="text-xl font-semibold">Page not found</h1>
      <Link to="/" className="mt-4 inline-block text-sm text-blue-600 underline dark:text-blue-400">
        Back to home
      </Link>
    </section>
  );
}
