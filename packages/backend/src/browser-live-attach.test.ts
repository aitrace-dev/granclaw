/**
 * browser-live-attach.test.ts
 *
 * Guards the fix for the "bluggie social-logins frozen browser" incident
 * (2026-04-21). Root cause: when the CDP picker binds the screencast to a
 * page target that Orbita considers a background tab (classic duplicate-URL
 * case where two Reddit tabs are open and the picker chose the wrong one),
 * `Page.startScreencast` accepts the command but never emits frames because
 * Chrome's headless=new mode only paints the foreground tab. Verified live
 * against a bluggie container: the same "frozen" target went from 0 → 14
 * frames in 5s once `Page.bringToFront` was sent first.
 *
 * The regression-guard invariants:
 *   1. `Page.bringToFront` is the FIRST command sent after attach — any
 *      other ordering regresses the fix (startScreencast returns ok but
 *      emits 0 frames, user sees a frozen viewport).
 *   2. `Page.startScreencast` is still sent, with the JPEG/quality params
 *      the frontend expects.
 *   3. CDP message ids are monotonically increasing — the existing
 *      `cdpMessageId` counter on the Stream is the single source of truth,
 *      so the helper must not emit conflicting ids.
 */

import { describe, it, expect } from 'vitest';
import { buildAttachCdpCommands } from './orchestrator/browser-live.js';

describe('buildAttachCdpCommands', () => {
  it('sends Page.bringToFront before Page.startScreencast (bluggie frozen-tab fix)', () => {
    let id = 0;
    const payloads = buildAttachCdpCommands(() => ++id).map((p) => JSON.parse(p));
    expect(payloads.map((p) => p.method)).toEqual([
      'Page.bringToFront',
      'Page.startScreencast',
    ]);
  });

  it('uses the frontend-expected screencast params (jpeg, quality 60, 1280x800)', () => {
    let id = 0;
    const [, startScreencast] = buildAttachCdpCommands(() => ++id).map((p) => JSON.parse(p));
    expect(startScreencast.params).toEqual({
      format: 'jpeg',
      quality: 60,
      maxWidth: 1280,
      maxHeight: 800,
      everyNthFrame: 1,
    });
  });

  it('threads the nextId counter so ids stay monotonic and distinct', () => {
    let id = 42;
    const payloads = buildAttachCdpCommands(() => ++id).map((p) => JSON.parse(p));
    expect(payloads[0].id).toBe(43);
    expect(payloads[1].id).toBe(44);
  });
});
