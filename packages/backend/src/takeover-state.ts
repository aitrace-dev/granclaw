// packages/backend/src/takeover-state.ts
import type { BrowserSessionHandle } from './browser/session-manager.js';

export interface TakeoverEntry {
  agentId: string;
  channelId: string;
  reason: string;
  url?: string;
  handle: BrowserSessionHandle;
  token: string;
  timer: ReturnType<typeof setTimeout> | null;
  requestedAt: number;
}

export const TAKEOVER_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

const byAgent = new Map<string, TakeoverEntry>();
const byToken = new Map<string, string>(); // token → agentId

export function setTakeover(
  agentId: string,
  entry: Omit<TakeoverEntry, 'timer'>,
): void {
  byAgent.set(agentId, { ...entry, timer: null });
  byToken.set(entry.token, agentId);
}

export function getTakeover(agentId: string): TakeoverEntry | null {
  return byAgent.get(agentId) ?? null;
}

export function getTakeoverByToken(token: string): TakeoverEntry | null {
  const agentId = byToken.get(token);
  if (!agentId) return null;
  return byAgent.get(agentId) ?? null;
}

export function hasTakeover(agentId: string): boolean {
  return byAgent.has(agentId);
}

export function cancelTakeoverTimer(agentId: string): void {
  const entry = byAgent.get(agentId);
  if (entry?.timer) {
    clearTimeout(entry.timer);
    entry.timer = null;
  }
}

export function clearTakeover(agentId: string): void {
  const entry = byAgent.get(agentId);
  if (!entry) return;
  if (entry.timer) clearTimeout(entry.timer);
  byToken.delete(entry.token);
  byAgent.delete(agentId);
}

export function updateTakeoverTimer(
  agentId: string,
  timer: ReturnType<typeof setTimeout>,
): void {
  const entry = byAgent.get(agentId);
  if (entry) entry.timer = timer;
}
