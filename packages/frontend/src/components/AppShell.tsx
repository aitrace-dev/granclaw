import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import { useTheme } from '../hooks/useTheme';
import { navLink } from '../ui/primitives';

export function AppShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();
  const isChat = location.pathname.includes('/chat');

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background text-on-surface">
      {/* Paper-fiber texture overlay — sits above content but pointer-events:none */}
      <div className="noise-overlay" aria-hidden="true" />

      {/* Top bar */}
      <header className="relative z-10 flex h-14 flex-shrink-0 items-center justify-between border-b border-outline-variant/40 bg-surface-container-lowest px-6">
        <button
          type="button"
          onClick={() => navigate('/dashboard')}
          className="flex items-center gap-3 hover:opacity-80 transition-opacity"
        >
          <img src="/granclaw-logo.png" alt="GranClaw" className="h-7 w-7 rounded" />
          <span className="font-headline text-xl font-bold tracking-tight text-on-surface">
            GranClaw
          </span>
        </button>

        <nav className="flex items-center gap-6">
          <Link to="/dashboard" className={navLink}>
            Agents
          </Link>
          <Link to="/settings" className={navLink}>
            Settings
          </Link>
          <button
            type="button"
            onClick={toggleTheme}
            aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
            title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
            className="flex h-8 w-8 items-center justify-center rounded-full border border-outline-variant/60 text-on-surface-variant transition-colors hover:bg-surface-container hover:text-on-surface"
          >
            <span className="material-symbols-outlined text-[18px]">
              {theme === 'dark' ? 'light_mode' : 'dark_mode'}
            </span>
          </button>
          <span className="flex items-center gap-1.5 rounded-full border border-success/30 bg-success/10 px-3 py-1 font-label text-[10px] font-semibold uppercase tracking-widest text-success">
            <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse" />
            online
          </span>
        </nav>
      </header>

      {/* Page content — full height, no padding for chat (it manages its own) */}
      <main className={`relative z-0 flex-1 overflow-auto ${isChat ? '' : 'p-6'}`}>
        <Outlet />
      </main>
    </div>
  );
}
