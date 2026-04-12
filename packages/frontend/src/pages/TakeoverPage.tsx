// packages/frontend/src/pages/TakeoverPage.tsx
import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { browserLiveWsUrl } from '../lib/api.ts';

// Fallback viewport — only used before the first frame arrives. After that
// we read the actual frame dimensions from img.naturalWidth/Height so the
// coordinate mapping is always correct, even if agent-browser resizes.
const FALLBACK_VIEWPORT_W = 1280;
const FALLBACK_VIEWPORT_H = 800;
const DOUBLE_CLICK_MS = 500;
const DOUBLE_CLICK_PX = 5;

/**
 * Windows virtual key codes for common non-printable keys. Chromium's CDP
 * requires this field on Input.dispatchKeyEvent for keys like Backspace,
 * Delete, and the arrow keys to be processed as special keys — otherwise
 * the page sees an opaque "key event" but doesn't actually delete or move
 * the caret.
 *
 * Puppeteer ships a full us-keyboard-layout table; we only need the
 * non-printable ones because printable characters go through Input.insertText.
 */
const SPECIAL_KEYS: Record<string, number> = {
  Backspace: 8,
  Tab: 9,
  Enter: 13,
  Shift: 16,
  Control: 17,
  Alt: 18,
  Pause: 19,
  CapsLock: 20,
  Escape: 27,
  PageUp: 33,
  PageDown: 34,
  End: 35,
  Home: 36,
  ArrowLeft: 37,
  ArrowUp: 38,
  ArrowRight: 39,
  ArrowDown: 40,
  Insert: 45,
  Delete: 46,
  Meta: 91,
  ContextMenu: 93,
  F1: 112, F2: 113, F3: 114, F4: 115, F5: 116, F6: 117,
  F7: 118, F8: 119, F9: 120, F10: 121, F11: 122, F12: 123,
};

interface TakeoverInfo {
  agentId: string;
  sessionId: string;
  reason: string;
  url: string | null;
}

export function TakeoverPage() {
  const { token } = useParams<{ token: string }>();
  const [info, setInfo] = useState<TakeoverInfo | null>(null);
  const [expired, setExpired] = useState(false);
  const [frame, setFrame] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [note, setNote] = useState('');
  const [currentUrl, setCurrentUrl] = useState<string>('');
  const [currentTitle, setCurrentTitle] = useState<string>('');
  const imgRef = useRef<HTMLImageElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef<string | null>(null); // 'left' | 'right' | 'middle' while drag
  const lastClickRef = useRef({ time: 0, x: 0, y: 0 });

  // Fetch token info on mount
  useEffect(() => {
    if (!token) return;
    fetch(`/api/takeover/${token}`)
      .then((r) => {
        if (r.status === 404) { setExpired(true); return null; }
        return r.json() as Promise<TakeoverInfo>;
      })
      .then((data) => {
        if (!data) return;
        setInfo(data);
        if (data.url) setCurrentUrl(data.url);
      })
      .catch(() => setExpired(true));
  }, [token]);

  // Open browser-live WS once we have session info
  useEffect(() => {
    if (!info) return;
    const ws = new WebSocket(browserLiveWsUrl(info.agentId, info.sessionId));
    wsRef.current = ws;
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data as string) as {
          type: string;
          data?: string;
          url?: string;
          title?: string;
        };
        if (msg.type === 'frame' && msg.data) {
          setFrame(`data:image/jpeg;base64,${msg.data}`);
        } else if (msg.type === 'attached' || msg.type === 'tab_changed') {
          if (msg.url) setCurrentUrl(msg.url);
          if (msg.title) setCurrentTitle(msg.title);
        }
      } catch {}
    };
    return () => {
      ws.onmessage = null;
      ws.close();
    };
  }, [info]);

  // Focus stage for keyboard capture
  useEffect(() => {
    stageRef.current?.focus();
  }, [info]);

  const send = useCallback((payload: unknown) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(payload));
    }
  }, []);

  const toViewport = useCallback((clientX: number, clientY: number) => {
    const img = imgRef.current;
    if (!img) return { x: 0, y: 0 };
    const rect = img.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return { x: 0, y: 0 };
    // Use the actual decoded frame size. This is the source of truth for
    // where CDP expects clicks — regardless of how object-contain scales
    // the image on screen.
    const vw = img.naturalWidth || FALLBACK_VIEWPORT_W;
    const vh = img.naturalHeight || FALLBACK_VIEWPORT_H;
    // Clamp to the image bounds so clicks in the letterboxing don't map
    // to negative or out-of-range CDP coordinates.
    const px = Math.max(0, Math.min(rect.width, clientX - rect.left));
    const py = Math.max(0, Math.min(rect.height, clientY - rect.top));
    return {
      x: Math.round((px / rect.width) * vw),
      y: Math.round((py / rect.height) * vh),
    };
  }, []);

  const modifiers = useCallback((e: MouseEvent | KeyboardEvent) => {
    return (e.shiftKey ? 8 : 0) | (e.ctrlKey ? 2 : 0) | (e.altKey ? 1 : 0) | (e.metaKey ? 4 : 0);
  }, []);

  const buttonName = (b: number): string => b === 2 ? 'right' : b === 1 ? 'middle' : 'left';

  // ── Mouse handlers ─────────────────────────────────────────────────────────

  const onMouseMove = (e: React.MouseEvent) => {
    const { x, y } = toViewport(e.clientX, e.clientY);
    // While a button is pressed (drag), CDP expects the button state so the
    // page can run its drag-select / drag-drop handlers correctly.
    send({
      type: 'mouse',
      eventType: 'mouseMoved',
      x, y,
      button: draggingRef.current ?? 'none',
      clickCount: 0,
      modifiers: modifiers(e.nativeEvent),
    });
  };

  const onMouseDown = (e: React.MouseEvent) => {
    stageRef.current?.focus();
    const { x, y } = toViewport(e.clientX, e.clientY);
    const button = buttonName(e.button);
    // Double-click detection: same spot within 500ms → clickCount: 2
    const now = Date.now();
    const dt = now - lastClickRef.current.time;
    const dx = Math.abs(x - lastClickRef.current.x);
    const dy = Math.abs(y - lastClickRef.current.y);
    const clickCount = (dt < DOUBLE_CLICK_MS && dx < DOUBLE_CLICK_PX && dy < DOUBLE_CLICK_PX) ? 2 : 1;
    lastClickRef.current = { time: now, x, y };
    draggingRef.current = button;
    send({
      type: 'mouse',
      eventType: 'mousePressed',
      x, y,
      button,
      clickCount,
      modifiers: modifiers(e.nativeEvent),
    });
  };

  const onMouseUp = (e: React.MouseEvent) => {
    const { x, y } = toViewport(e.clientX, e.clientY);
    const button = buttonName(e.button);
    const clickCount = lastClickRef.current.time === 0 ? 1
      : (Date.now() - lastClickRef.current.time < DOUBLE_CLICK_MS ? 2 : 1);
    draggingRef.current = null;
    send({
      type: 'mouse',
      eventType: 'mouseReleased',
      x, y,
      button,
      clickCount,
      modifiers: modifiers(e.nativeEvent),
    });
  };

  const onMouseLeave = () => {
    // End any in-progress drag if the cursor leaves the stage, otherwise
    // subsequent moves would be interpreted as drag outside the viewport.
    if (draggingRef.current) draggingRef.current = null;
  };

  const onWheel = (e: React.WheelEvent) => {
    send({ type: 'scroll', ...toViewport(e.clientX, e.clientY), deltaY: e.deltaY });
  };

  // ── Keyboard handlers ──────────────────────────────────────────────────────

  const onKeyDown = (e: React.KeyboardEvent) => {
    // Let the user type in the note field without swallowing their input
    if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
    e.preventDefault();
    const vkc = SPECIAL_KEYS[e.key];
    if (e.key.length === 1) {
      // Printable char: use insertText so contenteditable (LinkedIn, Gmail,
      // etc.) captures it. Still dispatch a rawKeyDown so sites that listen
      // for keydown see the event.
      send({
        type: 'key',
        eventType: 'rawKeyDown',
        key: e.key,
        code: e.code,
        modifiers: modifiers(e.nativeEvent),
        windowsVirtualKeyCode: e.key.toUpperCase().charCodeAt(0),
      });
      send({ type: 'insertText', text: e.key });
    } else {
      // Special keys (Enter, Backspace, Delete, Arrow*, Tab, Escape, etc.):
      // CDP needs the Windows virtual key code for Chromium to treat the
      // event as an actual special key. Without it Backspace is silently
      // ignored by input handlers.
      send({
        type: 'key',
        eventType: 'rawKeyDown',
        key: e.key,
        code: e.code,
        modifiers: modifiers(e.nativeEvent),
        windowsVirtualKeyCode: vkc ?? 0,
      });
    }
  };

  const onKeyUp = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
    const vkc = e.key.length === 1
      ? e.key.toUpperCase().charCodeAt(0)
      : (SPECIAL_KEYS[e.key] ?? 0);
    send({
      type: 'key',
      eventType: 'keyUp',
      key: e.key,
      code: e.code,
      modifiers: modifiers(e.nativeEvent),
      windowsVirtualKeyCode: vkc,
    });
  };

  const onPaste = (e: React.ClipboardEvent) => {
    if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    if (text) send({ type: 'insertText', text });
  };

  // ── Resolve ────────────────────────────────────────────────────────────────

  const handleComplete = async () => {
    if (!token || submitting) return;
    setSubmitting(true);
    try {
      await fetch(`/api/takeover/${token}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: note.trim() || undefined }),
      });
      wsRef.current?.close();
      setDone(true);
    } catch {
      setSubmitting(false);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  // ── Render: Scholarly Sanctuary ───────────────────────────────────────────
  //
  // "Ink on paper": warm paper background, deep charcoal ink, serif body,
  // mono for machine text (URL, labels). Sections are separated by
  // surface-container tiers — no 1px sectioning borders (the design forbids
  // them). Rounded-sm corners per the tailwind config.

  if (expired) {
    return (
      <div className="flex h-screen items-center justify-center bg-background font-body text-on-surface px-6">
        <div className="text-center max-w-md">
          <p className="text-[11px] font-label uppercase tracking-[0.15em] text-secondary/70 mb-2">
            takeover
          </p>
          <h1 className="font-headline text-[32px] leading-tight text-on-surface mb-3">
            Session expired
          </h1>
          <p className="text-[15px] leading-relaxed text-on-surface-variant italic">
            This takeover link has already been used or timed out.
          </p>
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div className="flex h-screen items-center justify-center bg-background font-body text-on-surface px-6">
        <div className="text-center max-w-md">
          <p className="text-[11px] font-label uppercase tracking-[0.15em] text-primary/70 mb-2">
            complete
          </p>
          <h1 className="font-headline text-[32px] leading-tight text-on-surface mb-3">
            Returned control to the agent
          </h1>
          <p className="text-[15px] leading-relaxed text-on-surface-variant italic">
            You can close this tab.
          </p>
        </div>
      </div>
    );
  }

  if (!info) {
    return (
      <div className="flex h-screen items-center justify-center bg-background font-body">
        <p className="font-mono text-[11px] text-on-surface-variant/60 animate-pulse">
          connecting…
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-background font-body text-on-surface overflow-hidden">
      {/* ── Instruction "In-set Plate" ─────────────────────────────────────── */}
      {/* Per DESIGN.md §5: callouts use a subtle primary-container tonal shift
          with no borders. This is the agent speaking to the user. */}
      <div className="flex items-start gap-4 px-8 py-5 bg-surface-container-low flex-shrink-0">
        <div className="flex-shrink-0 mt-1 w-7 h-7 rounded-full bg-primary-fixed flex items-center justify-center">
          <span className="font-headline italic text-[15px] text-primary">!</span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-label uppercase tracking-[0.15em] text-primary/70 mb-1">
            The agent needs your help
          </p>
          <p className="font-headline text-[17px] leading-snug text-on-surface">
            {info.reason}
          </p>
        </div>
      </div>

      {/* ── Browser chrome ────────────────────────────────────────────────── */}
      {/* Stacked on surface-container (one tier up from the plate above) so
          the chrome "floats" above it without needing a line. */}
      <div className="flex items-center gap-3 px-6 py-3 bg-surface-container flex-shrink-0">
        <div className="flex gap-1.5 flex-shrink-0">
          <span className="w-3 h-3 rounded-full bg-secondary/60" />
          <span className="w-3 h-3 rounded-full bg-tertiary-fixed" />
          <span className="w-3 h-3 rounded-full bg-primary/40" />
        </div>
        {/* URL "float" — surface-container-lowest on surface-container, the
            classic no-border depth trick from DESIGN.md §2. */}
        <div className="flex-1 flex items-center gap-2 bg-surface-container-lowest rounded-md px-3 py-1.5 min-w-0">
          <span className="text-[11px] text-primary flex-shrink-0" aria-hidden>
            ∎
          </span>
          <span className="text-[12px] font-mono text-on-surface truncate">
            {currentUrl || info.url || 'about:blank'}
          </span>
          {currentTitle && (
            <span className="text-[11px] font-body italic text-on-surface-variant/70 flex-shrink-0 hidden md:inline">
              — {currentTitle}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <span className="w-1.5 h-1.5 rounded-full bg-secondary animate-pulse" />
          <span className="text-[10px] font-label uppercase tracking-[0.15em] text-secondary">
            live
          </span>
        </div>
      </div>

      {/* ── Interactive live view ─────────────────────────────────────────── */}
      {/* Lives on surface-container-highest — the deepest tier — so the
          browser image feels "pressed into" the page like a manuscript plate. */}
      <div
        ref={stageRef}
        tabIndex={0}
        className="flex-1 flex items-center justify-center overflow-hidden outline-none cursor-default bg-surface-container-highest"
        onMouseMove={onMouseMove}
        onMouseDown={onMouseDown}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseLeave}
        onWheel={onWheel}
        onKeyDown={onKeyDown}
        onKeyUp={onKeyUp}
        onPaste={onPaste}
        onContextMenu={(e) => e.preventDefault()}
      >
        {frame ? (
          <img
            ref={imgRef}
            src={frame}
            alt="live browser"
            className="max-w-full max-h-full object-contain select-none"
            draggable={false}
            style={{ pointerEvents: 'none' }}
          />
        ) : (
          <p className="font-mono text-[10px] text-on-surface-variant/50 animate-pulse">
            waiting for browser stream…
          </p>
        )}
      </div>

      {/* ── Footer: Minimalist Ledger input + Primary CTA ──────────────────── */}
      {/* Per DESIGN.md §5: text inputs are "minimalist ledger" (bottom border
          only, outline-variant at 30%). The Completed button is the primary
          action — sharp-edged violet block, label font, on-primary text. */}
      <div className="flex items-end gap-4 px-8 py-5 bg-surface-container-low flex-shrink-0">
        <div className="flex-1 flex flex-col">
          <label className="text-[10px] font-label uppercase tracking-[0.15em] text-on-surface-variant/70 mb-1">
            What did you do? <span className="italic text-on-surface-variant/50">(optional)</span>
          </label>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => {
              // Submit on Enter inside the note field
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void handleComplete();
              }
            }}
            placeholder="Describe your action for the agent…"
            disabled={submitting}
            className="bg-transparent border-0 border-b border-outline-variant/30 focus:border-primary focus:outline-none font-body text-[15px] text-on-surface placeholder:text-on-surface-variant/40 placeholder:italic px-0 py-2 disabled:opacity-50"
          />
        </div>
        <button
          onClick={handleComplete}
          disabled={submitting}
          className="flex-shrink-0 rounded-sm bg-primary text-on-primary font-label text-[11px] uppercase tracking-[0.15em] px-5 py-3 hover:bg-primary/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {submitting ? 'Returning…' : 'Completed'}
        </button>
      </div>
    </div>
  );
}
