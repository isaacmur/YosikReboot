import { useEffect } from 'react';
import { NavLink, Route, Routes, useLocation, useNavigationType } from 'react-router';
import { REGIONS, type Region } from '../lib/types';
import { GlobeIcon, HomeIcon, SettingsIcon, TrophyIcon, UserIcon } from './components/icons';
import { PillSelect } from './components/ui';
import { REGION_LABEL } from './format';
import EventPage from './pages/EventPage';
import Events from './pages/Events';
import Follows from './pages/Follows';
import Health from './pages/Health';
import Home from './pages/Home';
import Login from './pages/Login';
import Me from './pages/Me';
import NotFound from './pages/NotFound';
import Player from './pages/Player';
import Settings from './pages/Settings';
import { useSettings } from './settings';
import { useTheme } from './theme';

const NAV = [
  { to: '/', label: 'Home', icon: HomeIcon, end: true },
  { to: '/events', label: 'Events', icon: TrophyIcon, end: false },
  { to: '/me', label: 'Me', icon: UserIcon, end: false },
  { to: '/settings', label: 'Settings', icon: SettingsIcon, end: false },
];

function Brand() {
  return (
    <NavLink to="/" className="flex items-center gap-2" aria-label="YosikReboot home">
      <span className="skew grid h-7 w-7 place-items-center rounded-[4px] bg-accent">
        <span className="font-display text-lg leading-none font-bold text-accent-ink">Y</span>
      </span>
      <span className="font-display text-xl leading-none font-bold tracking-wide uppercase">
        Yosik<span className="text-accent-bright">Reboot</span>
      </span>
    </NavLink>
  );
}

function RegionPicker() {
  const [{ region }, update] = useSettings();
  return (
    <PillSelect
      aria-label="Region"
      icon={<GlobeIcon size={15} />}
      value={region}
      onChange={(e) => update({ region: e.target.value as Region })}
    >
      {REGIONS.map((r) => (
        <option key={r} value={r}>
          {r} · {REGION_LABEL[r]}
        </option>
      ))}
    </PillSelect>
  );
}

function NavItems({ compact }: { compact?: boolean }) {
  return (
    <>
      {NAV.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) =>
            `relative flex items-center justify-center gap-1.5 font-display text-[15px] font-bold tracking-wide uppercase transition ${
              compact ? 'flex-1 py-2.5' : 'px-1 py-2'
            } ${isActive ? 'text-ink' : 'text-faint hover:text-muted'}`
          }
        >
          {({ isActive }) => (
            <>
              <Icon size={16} />
              {label}
              {isActive && <span className="skew absolute inset-x-3 -bottom-px h-[3px] bg-accent" aria-hidden />}
            </>
          )}
        </NavLink>
      ))}
    </>
  );
}

function TopBar() {
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-bg/85 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-4 px-4">
        <Brand />
        <nav className="hidden items-center gap-6 md:flex" aria-label="Main">
          <NavItems />
        </nav>
        <RegionPicker />
      </div>
      <nav className="mx-auto flex max-w-5xl px-1 md:hidden" aria-label="Main">
        <NavItems compact />
      </nav>
    </header>
  );
}

/** New pages start at the top; Back and Forward leave the browser to restore the position. */
function useScrollToTop(pathname: string) {
  const navigationType = useNavigationType();
  useEffect(() => {
    if (navigationType !== 'POP') window.scrollTo(0, 0);
  }, [pathname, navigationType]);
}

export default function App() {
  const { pathname } = useLocation();
  const [{ theme }] = useSettings();
  useTheme(theme);
  const onLogin = pathname === '/login';
  useScrollToTop(pathname);
  return (
    <div className="flex min-h-dvh flex-col">
      {!onLogin && <TopBar />}
      <main className={onLogin ? 'flex-1' : 'mx-auto w-full max-w-5xl flex-1 px-4 pt-5 pb-16'}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/events" element={<Events />} />
          <Route path="/events/:eventId" element={<EventPage />} />
          <Route path="/events/:eventId/:windowId" element={<EventPage />} />
          <Route path="/me" element={<Me />} />
          <Route path="/players/:accountId" element={<Player />} />
          <Route path="/follows" element={<Follows />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/health" element={<Health />} />
          <Route path="/login" element={<Login />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
    </div>
  );
}
