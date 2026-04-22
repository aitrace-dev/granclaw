/**
 * browser-error-classify.test.ts
 *
 * Locks in the BrowserErrorCategory contract. The bluggie incident of
 * 2026-04-22 showed the agent hallucinating "Browser crashed after the
 * heavy session" from an indistinct error — the fix is a stable
 * category vocabulary the tool description instructs the LLM on. These
 * tests make sure the classifier doesn't regress silently when we bump
 * agent-browser or pi.
 */

import { describe, it, expect } from 'vitest';
import { classifyBrowserError } from './runner-pi.js';

describe('classifyBrowserError', () => {
  it('ABORTED when the signal is aborted, regardless of err shape', () => {
    const ac = new AbortController();
    ac.abort();
    expect(classifyBrowserError(new Error('whatever'), ac.signal)).toBe('ABORTED');
  });

  it('ABORTED for node AbortError / ABORT_ERR', () => {
    expect(classifyBrowserError({ name: 'AbortError', message: 'The operation was aborted' })).toBe('ABORTED');
    expect(classifyBrowserError({ code: 'ABORT_ERR' })).toBe('ABORTED');
  });

  it('TIMEOUT when execFile kills the child (killed+SIGTERM, Node timeout option)', () => {
    // This is the exact shape Node's child_process.exec/execFile produces
    // when the `timeout` option fires.
    expect(classifyBrowserError({ killed: true, signal: 'SIGTERM', code: null })).toBe('TIMEOUT');
  });

  it('TIMEOUT for ETIMEDOUT (socket/network level)', () => {
    expect(classifyBrowserError({ code: 'ETIMEDOUT', message: 'timeout' })).toBe('TIMEOUT');
  });

  it('BROWSER_DIED on ECONNREFUSED (daemon gone)', () => {
    expect(classifyBrowserError({ stderr: 'connect ECONNREFUSED 127.0.0.1:9222' })).toBe('BROWSER_DIED');
  });

  it('BROWSER_DIED on Target closed / Session closed / Protocol error', () => {
    expect(classifyBrowserError({ stderr: 'Error: Target closed' })).toBe('BROWSER_DIED');
    expect(classifyBrowserError({ message: 'Session closed' })).toBe('BROWSER_DIED');
    expect(classifyBrowserError({ stdout: 'Protocol error: Network.disable' })).toBe('BROWSER_DIED');
  });

  it('BROWSER_DIED when agent-browser reports no session / daemon not running', () => {
    expect(classifyBrowserError({ stderr: 'agent-browser: daemon not running' })).toBe('BROWSER_DIED');
    expect(classifyBrowserError({ stderr: 'No session named bluggie' })).toBe('BROWSER_DIED');
  });

  it('TIMEOUT fallback when the message mentions timeout and no stronger signal', () => {
    expect(classifyBrowserError({ stderr: 'Navigation timeout of 30000 ms exceeded' })).toBe('TIMEOUT');
  });

  it('CMD_ERROR for ordinary command failures (no matching signal)', () => {
    expect(classifyBrowserError({ stderr: 'element not found: e12' })).toBe('CMD_ERROR');
    expect(classifyBrowserError(new Error('unknown subcommand'))).toBe('CMD_ERROR');
    expect(classifyBrowserError('plain string error')).toBe('CMD_ERROR');
  });

  it('prefers the signal over a timeout-looking stderr (the user cancelled IS ABORTED, not TIMEOUT)', () => {
    const ac = new AbortController();
    ac.abort();
    expect(classifyBrowserError({ stderr: 'Navigation timeout of 30000 ms exceeded' }, ac.signal)).toBe('ABORTED');
  });
});
