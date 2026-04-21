/**
 * context-budget.ts
 *
 * Pure token-budget math for the pre-send overflow guard. Separated from
 * runner-pi.ts so it can be unit-tested without booting pi.
 *
 * Why a pre-send guard (not just catching 400s): pi has its own post-error
 * overflow recovery, but it ONLY runs when the erroring assistant message's
 * model matches the session's current model. When the user switches to a
 * smaller-context model mid-session (e.g. 200k → 128k), the overflow comes
 * from the NEW model, so the check passes, but if the accumulated history
 * was gathered under the larger window the new prompt still 400s before
 * recovery can help. We need to gate the prompt BEFORE it goes on the wire.
 *
 * The math is deliberately conservative — we'd rather compact one turn too
 * early than surface a user-visible 400.
 */

export interface ContextBudgetInput {
  /** Current estimated tokens in the session messages (from pi's getContextUsage). */
  currentTokens: number;
  /** Character count of the incoming user message. */
  incomingChars: number;
  /** The current model's context window (total input+output capacity). */
  contextWindow: number;
  /** The current model's advertised max output tokens (pi model.maxTokens). */
  maxOutputTokens: number;
}

export interface ContextBudgetPlan {
  projectedTokens: number;
  /** Usable input budget after subtracting output reservation + overhead. */
  budget: number;
  action: 'send' | 'compact' | 'abort';
  /** Human-readable reason, suitable for logs and (on abort) user-facing error. */
  reason: string;
}

/**
 * Overhead we add for the system prompt, tool schemas, and the message
 * envelope that `estimateTokens` doesn't count. 2k is a conservative upper
 * bound on the extras pi-coding-agent injects (SYSTEM.md, compact_context
 * tool defs, etc.) beyond the chat messages themselves.
 */
const FIXED_OVERHEAD_TOKENS = 2_000;

/**
 * chars/4 is pi's own heuristic (see compaction.js:estimateTokens). It
 * over-estimates on average (rarely below 3.5 chars/token for Latin text),
 * which is the right direction here — we'd rather guard too early.
 */
function estimateTokensFromChars(chars: number): number {
  return Math.ceil(chars / 4);
}

/**
 * Decide what to do before sending a prompt: send as-is, compact first, or
 * abort with a clear error because the context is unsalvageable for this
 * model (the "user switched to a smaller model after accumulating a lot of
 * history" case).
 *
 * - 'send': projected fits comfortably within the budget.
 * - 'compact': projected exceeds the budget; compaction should bring it
 *   back under. Runner should compact, re-check, then send.
 * - 'abort': even an empty-history prompt + the incoming message + output
 *   reservation would overflow. Compaction can't help; surface to user.
 */
export function planContextBudget(input: ContextBudgetInput): ContextBudgetPlan {
  const { currentTokens, incomingChars, contextWindow, maxOutputTokens } = input;

  // Reserve output headroom. Cap at 20% of the window so a model that
  // advertises a huge maxTokens (e.g. 32k) against a small window doesn't
  // starve the input side entirely.
  const outputReserve = Math.min(maxOutputTokens, Math.floor(contextWindow * 0.2));
  const budget = contextWindow - outputReserve - FIXED_OVERHEAD_TOKENS;

  const incomingTokens = estimateTokensFromChars(incomingChars);
  const projectedTokens = currentTokens + incomingTokens;

  // Abort case: the incoming message alone (plus overhead + output reserve)
  // blows the window. No amount of history-compaction saves this.
  if (incomingTokens + FIXED_OVERHEAD_TOKENS + outputReserve >= contextWindow) {
    return {
      projectedTokens,
      budget,
      action: 'abort',
      reason: `Incoming message (~${incomingTokens} tok) plus output reservation (${outputReserve}) exceeds the model's ${contextWindow}-token window on its own. Send a shorter message or switch to a larger-context model.`,
    };
  }

  if (projectedTokens <= budget) {
    return {
      projectedTokens,
      budget,
      action: 'send',
      reason: `Projected ${projectedTokens} tok ≤ budget ${budget} (window ${contextWindow}, output reserve ${outputReserve}).`,
    };
  }

  return {
    projectedTokens,
    budget,
    action: 'compact',
    reason: `Projected ${projectedTokens} tok > budget ${budget} (window ${contextWindow}, output reserve ${outputReserve}). Compaction required before send.`,
  };
}
