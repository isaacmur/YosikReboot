import { Link, Route, Routes } from 'react-router';
import Home from './pages/Home';
import NotFound from './pages/NotFound';

// Phase 1 adds /events, /events/:eventId, /settings, /health and /login here.
export default function App() {
  return (
    <div className="mx-auto flex min-h-dvh max-w-3xl flex-col px-4">
      <header className="flex items-center justify-between py-4">
        <Link to="/" className="text-lg font-semibold tracking-tight">
          YosikReboot
        </Link>
      </header>
      <main className="flex-1 pb-8">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
    </div>
  );
}
