/**
 * compaction-retry.test.ts
 *
 * Unit tests for the split-turn escalation + minimal-keep fallback that
 * wraps pi's session.compact(). These cover the real incidents we've
 * seen on bluggie (2026-04-21) without booting pi itself.
 *
 * Background:
 *   - Pi < 0.68.0 had a bug: `generateTurnPrefixSummary` dropped the
 *     `reasoning` option, so reasoning-mandatory endpoints 400'd with
 *     "Turn prefix summarization failed: ... Reasoning is mandatory".
 *   - Pi 0.68.0 fixes it upstream. We still keep escalation because
 *     avoiding split-turn also saves an LLM round-trip, and because
 *     another provider could easily re-introduce the same class of 400.
 */

import { describe, it, expect, vi } from 'vitest';
import { runCompactionWithRecovery, type CompactionIO } from './compaction-retry.js';

const WINDOW = 204_800;

function turnPrefixError(): Error {
  return new Error(
    'Turn prefix summarization failed: 400 Reasoning is mandatory for this endpoint and cannot be disabled.',
  );
}

describe('runCompactionWithRecovery', () => {
  it('returns success on the first attempt when compact() resolves', async () => {
    const compact = vi.fn().mockResolvedValue(undefined);
    const applySettings = vi.fn();
    const io: CompactionIO = { compact, applySettings };

    const out = await runCompactionWithRecovery(io, WINDOW);

    expect(out.succeeded).toBe(true);
    expect(out.attempts).toHaveLength(1);
    expect(out.attempts[0].strategy).toBe('default');
    expect(out.attempts[0].error).toBeUndefined();
    expect(compact).toHaveBeenCalledTimes(1);
    expect(applySettings).not.toHaveBeenCalled();
  });

  it('escalates keepRecent on turn-prefix failure and succeeds at 50% (the common case)', async () => {
    // This reproduces bluggie's 2026-04-21 incident: the latest assistant
    // turn was bigger than the default keepRecentTokens, forcing a split
    // and the reasoning-mandatory 400. 50% of window encompasses it.
    const compact = vi.fn()
      .mockRejectedValueOnce(turnPrefixError())
      .mockResolvedValueOnce(undefined);
    const applySettings = vi.fn();

    const out = await runCompactionWithRecovery({ compact, applySettings }, WINDOW);

    expect(out.succeeded).toBe(true);
    expect(out.attempts.map((a) => a.strategy)).toEqual(['default', 'avoid-split-50']);
    expect(applySettings).toHaveBeenCalledTimes(1);
    expect(applySettings).toHaveBeenCalledWith({
      reserveTokens: Math.floor(WINDOW * 0.2),
      keepRecentTokens: Math.floor(WINDOW * 0.5),
    });
  });

  it('climbs the ladder to 70% when 50% also fails with turn-prefix', async () => {
    const compact = vi.fn()
      .mockRejectedValueOnce(turnPrefixError())
      .mockRejectedValueOnce(turnPrefixError())
      .mockResolvedValueOnce(undefined);
    const applySettings = vi.fn();

    const out = await runCompactionWithRecovery({ compact, applySettings }, WINDOW);

    expect(out.succeeded).toBe(true);
    expect(out.attempts.map((a) => a.strategy)).toEqual([
      'default',
      'avoid-split-50',
      'avoid-split-70',
    ]);
    expect(applySettings).toHaveBeenNthCalledWith(2, {
      reserveTokens: Math.floor(WINDOW * 0.15),
      keepRecentTokens: Math.floor(WINDOW * 0.7),
    });
  });

  it('reaches 90% for pathological turns and still succeeds', async () => {
    const compact = vi.fn()
      .mockRejectedValueOnce(turnPrefixError())
      .mockRejectedValueOnce(turnPrefixError())
      .mockRejectedValueOnce(turnPrefixError())
      .mockResolvedValueOnce(undefined);
    const applySettings = vi.fn();

    const out = await runCompactionWithRecovery({ compact, applySettings }, WINDOW);

    expect(out.succeeded).toBe(true);
    expect(out.attempts.map((a) => a.strategy)).toEqual([
      'default',
      'avoid-split-50',
      'avoid-split-70',
      'avoid-split-90',
    ]);
    expect(applySettings).toHaveBeenNthCalledWith(3, {
      reserveTokens: Math.floor(WINDOW * 0.1),
      keepRecentTokens: Math.floor(WINDOW * 0.9),
    });
  });

  it('bails out of the avoid-split ladder when the error shape changes and jumps to minimal-keep', async () => {
    // If climbing the ladder produces a different error, escalating
    // keepRecent further cannot help — skip to minimal-keep.
    const otherError = new Error('Some unrelated provider 500');
    const compact = vi.fn()
      .mockRejectedValueOnce(turnPrefixError())
      .mockRejectedValueOnce(otherError)
      .mockResolvedValueOnce(undefined);
    const applySettings = vi.fn();

    const out = await runCompactionWithRecovery({ compact, applySettings }, WINDOW);

    expect(out.succeeded).toBe(true);
    expect(out.attempts.map((a) => a.strategy)).toEqual([
      'default',
      'avoid-split-50',
      'minimal-keep',
    ]);
  });

  it('skips the avoid-split ladder entirely on a non-matching first error', async () => {
    // Model-switch case: history is just too large on the new window.
    // Escalating keepRecent won't help — tighten to minimal-keep.
    const compact = vi.fn()
      .mockRejectedValueOnce(new Error('Context length exceeded'))
      .mockResolvedValueOnce(undefined);
    const applySettings = vi.fn();

    const out = await runCompactionWithRecovery({ compact, applySettings }, WINDOW);

    expect(out.succeeded).toBe(true);
    expect(out.attempts.map((a) => a.strategy)).toEqual(['default', 'minimal-keep']);
    expect(applySettings).toHaveBeenCalledTimes(1);
    expect(applySettings).toHaveBeenCalledWith({
      reserveTokens: Math.floor(WINDOW * 0.5),
      keepRecentTokens: Math.max(2_000, Math.floor(WINDOW * 0.05)),
    });
  });

  it('enforces a 2000-token floor on minimal-keep so tiny windows do not starve', async () => {
    // 5% of 16k = 800 tokens, which is effectively "keep nothing recent".
    // The 2k floor gives compaction some anchor so the summary has
    // surrounding context to bind to.
    const compact = vi.fn()
      .mockRejectedValueOnce(new Error('Context length exceeded'))
      .mockResolvedValueOnce(undefined);
    const applySettings = vi.fn();

    await runCompactionWithRecovery({ compact, applySettings }, 16_000);

    expect(applySettings).toHaveBeenCalledWith({
      reserveTokens: Math.floor(16_000 * 0.5),
      keepRecentTokens: 2_000,
    });
  });

  it('reports failure with the final error when every attempt fails', async () => {
    const finalErr = new Error('Provider totally down');
    const compact = vi.fn()
      .mockRejectedValueOnce(turnPrefixError())
      .mockRejectedValueOnce(turnPrefixError())
      .mockRejectedValueOnce(turnPrefixError())
      .mockRejectedValueOnce(turnPrefixError())
      .mockRejectedValueOnce(finalErr);
    const applySettings = vi.fn();

    const out = await runCompactionWithRecovery({ compact, applySettings }, WINDOW);

    expect(out.succeeded).toBe(false);
    expect(out.finalError).toBe(finalErr);
    expect(out.attempts).toHaveLength(5);
    expect(out.attempts[out.attempts.length - 1].strategy).toBe('minimal-keep');
    expect(out.attempts[out.attempts.length - 1].error).toBe(finalErr);
  });

  it('wraps non-Error throwables so callers can rely on .message', async () => {
    const compact = vi.fn()
      .mockRejectedValueOnce('raw string rejection')
      .mockResolvedValueOnce(undefined);
    const applySettings = vi.fn();

    const out = await runCompactionWithRecovery({ compact, applySettings }, WINDOW);

    expect(out.succeeded).toBe(true);
    expect(out.attempts[0].error).toBeInstanceOf(Error);
    expect(out.attempts[0].error?.message).toBe('raw string rejection');
    // String rejection didn't match the turn-prefix regex, so we jumped
    // straight to minimal-keep (not the split-turn ladder).
    expect(out.attempts[1].strategy).toBe('minimal-keep');
  });
});
