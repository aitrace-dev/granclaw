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
import type { BrowserProvider, BrowserKiller } from '../agent/browser-bin.js';
import type * as AppSecretsModule from '../app-secrets.js';
import type * as RegistryModule from '../integrations/registry.js';
import type * as AgentIntegrationsModule from '../integrations/agent-integrations-db.js';
import type * as ConfigModule from '../config.js';

/**
 * Library API exposed to extensions via ExtensionContext. Extensions never
 * import library modules directly — they receive these via DI so the
 * extension bundle can be compiled against types only and at runtime the
 * loader injects the real implementations.
 */
export interface LibraryApi {
  appSecrets: typeof AppSecretsModule;
  integrations: typeof RegistryModule;
  agentIntegrations: typeof AgentIntegrationsModule;
  config: typeof ConfigModule;
}

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
  /**
   * Register a callback that kills the extension-managed browser process
   * for an agent. Called by killBrowser() in browser-bin.ts when the agent
   * invokes browser_restart.
   */
  registerBrowserKiller(killer: BrowserKiller): void;
  /**
   * Register an externally-managed CDP session with the browser-live relay.
   * Once registered, frontend can connect to /browser-live/:agentId/:sessionId
   * and receive screencasted frames + send input events.
   */
  registerCdpSession(agentId: string, sessionId: string, cdpUrl: string): void;
  /** Remove a previously registered external CDP session. */
  removeCdpSession(agentId: string, sessionId: string): void;
  /**
   * Register a listener that runs when the user clicks "Completed" on the
   * takeover page. Listeners receive the agentId AFTER the resume message
   * has been enqueued. Errors are swallowed — the response to the user is
   * never delayed by listener work.
   */
  registerTakeoverResolvedListener(fn: (agentId: string) => void | Promise<void>): void;
  /** Injected library API. */
  lib: LibraryApi;
}

/** Default export of an extension module. */
export type ExtensionFactory = (ctx: ExtensionContext) => void | Promise<void>;
