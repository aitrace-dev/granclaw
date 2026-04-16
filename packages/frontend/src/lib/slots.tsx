/**
 * lib/slots.tsx
 *
 * Named mount points in the shared frontend. The base bundle ships no
 * built-in integrations — downstream bundles loaded at boot (see main.tsx)
 * register their cards via window.__granclaw.registerSlot().
 *
 * Keeping this tiny and module-local because the contract is trivial:
 *   registerSlot('social-logins.cards', (props) => <Card {...props} />);
 *   renderSlot('social-logins.cards', { agentId })   // in a component
 *
 * Slots are module-level state. _resetSlotsForTests() clears them between
 * tests.
 */

import React from 'react';

export type SlotName = 'social-logins.cards';
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

/** Test-only. */
export function _resetSlotsForTests(): void {
  slots.clear();
}

/**
 * Bridge that the enterprise bundle uses to register into slots without
 * needing to know about React or internal module paths. Exposed on window
 * by main.tsx at startup so the extension script can pick it up.
 */
export interface GranclawBridge {
  React: typeof React;
  registerSlot: typeof registerSlot;
}

declare global {
  interface Window {
    __granclaw?: GranclawBridge;
  }
}
