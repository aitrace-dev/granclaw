// packages/backend/src/takeover-state.ts
import type { BrowserSessionHandle } from './browser/session-manager.js';
import { getDataDb } from './data-db.js';

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

/** Minimal row shape returned by SQLite for cross-process reads. */
export interface TakeoverRow {
  token: string;
  agent_id: string;
  channel_id: string;
  session_id: string;
  reason: string;
  url: string | null;
  requested_at: number;
}

export const TAKEOVER_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

// ── In-memory state (agent process only — handle + timer can't be serialized) ──
const byAgent = new Map<string, TakeoverEntry>();
const byToken = new Map<string, string>(); // token → agentId

// ── SQLite helpers (cross-process) ─────────────────────────────────────────────

function dbInsert(entry: Omit<TakeoverEntry, 'timer'>): void {
  try {
    getDataDb().prepare(`
      INSERT OR REPLACE INTO takeovers (token, agent_id, channel_id, session_id, reason, url, requested_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      entry.token,
      entry.agentId,
      entry.channelId,
      entry.handle.sessionId,
      entry.reason,
      entry.url ?? null,
      entry.requestedAt,
    );
  } catch (err) {
    console.error('[takeover-state] dbInsert failed', err);
  }
}

function dbDeleteByAgent(agentId: string): void {
  try {
    getDataDb().prepare(`DELETE FROM takeovers WHERE agent_id = ?`).run(agentId);
  } catch (err) {
    console.error('[takeover-state] dbDeleteByAgent failed', err);
  }
}

/** Look up a takeover by token from SQLite — usable from any process. */
export function getTakeoverByTokenFromDb(token: string): TakeoverRow | null {
  try {
    const row = getDataDb().prepare(
      `SELECT token, agent_id, channel_id, session_id, reason, url, requested_at FROM takeovers WHERE token = ?`
    ).get(token) as TakeoverRow | undefined;
    return row ?? null;
  } catch (err) {
    console.error('[takeover-state] getTakeoverByTokenFromDb failed', err);
    return null;
  }
}

/** Delete a takeover by agent ID from SQLite — usable from any process. */
export function clearTakeoverFromDb(agentId: string): void {
  dbDeleteByAgent(agentId);
}

// ── In-memory API (agent process only) ─────────────────────────────────────────

export function setTakeover(
  agentId: string,
  entry: Omit<TakeoverEntry, 'timer'>,
): void {
  const existing = byAgent.get(agentId);
  if (existing) {
    if (existing.timer) clearTimeout(existing.timer);
    byToken.delete(existing.token);
  }
  byAgent.set(agentId, { ...entry, timer: null });
  byToken.set(entry.token, agentId);
  dbInsert(entry);
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
  dbDeleteByAgent(agentId);
}

/**
 * Drop the in-memory takeover entry for an agent WITHOUT touching the SQLite
 * row. Used by runner-pi when it grabs the browser handle back at the start
 * of a new turn: the handle needs to be consumed so the next turn does not
 * re-restore the same stale handle, but the DB row must stay alive so the
 * orchestrator's GET /api/takeover/:token endpoint still finds it if the
 * user has not clicked the link yet.
 *
 * Removing the DB row here used to happen via clearTakeover() and caused the
 * "link always says expired" bug: any job dequeued after the takeover was
 * emitted (scheduler tick, telegram message, follow-up user prompt) would
 * enter runAgent, hit the restore path, and wipe the row before the user
 * ever had a chance to click. The DB row is now owned exclusively by the
 * /resolve endpoint (user clicks Completed) and the 10-minute timeout.
 */
export function clearTakeoverMemoryOnly(agentId: string): void {
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
  if (entry) {
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = timer;
  }
}
