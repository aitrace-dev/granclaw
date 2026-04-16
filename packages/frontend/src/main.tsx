import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.tsx';
import './index.css';
import { initPostHog } from './lib/telemetry.ts';
import { LanguageProvider } from './lib/i18n.tsx';
import { registerSlot } from './lib/slots.tsx';

initPostHog();

// Expose the bridge for the enterprise bundle BEFORE we try to load it.
// Extension scripts import React via this bridge instead of bundling their
// own, so there's exactly one React instance in the page.
window.__granclaw = { React, registerSlot };

/**
 * Attempt to load an extension UI bundle at /ext/index.js. When the base
 * image is running, this 404s and the function returns. Downstream images
 * ship a built bundle at that path which registers cards into slots.
 *
 * We await the script's `load` event so cards are registered BEFORE the
 * initial React render — otherwise the first paint would show empty slots.
 */
async function loadExtensionBundle(): Promise<void> {
  // HEAD probe first so we don't eval a 404 HTML page as JS when the base
  // image (without enterprise extensions) serves a SPA fallback for
  // /ext/index.js.
  try {
    const res = await fetch('/ext/index.js', { method: 'HEAD' });
    if (!res.ok) return;
  } catch {
    return;
  }

  await new Promise<void>((resolve) => {
    const s = document.createElement('script');
    s.type = 'module';
    s.src = '/ext/index.js';
    s.onload = () => resolve();
    s.onerror = () => {
      console.warn('[granclaw] failed to load /ext/index.js');
      resolve();
    };
    document.head.appendChild(s);
  });
}

async function bootstrap() {
  await loadExtensionBundle();

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
