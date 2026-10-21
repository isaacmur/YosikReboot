import { NavLink, Route, Routes, useLocation } from 'react-router';
import { REGIONS, type Region } from '../lib/types';
import { SELECT } from './components/ui';
import { REGION_LABEL } from './format';
import EventDetail from './pages/EventDetail';
import Events from './pages/Events';
import Health from './pages/Health';
import Home from './pages/Home';
import Login from './pages/Login';
import NotFound from './pages/NotFound';
import Settings from './pages/Settings';
import { useSettings } from './settings';

function RegionSelect() {
  const [{ region }, update] = useSettings();
  return (
    <label className="flex items-center gap-1 text-sm">
      <span className="sr-only">Region</span>
      <select
        value={region}
        onChange={(e) => update({ region: e.target.value as Region })}
        className={SELECT}
        aria-label="Region"
      >
        {REGIONS.map((r) => (
          <option key={r} value={r}>
            {r} · {REGION_LABEL[r]}
          </option>
        ))}
      </select>
    </label>
  );
}

const navClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-lg px-3 py-1.5 text-sm font-medium ${
    isActive
      ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
      : 'text-zinc-600 hover:bg-zinc-200 dark:text-zinc-400 dark:hover:bg-zinc-800'
  }`;

export default function App() {
  const onLogin = useLocation().pathname === '/login';
  return (
    <div className="mx-auto flex min-h-dvh max-w-3xl flex-col px-4">
      {!onLogin && (
        <header className="sticky top-0 z-10 -mx-4 border-b border-zinc-200 bg-zinc-50/90 px-4 py-3 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/90">
          <div className="flex items-center justify-between gap-3">
            <NavLink to="/" className="text-lg font-semibold tracking-tight">
              YosikReboot
            </NavLink>
            <RegionSelect />
          </div>
          <nav className="mt-2 flex gap-1" aria-label="Main">
            <NavLink to="/" end className={navClass}>
              Home
            </NavLink>
            <NavLink to="/events" className={navClass}>
              Events
            </NavLink>
            <NavLink to="/settings" className={navClass}>
              Settings
            </NavLink>
          </nav>
        </header>
      )}
      <main className="flex-1 py-4">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/events" element={<Events />} />
          <Route path="/events/:eventId" element={<EventDetail />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/health" element={<Health />} />
          <Route path="/login" element={<Login />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
    </div>
  );
}
