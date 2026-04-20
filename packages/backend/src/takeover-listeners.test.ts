import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  registerTakeoverResolvedListener,
  fireTakeoverResolved,
  clearTakeoverResolvedListeners,
} from './takeover-listeners.js';

/**
 * Unit tests for the takeover-resolved listener registry.
 *
 * The motivating use case: enterprise builds hook into this event to
 * upload fresh Orbita cookies to the GoLogin cloud so a takeover-driven
 * login persists across machines. The base library MUST NOT let a broken
 * listener leak into the /api/takeover/:token/resolve response — users
 * would see spurious 5xx after a successful resolve.
 */

describe('takeover-listeners', () => {
  beforeEach(() => {
    clearTakeoverResolvedListeners();
  });

  it('fires every registered listener with the agentId', () => {
    const a = vi.fn();
    const b = vi.fn();
    registerTakeoverResolvedListener(a);
    registerTakeoverResolvedListener(b);
    fireTakeoverResolved('agent-1');
    expect(a).toHaveBeenCalledWith('agent-1');
    expect(b).toHaveBeenCalledWith('agent-1');
  });

  it('does nothing when no listeners are registered', () => {
    // Just asserts no throw.
    expect(() => fireTakeoverResolved('agent-xyz')).not.toThrow();
  });

  it('swallows errors thrown synchronously by a listener', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const broken = vi.fn(() => {
      throw new Error('boom');
    });
    const ok = vi.fn();
    registerTakeoverResolvedListener(broken);
    registerTakeoverResolvedListener(ok);
    expect(() => fireTakeoverResolved('agent-2')).not.toThrow();
    // The second listener still ran — one bad listener doesn't block the chain.
    expect(ok).toHaveBeenCalledWith('agent-2');
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('swallows rejections from async listeners', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const async = vi.fn(async () => {
      throw new Error('async-boom');
    });
    registerTakeoverResolvedListener(async);
    // fireTakeoverResolved itself is sync — it must not throw even though
    // the underlying promise rejects.
    expect(() => fireTakeoverResolved('agent-3')).not.toThrow();
    // Yield to the event loop so the promise rejection handler runs.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('clearTakeoverResolvedListeners removes all listeners', () => {
    const a = vi.fn();
    registerTakeoverResolvedListener(a);
    clearTakeoverResolvedListeners();
    fireTakeoverResolved('agent-4');
    expect(a).not.toHaveBeenCalled();
  });
});
