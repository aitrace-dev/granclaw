import type { ComponentType } from 'react';

export interface RegisteredView {
  id: string;
  label: string;
  icon: string;
  component: ComponentType<{ agentId: string }>;
}

let snapshot: readonly RegisteredView[] = [];
const listeners: Array<() => void> = [];

export function registerView(view: RegisteredView) {
  if (snapshot.some(v => v.id === view.id)) return;
  snapshot = [...snapshot, view];
  listeners.forEach(fn => fn());
}

export function getRegisteredViews(): readonly RegisteredView[] {
  return snapshot;
}

export function subscribeViews(fn: () => void): () => void {
  listeners.push(fn);
  return () => {
    const idx = listeners.indexOf(fn);
    if (idx >= 0) listeners.splice(idx, 1);
  };
}
