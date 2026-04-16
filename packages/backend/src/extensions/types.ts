/**
 * extensions/types.ts
 *
 * Public API for GranClaw backend extensions. An "extension" is an external
 * module that adds integrations, browser providers, or custom routes on
 * top of the base library.
 *
 * Contract:
 *   - Extensions are loaded once at orchestrator startup.
 *   - Each extension is a module whose default export is an
 *     ExtensionFactory function.
 *   - The factory is called with an ExtensionContext. It may register
 *     browser providers, mount additional Express routes, or run boot-
 *     time bootstrap logic.
 *   - Extensions live in directories pointed to by GRANCLAW_EXTENSIONS_DIR;
 *     the base library never imports from them directly.
 */

import type { Express } from 'express';
import type { BrowserProvider } from '../agent/browser-bin.js';

export interface ExtensionContext {
  /** The Express app. Extensions can mount routers here. */
  app: Express;
  /**
   * Register a browser provider that the runner will consult per-turn
   * to decide whether to swap the local agent-browser for an alternative.
   * Multiple providers are tried in registration order; the first one
   * that returns a non-null resolution wins.
   */
  registerBrowserProvider(provider: BrowserProvider): void;
}

/** Default export of an extension module. */
export type ExtensionFactory = (ctx: ExtensionContext) => void | Promise<void>;
