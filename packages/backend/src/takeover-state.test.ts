/**
 * takeover-state.test.ts
 *
 * Regression tests for the cross-process takeover handoff path.
 *
 * The symptom: user clicks the takeover link in chat and the page says
 * "Sesión expirada" — always, regardless of how quickly they click.
 *
 * Root cause (covered here): setTakeover was being called with a
 * BrowserSessionHandle whose shape has grown over time. If any field the
 * INSERT reads is missing or nullish, better-sqlite3 throws, and because
 * dbInsert swallows the error into a console.error, the in-memory map is
 * written but the SQLite row never is. The orchestrator endpoint only
 * reads from SQLite, so it returns 404 → frontend renders "expired".
 *
 * These tests pin the contract that setTakeover(...) → getTakeoverByTokenFromDb(...)
 * round-trips successfully.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

import {
  setTakeover,
  getTakeoverByTokenFromDb,
  getTakeover,
  clearTakeover,
  clearTakeoverMemoryOnly,
} from './takeover-state.js';
import { closeDataDb } from './data-db.js';
import type { BrowserSessionHandle } from './browser/session-manager.js';

let tmp: string;

function fakeHandle(): BrowserSessionHandle {
  return {
    agentId: 'test-agent',
    sessionId: 'sess-test-1',
    workspaceDir: '/tmp/ws',
    sessionDir: '/tmp/ws/.browser-sessions/sess-test-1',
    metaPath: '/tmp/ws/.browser-sessions/sess-test-1/meta.json',
    recordingStarted: true,
  };
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'granclaw-tk-'));
  process.env.DATA_DB_PATH = path.join(tmp, 'system.sqlite');
});

afterEach(() => {
  // Clean both halves (in-memory + db) so tests don't leak state.
  try { clearTakeover('test-agent'); } catch { /* ignore */ }
  closeDataDb();
  delete process.env.DATA_DB_PATH;
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('takeover-state — cross-process handoff', () => {
  it('writes a row to SQLite that the orchestrator endpoint can read back', () => {
    // This is the exact path runner-pi.ts takes inside the
    // request_human_browser_takeover tool execute().
    setTakeover('test-agent', {
      agentId: 'test-agent',
      channelId: 'ui',
      reason: 'solve the hCaptcha',
      url: 'https://idealista.com/',
      handle: fakeHandle(),
      token: 'tok-abc',
      requestedAt: Date.now(),
    });

    // In-memory read (agent process side)
    const mem = getTakeover('test-agent');
    expect(mem, 'in-memory map should have the entry').not.toBeNull();
    expect(mem!.token).toBe('tok-abc');

    // SQLite read (orchestrator process side)
    const row = getTakeoverByTokenFromDb('tok-abc');
    expect(
      row,
      'orchestrator MUST be able to read the row from SQLite — ' +
      'if this is null, the takeover link will always show "expired" ' +
      'because /api/takeover/:token returns 404 for missing rows',
    ).not.toBeNull();
    expect(row!.agent_id).toBe('test-agent');
    expect(row!.channel_id).toBe('ui');
    expect(row!.session_id).toBe('sess-test-1');
    expect(row!.reason).toBe('solve the hCaptcha');
    expect(row!.url).toBe('https://idealista.com/');
  });

  it('clearTakeoverMemoryOnly leaves the SQLite row intact for the orchestrator to read', () => {
    // This is the regression for the "link always says expired" bug.
    //
    // Timeline before the fix:
    //   t=0  agent emits request_human_browser_takeover → setTakeover writes
    //        both the in-memory map and the SQLite row.
    //   t=1  ANY next job dequeued by process.ts (scheduler tick, telegram
    //        message, follow-up user prompt, workflow run) enters runAgent.
    //   t=2  runAgent's restore path called clearTakeover(agentId) which
    //        DELETE'd the SQLite row via dbDeleteByAgent.
    //   t=3  User clicks the takeover link in chat → GET /api/takeover/:token
    //        → getTakeoverByTokenFromDb returns null → 404 "expired or invalid".
    //
    // The fix: runner-pi now uses clearTakeoverMemoryOnly, which evicts the
    // in-memory entry (so the NEXT turn does not re-restore the same handle)
    // but does NOT touch the SQLite row. The row lives until the user
    // actually resolves via /api/takeover/:token/resolve or the 10-minute
    // timeout fires — the two paths that genuinely own takeover expiry.
    setTakeover('test-agent', {
      agentId: 'test-agent',
      channelId: 'ui',
      reason: 'solve the hCaptcha',
      url: 'https://idealista.com/',
      handle: fakeHandle(),
      token: 'tok-restore',
      requestedAt: Date.now(),
    });

    // Simulate runner-pi's restore path at the start of the next turn.
    clearTakeoverMemoryOnly('test-agent');

    // In-memory entry is gone (so the turn after this one won't re-restore)…
    expect(getTakeover('test-agent')).toBeNull();

    // …but the SQLite row MUST still be there so the user's click on the
    // takeover link in chat still resolves to 200 in the orchestrator.
    const row = getTakeoverByTokenFromDb('tok-restore');
    expect(
      row,
      'clearTakeoverMemoryOnly must NOT delete the takeovers row — ' +
      'otherwise the takeover link shows "expired" as soon as any unrelated ' +
      'job is dequeued between setTakeover and the user click',
    ).not.toBeNull();
    expect(row!.token).toBe('tok-restore');
  });

  it('clearTakeover (the full version) still deletes both memory and the SQLite row', () => {
    // The 10-minute timeout path and direct cleanup still need a function
    // that wipes the DB row — clearTakeover must keep that behavior.
    setTakeover('test-agent', {
      agentId: 'test-agent',
      channelId: 'ui',
      reason: 'solve the hCaptcha',
      url: 'https://idealista.com/',
      handle: fakeHandle(),
      token: 'tok-full-clear',
      requestedAt: Date.now(),
    });

    clearTakeover('test-agent');

    expect(getTakeover('test-agent')).toBeNull();
    expect(getTakeoverByTokenFromDb('tok-full-clear')).toBeNull();
  });

  it('handles an undefined url (agent omitted the url argument) without crashing the insert', () => {
    // The LLM is allowed to skip the `url` parameter — the schema only
    // requires `reason`. Nullish url must still round-trip.
    setTakeover('test-agent', {
      agentId: 'test-agent',
      channelId: 'ui',
      reason: 'review the post',
      url: undefined,
      handle: fakeHandle(),
      token: 'tok-no-url',
      requestedAt: Date.now(),
    });

    const row = getTakeoverByTokenFromDb('tok-no-url');
    expect(row, 'insert should succeed even when url is undefined').not.toBeNull();
    expect(row!.url).toBeNull();
  });
});
