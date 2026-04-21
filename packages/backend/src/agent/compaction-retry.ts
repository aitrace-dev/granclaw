/**
 * compaction-retry.ts
 *
 * Wraps pi-coding-agent's `session.compact()` with progressive keepRecent
 * escalation so compaction rarely fails on a long-running session.
 *
 * ── Why escalation ───────────────────────────────────────────────────────
 * Pi's compactor picks a cut via `findCutPoint`. If it can land on a turn
 * boundary within `keepRecentTokens`, only the well-behaved `generateSummary`
 * path runs. If the most recent turn alone is bigger than keepRecentTokens,
 * the cut falls INSIDE the turn and pi calls `generateTurnPrefixSummary`.
 *
 * Before pi 0.68.0 that turn-prefix path had a bug: it dropped the
 * `reasoning` option, so providers that require reasoning (e.g. gpt-5 on
 * OpenRouter) 400'd with "Reasoning is mandatory for this endpoint and
 * cannot be disabled" and compaction failed entirely. Pi 0.68.0 fixed the
 * bug, but we keep escalation for two orthogonal reasons:
 *
 *   1. Avoiding split-turn saves an extra LLM call (the turn-prefix
 *      summary is a separate round-trip beyond the normal summary).
 *   2. Defense in depth against future reasoning/endpoint mismatches —
 *      if another provider re-introduces the same class of 400, we
 *      sidestep it instead of surfacing it to the user.
 *
 * ── The ladder ────────────────────────────────────────────────────────────
 * We try progressively larger keepRecentTokens on retry (50% → 70% → 90%
 * of the window). One of these will typically encompass the current huge
 * turn, so `findCutPoint` lands on its boundary and the split-turn path
 * is never exercised.
 *
 * Only "Turn prefix summarization failed" triggers escalation — every
 * other error is opaque and retrying with different keepRecent values
 * will not change the outcome. For the model-switch case (history
 * irreducibly larger than the new window), a final `minimal-keep` pass
 * tightens keepRecent so the retained tail fits.
 *
 * The helper is pure: it takes a compact() and an applySettings()
 * callback, so tests can drive it without booting pi.
 */

const TURN_PREFIX_FAILURE_RE = /turn prefix summarization failed/i;

export interface CompactionIO {
  compact: () => Promise<void>;
  applySettings: (s: { reserveTokens: number; keepRecentTokens: number }) => void;
}

export type CompactionStrategy =
  | 'default'
  | 'avoid-split-50'
  | 'avoid-split-70'
  | 'avoid-split-90'
  | 'minimal-keep';

export interface CompactionAttempt {
  attempt: number;
  strategy: CompactionStrategy;
  error?: Error;
}

export interface CompactionOutcome {
  succeeded: boolean;
  attempts: CompactionAttempt[];
  finalError?: Error;
}

interface EscalationStep {
  strategy: CompactionStrategy;
  reservePct: number;
  keepPct: number;
}

const AVOID_SPLIT_LADDER: EscalationStep[] = [
  { strategy: 'avoid-split-50', reservePct: 0.2, keepPct: 0.5 },
  { strategy: 'avoid-split-70', reservePct: 0.15, keepPct: 0.7 },
  { strategy: 'avoid-split-90', reservePct: 0.1, keepPct: 0.9 },
];

const MINIMAL_KEEP: EscalationStep = {
  strategy: 'minimal-keep',
  reservePct: 0.5,
  keepPct: 0.05,
};

function toTokens(pct: number, window: number, floor = 0): number {
  return Math.max(floor, Math.floor(window * pct));
}

function toError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}

/**
 * Run session.compact() with progressive recovery.
 *
 * Ladder (stops at first success):
 *   1. default                          — caller's current settings.
 *   2. avoid-split-50 (keep = 50%)      — only if default failed with
 *                                         "Turn prefix summarization".
 *   3. avoid-split-70 (keep = 70%)      — same trigger.
 *   4. avoid-split-90 (keep = 90%)      — same trigger.
 *   5. minimal-keep (keep = 5%)         — catch-all: for model-switch
 *                                         where retained tail is still
 *                                         too big. Tight keepRecent
 *                                         forces aggressive reduction.
 *
 * A non-matching error on step 1 skips steps 2-4 (escalation is specific
 * to split-turn) and goes straight to step 5, since minimal-keep is a
 * different recovery for a different failure mode.
 */
export async function runCompactionWithRecovery(
  io: CompactionIO,
  modelContextWindow: number,
): Promise<CompactionOutcome> {
  const attempts: CompactionAttempt[] = [];

  // Step 1: default settings.
  try {
    await io.compact();
    attempts.push({ attempt: 1, strategy: 'default' });
    return { succeeded: true, attempts };
  } catch (err) {
    attempts.push({ attempt: 1, strategy: 'default', error: toError(err) });
  }

  // Steps 2-4: split-turn escalation, only if the last error matches.
  const lastError = () => attempts[attempts.length - 1]?.error;
  if (lastError() && TURN_PREFIX_FAILURE_RE.test(lastError()!.message)) {
    for (const step of AVOID_SPLIT_LADDER) {
      try {
        io.applySettings({
          reserveTokens: toTokens(step.reservePct, modelContextWindow),
          keepRecentTokens: toTokens(step.keepPct, modelContextWindow),
        });
        await io.compact();
        attempts.push({ attempt: attempts.length + 1, strategy: step.strategy });
        return { succeeded: true, attempts };
      } catch (err) {
        attempts.push({
          attempt: attempts.length + 1,
          strategy: step.strategy,
          error: toError(err),
        });
        // If the error changes shape away from "turn prefix", bail from
        // the avoid-split ladder — escalating keepRecent won't help.
        if (!TURN_PREFIX_FAILURE_RE.test(toError(err).message)) break;
      }
    }
  }

  // Step 5: minimal-keep as last resort.
  try {
    io.applySettings({
      reserveTokens: toTokens(MINIMAL_KEEP.reservePct, modelContextWindow),
      keepRecentTokens: toTokens(MINIMAL_KEEP.keepPct, modelContextWindow, 2_000),
    });
    await io.compact();
    attempts.push({ attempt: attempts.length + 1, strategy: 'minimal-keep' });
    return { succeeded: true, attempts };
  } catch (err) {
    const e = toError(err);
    attempts.push({ attempt: attempts.length + 1, strategy: 'minimal-keep', error: e });
    return { succeeded: false, attempts, finalError: e };
  }
}
