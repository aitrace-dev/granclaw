import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useT, LanguageSwitcher } from '../lib/i18n.tsx';
import { fetchAppConfig, type AppConfig } from '../lib/api.ts';

declare const __GRANCLAW_VERSION__: string;

const APP_CONFIG_INITIAL: AppConfig = {
  showWorkspaceDirConfig: true,
  showBraveSearchConfig: true,
  enableIntegrations: false,
};

export function AppShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const isChat = location.pathname.includes('/chat');
  const { t } = useT();

  const [appConfig, setAppConfig] = useState<AppConfig>(APP_CONFIG_INITIAL);
  useEffect(() => {
    fetchAppConfig().then(setAppConfig).catch(() => { /* fall back to defaults */ });
  }, []);

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
        <div className="flex items-center gap-2 flex-shrink-0">
          {appConfig.enableIntegrations && (
            <button
              onClick={() => navigate('/integrations')}
              className={`hidden sm:inline-block rounded px-2 py-1 text-xs font-mono transition-colors ${
                location.pathname.startsWith('/integrations')
                  ? 'bg-primary/10 text-primary'
                  : 'text-on-surface-variant hover:bg-surface-container'
              }`}
            >
              Integrations
            </button>
          )}
          <LanguageSwitcher />
          <span className="flex items-center gap-1.5 rounded-full bg-secondary-container/20 px-2 sm:px-3 py-1 text-xs font-mono text-secondary flex-shrink-0">
            <span className="h-1.5 w-1.5 rounded-full bg-secondary animate-pulse flex-shrink-0" />
            <span className="hidden sm:inline">{t('shell.systemPrefix')}</span>{t('shell.onlineSuffix')}
          </span>
        </div>
      </header>

      {/* Page content — full height, no padding for chat (it manages its own) */}
      <main className={`flex-1 overflow-auto min-w-0 ${isChat ? '' : 'p-3 sm:p-5'}`}>
        <Outlet />
      </main>
    </div>
  );
}
