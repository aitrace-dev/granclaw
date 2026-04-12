/**
 * takeover-timeout.ts
 *
 * Helper for the human-browser-takeover 10-minute timeout path.
 *
 * Extracted from agent/process.ts so it can be unit tested without spinning
 * up an agent subprocess. The timer itself is still armed by process.ts —
 * this module only owns the callback body: the set of side effects that
 * should happen when the user walks away from the takeover tab.
 */

import { clearTakeover, getTakeover } from './takeover-state.js';
import { finalizeSession } from './browser/session-manager.js';
import { enqueue } from './agent-db.js';

export const TAKEOVER_TIMEOUT_MESSAGE =
  '[System] The user did not take any browser action within 10 minutes. ' +
  'The browser session has been closed. Please proceed to the next step or finish gracefully.';

/**
 * Dependencies the handler needs. Passing them in (rather than importing
 * directly) lets tests swap in fakes without mocking ESM modules.
 */
export interface TakeoverTimeoutDeps {
  getTakeover: typeof getTakeover;
  clearTakeover: typeof clearTakeover;
  finalizeSession: typeof finalizeSession;
  enqueue: typeof enqueue;
}

const defaultDeps: TakeoverTimeoutDeps = {
  getTakeover,
  clearTakeover,
  finalizeSession,
  enqueue,
};

/**
 * Run the takeover timeout side effects. Called from the `setTimeout` in
 * process.ts after TAKEOVER_TIMEOUT_MS elapses.
 *
 * Behaviour:
 *   1. If the takeover has already been resolved (user clicked Done), return
 *      early — no-op.
 *   2. Otherwise: clear the takeover, finalize the browser session (best
 *      effort), and enqueue a system message telling the agent to move on.
 *
 * The function is idempotent: calling it twice for the same agent is safe,
 * the second call finds no entry and returns early.
 */
export async function handleTakeoverTimeout(
  agentId: string,
  workspaceDir: string,
  deps: TakeoverTimeoutDeps = defaultDeps,
): Promise<void> {
  const current = deps.getTakeover(agentId);
  if (!current) return; // already resolved by user reply

  deps.clearTakeover(agentId);
  try {
    await deps.finalizeSession(current.handle, 'closed');
  } catch {
    // best effort — recording cleanup failure shouldn't block the system message
  }
  deps.enqueue(workspaceDir, agentId, TAKEOVER_TIMEOUT_MESSAGE, current.channelId);
}
