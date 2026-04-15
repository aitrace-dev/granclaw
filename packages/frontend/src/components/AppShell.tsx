import { Outlet, useLocation, useNavigate } from 'react-router-dom';

declare const __GRANCLAW_VERSION__: string;

export function AppShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const isChat = location.pathname.includes('/chat');

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-surface">
      {/* Top bar */}
      <header className="flex h-11 flex-shrink-0 items-center justify-between border-b border-outline-variant/20 bg-surface-low px-3 sm:px-5">
        <button
          onClick={() => navigate('/dashboard')}
          className="flex items-center gap-2 hover:opacity-80 transition-opacity min-w-0"
        >
          <img src="/granclaw-logo.png" alt="GranClaw" className="h-6 w-6 rounded flex-shrink-0" />
          <span className="font-display font-semibold text-on-surface tracking-tight truncate">
            GranClaw
          </span>
          <span className="text-xs font-mono text-on-surface/60 flex-shrink-0">
            v{__GRANCLAW_VERSION__}
          </span>
        </button>
        <span className="flex items-center gap-1.5 rounded-full bg-secondary-container/20 px-2 sm:px-3 py-1 text-xs font-mono text-secondary flex-shrink-0">
          <span className="h-1.5 w-1.5 rounded-full bg-secondary animate-pulse flex-shrink-0" />
          <span className="hidden sm:inline">sistema </span>en línea
        </span>
      </header>

      {/* Page content — full height, no padding for chat (it manages its own) */}
      <main className={`flex-1 overflow-auto min-w-0 ${isChat ? '' : 'p-3 sm:p-5'}`}>
        <Outlet />
      </main>
    </div>
  );
}
