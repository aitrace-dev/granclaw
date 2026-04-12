import { describe, it, expect, beforeEach } from 'vitest';
import { relayInputToChrome } from './orchestrator/browser-live.js';

/**
 * Unit tests for the CDP input relay handler used by the human browser
 * takeover page.
 *
 * The takeover page (TakeoverPage.tsx) listens for mouse/keyboard/paste
 * events on the screencast image and sends them over WebSocket to
 * browser-live.ts. That handler translates them into CDP commands
 * (Input.dispatchMouseEvent / Input.dispatchKeyEvent / Input.insertText)
 * and forwards them to the Chrome daemon. This test exercises that
 * translation logic without requiring a real browser.
 *
 * Why this matters: the relay is the whole point of the takeover feature —
 * if input isn't forwarded correctly, the user sees frames but can't
 * actually click or type on the page.
 */

interface CapturedSend {
  method?: string;
  params?: Record<string, unknown>;
  id?: number;
}

describe('relayInputToChrome — CDP input relay for takeover page', () => {
  let sent: CapturedSend[];
  let counter: number;
  const nextId = () => ++counter;

  const mockWs = {
    send(data: string) {
      try {
        sent.push(JSON.parse(data));
      } catch {
        sent.push({ method: 'INVALID_JSON' });
      }
    },
  };

  beforeEach(() => {
    sent = [];
    counter = 0;
  });

  // ── Mouse events ─────────────────────────────────────────────────────────────

  it('relays a left-click mousePressed event as Input.dispatchMouseEvent', () => {
    relayInputToChrome(mockWs, nextId, JSON.stringify({
      type: 'mouse',
      eventType: 'mousePressed',
      x: 640,
      y: 400,
      button: 'left',
      clickCount: 1,
      modifiers: 0,
    }));

    expect(sent).toHaveLength(1);
    expect(sent[0].method).toBe('Input.dispatchMouseEvent');
    expect(sent[0].params).toEqual({
      type: 'mousePressed',
      x: 640,
      y: 400,
      button: 'left',
      clickCount: 1,
      modifiers: 0,
    });
    expect(sent[0].id).toBe(1);
  });

  it('supports right-click (not just left) so context menus work', () => {
    relayInputToChrome(mockWs, nextId, JSON.stringify({
      type: 'mouse',
      eventType: 'mousePressed',
      x: 100, y: 200,
      button: 'right',
      clickCount: 1,
    }));

    expect(sent[0].params?.button).toBe('right');
  });

  it('relays mouseMoved with default button=none when button is omitted', () => {
    relayInputToChrome(mockWs, nextId, JSON.stringify({
      type: 'mouse',
      eventType: 'mouseMoved',
      x: 50, y: 75,
    }));

    expect(sent[0].params?.button).toBe('none');
    expect(sent[0].params?.type).toBe('mouseMoved');
  });

  it('falls back to 0 for non-numeric coordinates rather than NaN', () => {
    relayInputToChrome(mockWs, nextId, JSON.stringify({
      type: 'mouse',
      eventType: 'mousePressed',
      x: 'garbage',
      y: null,
      button: 'left',
    }));

    expect(sent[0].params?.x).toBe(0);
    expect(sent[0].params?.y).toBe(0);
  });

  // ── Keyboard events ──────────────────────────────────────────────────────────

  it('relays a key event as Input.dispatchKeyEvent', () => {
    relayInputToChrome(mockWs, nextId, JSON.stringify({
      type: 'key',
      eventType: 'rawKeyDown',
      key: 'Enter',
      code: 'Enter',
      modifiers: 0,
    }));

    expect(sent).toHaveLength(1);
    expect(sent[0].method).toBe('Input.dispatchKeyEvent');
    expect(sent[0].params).toEqual({
      type: 'rawKeyDown',
      key: 'Enter',
      code: 'Enter',
      modifiers: 0,
    });
  });

  it('drops key events with an empty key (CDP rejects them anyway)', () => {
    relayInputToChrome(mockWs, nextId, JSON.stringify({
      type: 'key',
      eventType: 'rawKeyDown',
      key: '',
      code: '',
    }));

    expect(sent).toHaveLength(0);
  });

  it('defaults to rawKeyDown when eventType is omitted', () => {
    relayInputToChrome(mockWs, nextId, JSON.stringify({
      type: 'key',
      key: 'a',
      code: 'KeyA',
    }));

    expect(sent[0].params?.type).toBe('rawKeyDown');
  });

  // ── Insert text (clipboard paste + contenteditable typing) ───────────────────

  it('relays insertText as Input.insertText', () => {
    relayInputToChrome(mockWs, nextId, JSON.stringify({
      type: 'insertText',
      text: 'Hello, world!',
    }));

    expect(sent).toHaveLength(1);
    expect(sent[0].method).toBe('Input.insertText');
    expect(sent[0].params).toEqual({ text: 'Hello, world!' });
  });

  it('caps insertText at 4096 characters to prevent CDP floods', () => {
    const huge = 'x'.repeat(10_000);

    relayInputToChrome(mockWs, nextId, JSON.stringify({
      type: 'insertText',
      text: huge,
    }));

    expect(sent).toHaveLength(1);
    expect((sent[0].params?.text as string).length).toBe(4096);
  });

  it('drops empty insertText events', () => {
    relayInputToChrome(mockWs, nextId, JSON.stringify({
      type: 'insertText',
      text: '',
    }));

    expect(sent).toHaveLength(0);
  });

  // ── Scroll (mouseWheel) ──────────────────────────────────────────────────────

  it('relays scroll as Input.dispatchMouseEvent type=mouseWheel', () => {
    relayInputToChrome(mockWs, nextId, JSON.stringify({
      type: 'scroll',
      x: 500, y: 300,
      deltaY: -120,
    }));

    expect(sent[0].method).toBe('Input.dispatchMouseEvent');
    expect(sent[0].params).toMatchObject({
      type: 'mouseWheel',
      x: 500,
      y: 300,
      deltaX: 0,
      deltaY: -120,
    });
  });

  // ── Input validation / hardening ────────────────────────────────────────────

  it('ignores malformed JSON silently (no throw, no send)', () => {
    relayInputToChrome(mockWs, nextId, 'not-json{');
    expect(sent).toHaveLength(0);
  });

  it('ignores messages with an unknown type', () => {
    relayInputToChrome(mockWs, nextId, JSON.stringify({ type: 'foo' }));
    expect(sent).toHaveLength(0);
  });

  it('ignores messages with no type at all', () => {
    relayInputToChrome(mockWs, nextId, JSON.stringify({ x: 10, y: 20 }));
    expect(sent).toHaveLength(0);
  });

  it('assigns a monotonically increasing CDP id per relayed message', () => {
    relayInputToChrome(mockWs, nextId, JSON.stringify({ type: 'mouse', eventType: 'mouseMoved', x: 1, y: 1, button: 'none' }));
    relayInputToChrome(mockWs, nextId, JSON.stringify({ type: 'mouse', eventType: 'mouseMoved', x: 2, y: 2, button: 'none' }));
    relayInputToChrome(mockWs, nextId, JSON.stringify({ type: 'insertText', text: 'hi' }));

    expect(sent[0].id).toBe(1);
    expect(sent[1].id).toBe(2);
    expect(sent[2].id).toBe(3);
  });
});
