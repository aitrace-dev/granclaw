import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.tsx';
import './index.css';
import { initPostHog } from './lib/telemetry.ts';
import { LanguageProvider } from './lib/i18n.tsx';
import { fetchAppConfig } from './lib/api.ts';

initPostHog();

// Conditionally load integration cards before first render. The dynamic
// import means Vite code-splits the integrations module into its own chunk
// — local deployments that never flip enableIntegrations never download it.
async function bootstrap() {
  try {
    const appConfig = await fetchAppConfig();
    if (appConfig.enableIntegrations) {
      const { registerIntegrations } = await import('./integrations/register.ts');
      registerIntegrations();
    }
  } catch (err) {
    console.warn('[granclaw] integration bootstrap skipped:', err);
  }

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <LanguageProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </LanguageProvider>
    </React.StrictMode>
  );
}

bootstrap();
