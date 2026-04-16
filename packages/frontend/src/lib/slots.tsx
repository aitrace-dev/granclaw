/**
 * lib/slots.tsx
 *
 * UI extension-slot registry. Named mount points in the shared frontend that
 * the enterprise bundle injects into at boot — the shared codebase ships no
 * integrations, the enterprise bundle registers `GoLoginCard` (and future
 * cards) into `integrations.cards`.
 *
 * Pattern:
 *   // enterprise bootstrap
 *   import { registerSlot } from '@granclaw/frontend/lib/slots';
 *   registerSlot('integrations.cards', GoLoginCard);
 *
 *   // shared IntegrationsPage
 *   import { renderSlot } from './slots';
 *   return <>{renderSlot('integrations.cards', { agents })}</>;
 *
 * Slots are global (module-level Map) — there's one graph per frontend bundle.
 * _resetSlotsForTests() clears it between tests.
 */

import React from 'react';

export type SlotName = 'integrations.cards' | 'sidebar.items';
export type SlotRenderer<P = unknown> = (props: P) => React.ReactNode;

const slots = new Map<SlotName, SlotRenderer[]>();

export function registerSlot<P = unknown>(name: SlotName, renderer: SlotRenderer<P>): void {
  const list = slots.get(name) ?? [];
  list.push(renderer as SlotRenderer);
  slots.set(name, list);
}

export function renderSlot<P = unknown>(name: SlotName, props: P): React.ReactNode[] {
  const list = slots.get(name) ?? [];
  return list.map((render, i) =>
    React.createElement(React.Fragment, { key: i }, render(props)),
  );
}

/** Test-only: clear all registered slots so each test starts from zero. */
export function _resetSlotsForTests(): void {
  slots.clear();
}

/** Test-only: how many renderers are registered for a slot. */
export function _slotCountForTests(name: SlotName): number {
  return slots.get(name)?.length ?? 0;
}
