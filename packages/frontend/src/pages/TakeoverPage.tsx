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

  if (expired) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#0b0d12] text-center px-6">
        <div>
          <div className="mb-3 text-4xl">⏳</div>
          <p className="text-[18px] font-medium text-white/90 mb-1">Session expired</p>
          <p className="text-[13px] text-white/40">This takeover link has already been used or timed out.</p>
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#0b0d12] text-center px-6">
        <div>
          <div className="mb-3 text-4xl">✓</div>
          <p className="text-[18px] font-medium text-white/90 mb-1">Returned control to the agent</p>
          <p className="text-[13px] text-white/40">You can close this tab.</p>
        </div>
      </div>
    );
  }

  if (!info) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#0b0d12]">
        <p className="font-mono text-[11px] text-white/30 animate-pulse">connecting…</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-[#0b0d12] overflow-hidden">
      {/* ── Instruction banner ─────────────────────────────────────────────── */}
      <div className="flex items-start gap-3 px-5 py-3 bg-amber-500/10 border-b border-amber-500/20 flex-shrink-0">
        <div className="flex-shrink-0 mt-0.5 w-6 h-6 rounded-full bg-amber-500/20 flex items-center justify-center text-amber-300 text-[13px]">
          !
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-amber-300/80 mb-0.5">
            The agent needs your help
          </p>
          <p className="text-[14px] text-amber-50 leading-snug">{info.reason}</p>
        </div>
      </div>

      {/* ── Browser chrome ────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-3 py-2 bg-[#1a1d24] border-b border-white/5 flex-shrink-0">
        <div className="flex gap-1.5 flex-shrink-0">
          <span className="w-3 h-3 rounded-full bg-red-500/50" />
          <span className="w-3 h-3 rounded-full bg-yellow-500/50" />
          <span className="w-3 h-3 rounded-full bg-green-500/50" />
        </div>
        <div className="flex-1 flex items-center gap-2 bg-[#0b0d12] border border-white/5 rounded-md px-3 py-1.5 min-w-0">
          <span className="text-[11px] text-green-400 flex-shrink-0">🔒</span>
          <span className="text-[12px] font-mono text-white/80 truncate">
            {currentUrl || info.url || 'about:blank'}
          </span>
          {currentTitle && (
            <span className="text-[11px] text-white/30 flex-shrink-0 hidden md:inline">— {currentTitle}</span>
          )}
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
          <span className="text-[10px] font-mono uppercase tracking-wider text-red-400/80">live</span>
        </div>
      </div>

      {/* ── Interactive live view ─────────────────────────────────────────── */}
      <div
        ref={stageRef}
        tabIndex={0}
        className="flex-1 flex items-center justify-center overflow-hidden outline-none cursor-default bg-[#0b0d12]"
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
          <p className="font-mono text-[10px] text-white/30 animate-pulse">
            waiting for browser stream…
          </p>
        )}
      </div>

      {/* ── Footer: feedback + Completed ──────────────────────────────────── */}
      <div className="flex items-center gap-3 px-4 py-3 bg-[#1a1d24] border-t border-white/5 flex-shrink-0">
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
          placeholder="What did you do? (optional)"
          disabled={submitting}
          className="flex-1 bg-[#0b0d12] border border-white/10 rounded-md px-3 py-2 text-[13px] text-white/90 placeholder:text-white/30 focus:outline-none focus:border-white/20 disabled:opacity-50"
        />
        <button
          onClick={handleComplete}
          disabled={submitting}
          className="flex-shrink-0 rounded-md bg-green-500/20 border border-green-500/40 px-4 py-2 text-[13px] font-medium text-green-300 hover:bg-green-500/30 transition-colors disabled:opacity-40"
        >
          {submitting ? 'Returning…' : '✓ Completed'}
        </button>
      </div>
    </div>
  );
}
