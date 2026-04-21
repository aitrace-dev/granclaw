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

  it('returns null when every tab is inert — never bind to about:blank / chrome://…', () => {
    // Hard UX rule (see isInertUrl comment + §3.1 of vault/features/browser.md):
    // the takeover view must never show about:blank or chrome://newtab, even
    // if that's the only thing Orbita has open. Returning null lets the poll
    // loop emit `{type:'unavailable'}` instead, so the frontend shows a
    // loading placeholder until a real page appears.
    const blank = page('T_blank', 'about:blank');
    const chrome = page('T_chrome', 'chrome://newtab/');
    const picked = pickCdpPageForTab([blank, chrome], 'https://nope.example.com/');
    expect(picked).toBeNull();
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

  // ── Regressions ──────────────────────────────────────────────────────────

  it('falls through to URL match when preferredTargetId points to an inert (chrome://) page', () => {
    // Bluggie regression (2026-04-20, "waiting for stream"): Orbita emits
    // Target.targetCreated for internal pages (chrome://newtab/, extension
    // pages, etc.) as well as the agent's real tab. The tracker records
    // the LAST page target it sees, which can be an inert one. When that
    // happens, the picker must not stubbornly return the inert page — it
    // should fall through to URL match so the screencast binds to a tab
    // that actually paints.
    const inert = page('T_inert', 'chrome://newtab/');
    const real = page('T_real', 'https://www.reddit.com/');
    const picked = pickCdpPageForTab(
      [inert, real],
      'https://www.reddit.com/',
      'T_inert',
    );
    expect(picked?.id).toBe('T_real');
  });

  it('falls through when preferredTargetId points to a chrome-extension:// page', () => {
    // GoLogin / Orbita extensions expose pages at chrome-extension://<id>/...
    // These are pages from CDP's POV but aren't content the user wants
    // streamed.
    const ext = page('T_ext', 'chrome-extension://abcd/popup.html');
    const real = page('T_real', 'https://www.linkedin.com/');
    const picked = pickCdpPageForTab(
      [ext, real],
      'https://www.linkedin.com/',
      'T_ext',
    );
    expect(picked?.id).toBe('T_real');
  });

  it('honours preferredTargetId when it points to a real http(s) page, even if URL differs', () => {
    // Sanity: the inert-fallthrough must NOT trigger for ordinary pages.
    // A real http(s) preferredTargetId still beats URL match.
    const other = page('T_other', 'https://example.com/');
    const fresh = page('T_fresh', 'https://www.reddit.com/r/x/');
    const picked = pickCdpPageForTab(
      [other, fresh],
      'https://example.com/',
      'T_fresh',
    );
    expect(picked?.id).toBe('T_fresh');
  });
});
