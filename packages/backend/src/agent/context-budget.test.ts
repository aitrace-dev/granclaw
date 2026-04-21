/**
 * context-budget.test.ts
 *
 * Unit tests for the pre-send token-budget planner. These guard the
 * behavior that prevents provider 400 "maximum context length is X"
 * errors from reaching the user — especially after a model switch from
 * a larger-context model to a smaller one.
 *
 * Real-world trigger (bluggie, 2026-04-21): user on a 204_800-token model,
 * accumulated history hit ~210k, provider 400'd. Pi's own overflow
 * recovery is model-scoped, so it doesn't help when the user switched
 * models mid-session. This planner closes that gap.
 */

import { describe, it, expect } from 'vitest';
import { planContextBudget } from './context-budget.js';

const DEFAULTS = {
  contextWindow: 204_800,
  maxOutputTokens: 8_000,
};

describe('planContextBudget', () => {
  it('sends as-is when projected is well under the budget', () => {
    const plan = planContextBudget({
      currentTokens: 50_000,
      incomingChars: 400, // ≈100 tokens
      ...DEFAULTS,
    });
    expect(plan.action).toBe('send');
    expect(plan.projectedTokens).toBeLessThan(plan.budget);
  });

  it('requests compaction when projected exceeds the budget', () => {
    const plan = planContextBudget({
      currentTokens: 200_000,
      incomingChars: 1_000,
      ...DEFAULTS,
    });
    expect(plan.action).toBe('compact');
    expect(plan.projectedTokens).toBeGreaterThan(plan.budget);
  });

  it('reproduces the bluggie overflow scenario (accumulated history just over the window)', () => {
    // The real incident: 210_662 tokens requested against a 204_800 window.
    // With any realistic output reservation, this must trigger compaction.
    const plan = planContextBudget({
      currentTokens: 210_000,
      incomingChars: 2_000,
      ...DEFAULTS,
    });
    expect(plan.action).toBe('compact');
  });

  it('catches the model-switch case (small window, history from larger model)', () => {
    // User was on a 200k model, switched to a 128k model mid-session.
    // History is 180k tokens; new model window is 128k.
    const plan = planContextBudget({
      currentTokens: 180_000,
      incomingChars: 500,
      contextWindow: 128_000,
      maxOutputTokens: 8_000,
    });
    expect(plan.action).toBe('compact');
  });

  it('aborts when the incoming message alone exceeds the model window', () => {
    // If a user pastes 600k characters (~150k tokens) into a 128k-window
    // model, no amount of compaction can rescue the turn — the ONE
    // message is already over. Must surface a clear error instead of
    // looping compactions that change nothing.
    const plan = planContextBudget({
      currentTokens: 0,
      incomingChars: 600_000,
      contextWindow: 128_000,
      maxOutputTokens: 4_000,
    });
    expect(plan.action).toBe('abort');
    expect(plan.reason).toMatch(/incoming message/i);
  });

  it('caps output reservation at 20% of window so a huge maxTokens does not starve input', () => {
    // Some providers advertise maxTokens equal to the window itself. If
    // we took that at face value we'd have 0 input budget. The 20% cap
    // keeps the budget usable.
    const plan = planContextBudget({
      currentTokens: 60_000,
      incomingChars: 400,
      contextWindow: 128_000,
      maxOutputTokens: 128_000,
    });
    // window 128k * 0.2 = 25.6k reserve → budget = 128k - 25.6k - 2k ≈ 100k
    // 60k + ~100 ≤ ~100k → send
    expect(plan.action).toBe('send');
  });

  it('uses advertised maxTokens when it is smaller than the 20% cap', () => {
    // Small model with a tiny 2k maxTokens — we should NOT inflate the
    // output reserve to 20% of the window just because the cap allows it.
    // Smaller reserve = bigger budget = fewer spurious compactions.
    const tight = planContextBudget({
      currentTokens: 60_000,
      incomingChars: 400,
      contextWindow: 64_000,
      maxOutputTokens: 2_000,
    });
    // budget = 64k - 2k - 2k = 60k. 60k + ~100 > 60k → compact
    expect(tight.action).toBe('compact');
    const loose = planContextBudget({
      currentTokens: 55_000,
      incomingChars: 400,
      contextWindow: 64_000,
      maxOutputTokens: 2_000,
    });
    // 55k + 100 ≤ 60k → send. Proves maxTokens=2k is actually used
    // (not inflated to 20%=12.8k, which would have capped budget at ~49k
    // and pushed this case into 'compact').
    expect(loose.action).toBe('send');
  });

  it('reports a projectedTokens equal to current + ceil(chars/4)', () => {
    const plan = planContextBudget({
      currentTokens: 1_000,
      incomingChars: 17, // ceil(17/4) = 5
      ...DEFAULTS,
    });
    expect(plan.projectedTokens).toBe(1_005);
  });
});
