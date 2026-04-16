/**
 * integrations/register.ts
 *
 * Module that, when imported, registers all available integration cards
 * into the slot registry. Dynamically imported from main.tsx when
 * appConfig.enableIntegrations is true.
 *
 * Each card here is enterprise-only by convention — the shared codebase
 * doesn't ship an "always-on" integration. The import gate is the
 * enableIntegrations flag; no per-card conditionals are needed.
 */

import { registerSlot } from '../lib/slots.js';
import { GoLoginCard } from './GoLoginCard.js';

export function registerIntegrations(): void {
  registerSlot('integrations.cards', GoLoginCard);
}
