import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  handleTakeoverTimeout,
  TAKEOVER_TIMEOUT_MESSAGE,
  type TakeoverTimeoutDeps,
} from './takeover-timeout.js';
import type { TakeoverEntry } from './takeover-state.js';
import type { BrowserSessionHandle } from './browser/session-manager.js';

/**
 * Unit tests for the human-browser-takeover 10-minute timeout callback.
 *
 * When the agent hands the browser to the user and the user walks away
 * without clicking Done, we must:
 *   1. Clear the in-memory + SQLite takeover state
 *   2. Close the browser recording so videos don't stay "active" forever
 *   3. Enqueue a system message telling the agent to move on gracefully
 *
 * The real callback in process.ts wraps this in setTimeout() — but the
 * behavior under test is the body of the callback, which is what can
 * actually regress. These tests run it directly with a mocked deps object.
 */

function makeFakeHandle(): BrowserSessionHandle {
  return {
    sessionId: 'sess-fake',
    workspaceDir: '/tmp/fake',
    sessionDir: '/tmp/fake/session',
    recordingStarted: true,
  } as unknown as BrowserSessionHandle;
}

function makeFakeEntry(overrides: Partial<TakeoverEntry> = {}): TakeoverEntry {
  return {
    agentId: 'test-agent',
    channelId: 'ui',
    reason: 'captcha',
    url: 'https://example.com',
    handle: makeFakeHandle(),
    token: 'tok-123',
    timer: null,
    requestedAt: Date.now(),
    ...overrides,
  };
}

function makeDeps(entry: TakeoverEntry | null): {
  deps: TakeoverTimeoutDeps;
  getTakeover: ReturnType<typeof vi.fn>;
  clearTakeover: ReturnType<typeof vi.fn>;
  finalizeSession: ReturnType<typeof vi.fn>;
  enqueue: ReturnType<typeof vi.fn>;
} {
  const getTakeover = vi.fn().mockReturnValue(entry);
  const clearTakeover = vi.fn();
  const finalizeSession = vi.fn().mockResolvedValue(undefined);
  const enqueue = vi.fn().mockReturnValue('job-123');
  return {
    deps: {
      getTakeover: getTakeover as unknown as TakeoverTimeoutDeps['getTakeover'],
      clearTakeover: clearTakeover as unknown as TakeoverTimeoutDeps['clearTakeover'],
      finalizeSession: finalizeSession as unknown as TakeoverTimeoutDeps['finalizeSession'],
      enqueue: enqueue as unknown as TakeoverTimeoutDeps['enqueue'],
    },
    getTakeover,
    clearTakeover,
    finalizeSession,
    enqueue,
  };
}

describe('handleTakeoverTimeout — 10-minute human-browser-takeover expiry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('clears the takeover, finalizes the session, and enqueues a system message', async () => {
    const entry = makeFakeEntry();
    const { deps, clearTakeover, finalizeSession, enqueue } = makeDeps(entry);

    await handleTakeoverTimeout('test-agent', '/workspaces/test', deps);

    expect(clearTakeover).toHaveBeenCalledWith('test-agent');
    expect(finalizeSession).toHaveBeenCalledWith(entry.handle, 'closed');
    expect(enqueue).toHaveBeenCalledWith(
      '/workspaces/test',
      'test-agent',
      TAKEOVER_TIMEOUT_MESSAGE,
      'ui',
    );
  });

  it('is a no-op if the takeover has already been resolved', async () => {
    // Simulates the race where the user clicks Done at t=9:59 and the
    // timer fires at t=10:00. The takeover is gone by the time the
    // callback runs, so it must not re-enqueue or re-finalize.
    const { deps, clearTakeover, finalizeSession, enqueue } = makeDeps(null);

    await handleTakeoverTimeout('test-agent', '/workspaces/test', deps);

    expect(clearTakeover).not.toHaveBeenCalled();
    expect(finalizeSession).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('uses the channelId from the takeover entry (not a hardcoded default)', async () => {
    // The agent might be speaking on a Telegram channel, not the default
    // "ui" one. The timeout message must be routed back to the same channel
    // so the user sees it in the same conversation.
    const entry = makeFakeEntry({ channelId: 'telegram:12345' });
    const { deps, enqueue } = makeDeps(entry);

    await handleTakeoverTimeout('test-agent', '/workspaces/test', deps);

    expect(enqueue).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.any(String),
      'telegram:12345',
    );
  });

  it('still enqueues the system message if finalizeSession throws (best effort)', async () => {
    // agent-browser may have already killed the session when Chrome crashed.
    // The recording cleanup error shouldn't swallow the user-facing system
    // message — the agent needs to know the takeover ended.
    const entry = makeFakeEntry();
    const { deps, clearTakeover, enqueue } = makeDeps(entry);
    (deps.finalizeSession as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('daemon gone'),
    );

    await expect(
      handleTakeoverTimeout('test-agent', '/workspaces/test', deps),
    ).resolves.toBeUndefined();

    expect(clearTakeover).toHaveBeenCalled();
    expect(enqueue).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      TAKEOVER_TIMEOUT_MESSAGE,
      expect.any(String),
    );
  });

  it('is idempotent — a second call with no entry does nothing', async () => {
    const { deps, getTakeover, clearTakeover, enqueue } = makeDeps(null);

    await handleTakeoverTimeout('test-agent', '/workspaces/test', deps);
    await handleTakeoverTimeout('test-agent', '/workspaces/test', deps);

    expect(getTakeover).toHaveBeenCalledTimes(2);
    expect(clearTakeover).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('clears before enqueuing so the enqueue cannot re-trigger the timeout', async () => {
    // Order matters: if we enqueued first and then cleared, a concurrent
    // POST /api/takeover/:token/resolve arriving in the microtask gap
    // would find the entry still present and try to clear it a second time.
    // We clear first, then do the recording and enqueue.
    const entry = makeFakeEntry();
    const callOrder: string[] = [];
    const { deps } = makeDeps(entry);
    (deps.clearTakeover as ReturnType<typeof vi.fn>).mockImplementation(() => {
      callOrder.push('clearTakeover');
    });
    (deps.finalizeSession as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      callOrder.push('finalizeSession');
    });
    (deps.enqueue as ReturnType<typeof vi.fn>).mockImplementation(() => {
      callOrder.push('enqueue');
      return 'job-123';
    });

    await handleTakeoverTimeout('test-agent', '/workspaces/test', deps);

    expect(callOrder).toEqual(['clearTakeover', 'finalizeSession', 'enqueue']);
  });
});
