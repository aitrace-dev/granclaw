/**
 * compaction-events.test.ts
 *
 * Unit tests for translateSessionEvent — the pure function that maps
 * pi's AgentSessionEvent.compaction_{start,end} into StreamChunk values.
 *
 * Why this exists: compaction blocks the agent turn for tens of seconds
 * on bloated contexts. Without the compaction chunks reaching the WS
 * client, useAgentSocket's 90s stream timeout fires and users see a
 * generic "took too long" error (as Hernan/Bluggie did in production).
 * The chat UI also needs these chunks to render a visible "compacting
 * context…" indicator so users stop thinking the agent is hung.
 *
 * The reason-string classification is tested separately because pi may
 * introduce new reasons in future versions; we default unknown reasons
 * to 'threshold' rather than dropping the event.
 */

import { describe, it, expect } from 'vitest';
import { translateSessionEvent } from './runner-pi.js';

describe('translateSessionEvent', () => {
  it('translates compaction_start with reason=manual', () => {
    expect(translateSessionEvent({ type: 'compaction_start', reason: 'manual' })).toEqual({
      type: 'compaction_start',
      reason: 'manual',
    });
  });

  it('translates compaction_start with reason=threshold', () => {
    expect(translateSessionEvent({ type: 'compaction_start', reason: 'threshold' })).toEqual({
      type: 'compaction_start',
      reason: 'threshold',
    });
  });

  it('translates compaction_start with reason=overflow', () => {
    expect(translateSessionEvent({ type: 'compaction_start', reason: 'overflow' })).toEqual({
      type: 'compaction_start',
      reason: 'overflow',
    });
  });

  it('translates compaction_end with the same reason variants', () => {
    for (const reason of ['manual', 'threshold', 'overflow'] as const) {
      expect(translateSessionEvent({ type: 'compaction_end', reason })).toEqual({
        type: 'compaction_end',
        reason,
      });
    }
  });

  it('falls back to "threshold" when pi emits an unknown reason string', () => {
    // Guards against silent drop if pi adds a new reason later.
    expect(translateSessionEvent({ type: 'compaction_start', reason: 'budget' })).toEqual({
      type: 'compaction_start',
      reason: 'threshold',
    });
  });

  it('falls back to "threshold" when reason is missing entirely', () => {
    expect(translateSessionEvent({ type: 'compaction_end' })).toEqual({
      type: 'compaction_end',
      reason: 'threshold',
    });
  });

  it('returns null for non-compaction events (no accidental forwarding)', () => {
    expect(translateSessionEvent({ type: 'message_update' })).toBeNull();
    expect(translateSessionEvent({ type: 'tool_execution_start' })).toBeNull();
    expect(translateSessionEvent({ type: 'agent_end' })).toBeNull();
  });

  it('returns null for malformed input', () => {
    expect(translateSessionEvent({} as any)).toBeNull();
    expect(translateSessionEvent({ type: undefined } as any)).toBeNull();
    // @ts-expect-error - deliberately passing a non-object
    expect(translateSessionEvent(null)).toBeNull();
  });
});
