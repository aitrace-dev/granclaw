import { describe, it, expect } from 'vitest';
import { pickCdpPageForTab, type CdpPage } from './orchestrator/browser-live.js';

/**
 * Unit tests for pickCdpPageForTab — the heuristic that chooses which
 * CDP page target the screencast should bind to.
 *
 * The bluggie incident that motivated the targetId parameter: when two
 * tabs share the same URL (e.g. a stale pre-login wall from a previous
 * session and the agent's fresh logged-in tab both sitting at
 * https://www.reddit.com/), URL-equality alone picks the wrong one —
 * users saw a "please login" wall in the live view while agent
 * snapshots succeeded on the real tab. The targetId tracker (sidecar
 * CDP WS subscribing to Target.targetCreated) records the most
 * recently-created page target; the picker prefers that when set.
 */

function page(id: string, url: string): CdpPage {
  return { id, url, title: '', webSocketDebuggerUrl: `ws://localhost/devtools/page/${id}` };
}

describe('pickCdpPageForTab', () => {
  it('returns null when no pages exist', () => {
    expect(pickCdpPageForTab([], 'https://example.com/')).toBeNull();
  });

  it('prefers preferredTargetId when it matches a known page (disambiguates duplicate URLs)', () => {
    const stale = page('T_stale', 'https://www.reddit.com/');
    const fresh = page('T_fresh', 'https://www.reddit.com/');
    const picked = pickCdpPageForTab([stale, fresh], 'https://www.reddit.com/', 'T_fresh');
    expect(picked?.id).toBe('T_fresh');
  });

  it('falls back to URL match when preferredTargetId is null', () => {
    const p = page('T_a', 'https://example.com/');
    const q = page('T_b', 'about:blank');
    expect(pickCdpPageForTab([p, q], 'https://example.com/', null)?.id).toBe('T_a');
  });

  it('falls back to URL match when preferredTargetId refers to a gone tab', () => {
    const p = page('T_a', 'https://example.com/');
    const picked = pickCdpPageForTab([p], 'https://example.com/', 'T_vanished');
    expect(picked?.id).toBe('T_a');
  });

  it('picks the LAST (newest) exact URL match — the bluggie fix', () => {
    // /json/list returns targets oldest-first. The newest match is at
    // the end — that's the one the agent just opened and the one that
    // should be screencast.
    const oldStale = page('T_old', 'https://www.reddit.com/');
    const newFresh = page('T_new', 'https://www.reddit.com/');
    const picked = pickCdpPageForTab([oldStale, newFresh], 'https://www.reddit.com/');
    expect(picked?.id).toBe('T_new');
  });

  it('falls back to newest non-inert page when no URL matches', () => {
    // After `tab new <url>`, the agent's tab may briefly show about:blank
    // before navigation completes. The picker must skip the inert page
    // and pick the most recently-loaded real tab.
    const blank = page('T_blank', 'about:blank');
    const chrome = page('T_chrome', 'chrome://newtab/');
    const old = page('T_old', 'https://old.example.com/');
    const real = page('T_real', 'https://new.example.com/');
    const picked = pickCdpPageForTab([blank, chrome, old, real], 'https://no-such-url.example.com/');
    expect(picked?.id).toBe('T_real');
  });

  it('returns a page at all cost — falls through to last page if every tab is inert', () => {
    const blank = page('T_blank', 'about:blank');
    const chrome = page('T_chrome', 'chrome://newtab/');
    const picked = pickCdpPageForTab([blank, chrome], 'https://nope.example.com/');
    expect(picked?.id).toBe('T_chrome');
  });

  it('treats view-source:, devtools://, chrome-untrusted:// as inert', () => {
    const vs = page('T_vs', 'view-source:https://example.com/');
    const dt = page('T_dt', 'devtools://devtools/bundled/');
    const ut = page('T_ut', 'chrome-untrusted://whatever/');
    const real = page('T_real', 'https://real.example.com/');
    const picked = pickCdpPageForTab([vs, dt, ut, real], 'https://no-match.example.com/');
    expect(picked?.id).toBe('T_real');
  });

  it('preferredTargetId wins even when activeUrl matches a different tab', () => {
    // The tracker said "the agent just created T_fresh" — we trust it
    // even if some OTHER tab happens to match activeUrl exactly.
    const otherMatch = page('T_other', 'https://www.reddit.com/');
    const fresh = page('T_fresh', 'https://www.reddit.com/r/selfhosted/');
    const picked = pickCdpPageForTab(
      [otherMatch, fresh],
      'https://www.reddit.com/',
      'T_fresh',
    );
    expect(picked?.id).toBe('T_fresh');
  });
});
