import { useState } from 'react';
import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import { useTheme } from '../hooks/useTheme';
import { navLink } from '../ui/primitives';

export function AppShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();
  const isChat = /\/agents\/[^/]+\/(chat|view)/.test(location.pathname);
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background text-on-surface">
      {/* Paper-fiber texture overlay — sits above content but pointer-events:none */}
      <div className="noise-overlay" aria-hidden="true" />

      {/* Top bar */}
      <header className="relative z-10 flex h-14 flex-shrink-0 items-center justify-between border-b border-outline-variant/40 bg-surface-container-lowest px-4 sm:px-6">
        <button
          type="button"
          onClick={() => navigate('/dashboard')}
          className="flex items-center gap-2 sm:gap-3 hover:opacity-80 transition-opacity"
        >
          <img src="/granclaw-logo.png" alt="GranClaw" className="h-7 w-7 rounded" />
          <span className="hidden sm:inline font-headline text-xl font-bold tracking-tight text-on-surface">
            GranClaw
          </span>
        </button>

        {/* Desktop nav */}
        <nav className="hidden md:flex items-center gap-6">
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

        {/* Mobile nav controls */}
        <div className="flex md:hidden items-center gap-2">
          <button
            type="button"
            onClick={toggleTheme}
            aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
            className="flex h-8 w-8 items-center justify-center rounded-full border border-outline-variant/60 text-on-surface-variant transition-colors hover:bg-surface-container"
          >
            <span className="material-symbols-outlined text-[18px]">
              {theme === 'dark' ? 'light_mode' : 'dark_mode'}
            </span>
          </button>
          <button
            type="button"
            onClick={() => setMenuOpen(o => !o)}
            aria-label="Open navigation menu"
            className="flex h-8 w-8 items-center justify-center rounded-full border border-outline-variant/60 text-on-surface-variant transition-colors hover:bg-surface-container"
          >
            <span className="material-symbols-outlined text-[20px]">
              {menuOpen ? 'close' : 'menu'}
            </span>
          </button>
        </div>
      </header>

      {/* Mobile dropdown menu */}
      {menuOpen && (
        <>
          <div
            className="fixed inset-0 z-20 md:hidden"
            onClick={() => setMenuOpen(false)}
          />
          <nav className="absolute top-14 left-0 right-0 z-30 bg-surface-container-lowest border-b border-outline-variant/40 px-6 py-4 flex flex-col gap-4 md:hidden shadow-lg">
            <Link
              to="/dashboard"
              onClick={() => setMenuOpen(false)}
              className="font-label text-sm font-medium text-on-surface hover:text-primary transition-colors py-1"
            >
              Agents
            </Link>
            <Link
              to="/settings"
              onClick={() => setMenuOpen(false)}
              className="font-label text-sm font-medium text-on-surface hover:text-primary transition-colors py-1"
            >
              Settings
            </Link>
            <div className="flex items-center gap-2 pt-1 border-t border-outline-variant/30">
              <span className="flex items-center gap-1.5 rounded-full border border-success/30 bg-success/10 px-3 py-1 font-label text-[10px] font-semibold uppercase tracking-widest text-success">
                <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse" />
                online
              </span>
            </div>
          </nav>
        </>
      )}

      {/* Page content — full height, no padding for chat (it manages its own) */}
      <main className={`relative z-0 flex-1 overflow-auto ${isChat ? '' : 'p-4 sm:p-6'}`}>
        <Outlet />
      </main>
    </div>
  );
}
