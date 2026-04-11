// packages/frontend/src/pages/TakeoverPage.tsx
import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { browserLiveWsUrl } from '../lib/api.ts';

const VIEWPORT_W = 1280;
const VIEWPORT_H = 800;

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
  const imgRef = useRef<HTMLImageElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Fetch token info on mount
  useEffect(() => {
    if (!token) return;
    fetch(`/api/takeover/${token}`)
      .then((r) => {
        if (r.status === 404) { setExpired(true); return null; }
        return r.json() as Promise<TakeoverInfo>;
      })
      .then((data) => { if (data) setInfo(data); })
      .catch(() => setExpired(true));
  }, [token]);

  // Open browser-live WS once we have session info
  useEffect(() => {
    if (!info) return;
    const ws = new WebSocket(browserLiveWsUrl(info.agentId, info.sessionId));
    wsRef.current = ws;
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data as string) as { type: string; data?: string };
        if (msg.type === 'frame' && msg.data) {
          setFrame(`data:image/jpeg;base64,${msg.data}`);
        }
      } catch {}
    };
    return () => { ws.close(); };
  }, [info]);

  // Focus container for keyboard capture
  useEffect(() => {
    containerRef.current?.focus();
  }, [info]);

  const send = useCallback((payload: unknown) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(payload));
    }
  }, []);

  const toViewport = useCallback((clientX: number, clientY: number) => {
    const rect = imgRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: Math.round(((clientX - rect.left) / rect.width) * VIEWPORT_W),
      y: Math.round(((clientY - rect.top) / rect.height) * VIEWPORT_H),
    };
  }, []);

  const modifiers = useCallback((e: MouseEvent | KeyboardEvent) => {
    return (e.shiftKey ? 8 : 0) | (e.ctrlKey ? 2 : 0) | (e.altKey ? 1 : 0) | (e.metaKey ? 4 : 0);
  }, []);

  // Mouse handlers
  const onMouseMove = (e: React.MouseEvent) => {
    send({ type: 'mouse', eventType: 'mouseMoved', ...toViewport(e.clientX, e.clientY), button: 'none', clickCount: 0, modifiers: modifiers(e.nativeEvent) });
  };
  const onMouseDown = (e: React.MouseEvent) => {
    containerRef.current?.focus();
    send({ type: 'mouse', eventType: 'mousePressed', ...toViewport(e.clientX, e.clientY), button: 'left', clickCount: 1, modifiers: modifiers(e.nativeEvent) });
  };
  const onMouseUp = (e: React.MouseEvent) => {
    send({ type: 'mouse', eventType: 'mouseReleased', ...toViewport(e.clientX, e.clientY), button: 'left', clickCount: 1, modifiers: modifiers(e.nativeEvent) });
  };
  const onWheel = (e: React.WheelEvent) => {
    send({ type: 'scroll', ...toViewport(e.clientX, e.clientY), deltaY: e.deltaY });
  };

  // Keyboard handlers
  const onKeyDown = (e: React.KeyboardEvent) => {
    e.preventDefault();
    if (e.key.length === 1) {
      send({ type: 'insertText', text: e.key });
    } else {
      send({ type: 'key', eventType: 'rawKeyDown', key: e.key, code: e.code, modifiers: modifiers(e.nativeEvent) });
    }
  };
  const onKeyUp = (e: React.KeyboardEvent) => {
    if (e.key.length > 1) {
      send({ type: 'key', eventType: 'keyUp', key: e.key, code: e.code, modifiers: modifiers(e.nativeEvent) });
    }
  };
  const onPaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    if (text) send({ type: 'insertText', text });
  };

  const handleDone = async () => {
    if (!token || submitting) return;
    setSubmitting(true);
    try {
      await fetch(`/api/takeover/${token}/resolve`, { method: 'POST' });
      setDone(true);
    } catch {
      setSubmitting(false);
    }
  };

  if (expired) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#111319]">
        <div className="text-center">
          <p className="text-[18px] font-medium text-on-surface mb-2">Session expired</p>
          <p className="text-[13px] text-on-surface-variant/50">This takeover link has already been used or timed out.</p>
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#111319]">
        <div className="text-center">
          <p className="text-[18px] font-medium text-on-surface mb-2">Done — returning control to agent</p>
          <p className="text-[13px] text-on-surface-variant/50">You can close this tab.</p>
        </div>
      </div>
    );
  }

  if (!info) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#111319]">
        <p className="font-mono text-[11px] text-on-surface-variant/40 animate-pulse">connecting…</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-[#111319] overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 h-12 border-b border-white/5 flex-shrink-0">
        <div className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-secondary animate-pulse" />
          <span className="text-[8px] uppercase tracking-[0.15em] text-secondary/70 font-semibold">live</span>
        </div>
        <span className="text-[12px] text-on-surface flex-1 truncate">{info.reason}</span>
        <button
          onClick={handleDone}
          disabled={submitting}
          className="rounded bg-secondary/20 px-3 py-1.5 font-mono text-[11px] text-secondary transition-all hover:bg-secondary/30 disabled:opacity-40 flex-shrink-0"
        >
          {submitting ? 'Returning…' : 'Done ✓'}
        </button>
      </div>

      {/* Interactive live view */}
      <div
        ref={containerRef}
        tabIndex={0}
        className="flex-1 flex items-center justify-center overflow-hidden outline-none cursor-crosshair"
        onMouseMove={onMouseMove}
        onMouseDown={onMouseDown}
        onMouseUp={onMouseUp}
        onWheel={onWheel}
        onKeyDown={onKeyDown}
        onKeyUp={onKeyUp}
        onPaste={onPaste}
        style={{ background: '#111319' }}
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
          <p className="font-mono text-[10px] text-on-surface-variant/30 animate-pulse">
            waiting for browser stream…
          </p>
        )}
      </div>
    </div>
  );
}
