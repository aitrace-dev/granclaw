import { useState, useEffect, useRef, useCallback } from 'react';
import type { BrowserSessionDetail, BrowserSessionStatus, SessionCommand } from '../lib/api.ts';
import { fetchBrowserSession, browserVideoUrl, browserLiveWsUrl } from '../lib/api.ts';

/* ═══════════════════════════════════════════════════════════════════════════
 *  SessionPlayer
 *  ─────────────
 *  Renders a browser session two ways:
 *    - closed/stale/crashed → <video> replay of the recorded WebM, with
 *      command markers laid over the scrubber as chapter dots
 *    - active               → live CDP screencast streamed over WebSocket
 *                             (JPEG frames → <img src="data:image/jpeg...">)
 * ═══════════════════════════════════════════════════════════════════════════ */

function StatusBadge({ status }: { status: BrowserSessionStatus }) {
  const style =
    status === 'active'
      ? 'bg-secondary-container text-on-primary'
      : status === 'stale' || status === 'crashed'
      ? 'bg-amber-500/20 text-warning'
      : 'bg-surface-container text-on-surface-variant/60';
  return (
    <span
      className={`rounded-full px-1.5 py-[2px] text-[8px] font-semibold uppercase tracking-[0.1em] ${style}`}
    >
      {status}
    </span>
  );
}

function CommandList({
  commands,
  activeIndex,
  onJump,
}: {
  commands: SessionCommand[];
  activeIndex: number;
  onJump: (index: number) => void;
}) {
  const activeRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    activeRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [activeIndex]);

  if (commands.length === 0) return null;

  return (
    <div className="w-56 flex-shrink-0 flex flex-col border-l border-outline-variant/30 overflow-hidden bg-surface-container">
      <div className="px-3 py-2 border-b border-outline-variant/30">
        <span className="text-[8px] uppercase tracking-[0.18em] text-on-surface-variant/35 font-semibold">
          Events ({commands.length})
        </span>
      </div>
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {commands.map((cmd, i) => {
          const isActive = i === activeIndex;
          return (
            <div
              key={i}
              ref={isActive ? activeRef : undefined}
              onClick={() => onJump(i)}
              className={`px-3 py-2 border-b  border-outline-variant/20 transition-colors cursor-pointer hover:bg-surface-container/50 ${
                isActive ? 'bg-primary/10 border-l-2 border-l-primary' : ''
              }`}
            >
              <p
                className={`font-mono text-[10px] leading-snug break-all ${
                  isActive ? 'text-primary' : 'text-on-surface-variant'
                }`}
              >
                {cmd.args}
              </p>
              <p className="font-mono text-[8px] text-on-surface-variant/20 mt-0.5">
                {new Date(cmd.timestamp).toLocaleTimeString()}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Live view — subscribes to the CDP screencast relay over WS and renders each
 * JPEG frame as the <img src>. Shows a placeholder if the stream errors or
 * agent-browser isn't running.
 */
interface ActiveTabInfo {
  index: number;
  url: string;
  title: string;
}

function LiveView({ agentId, session }: { agentId: string; session: BrowserSessionDetail }) {
  const [frame, setFrame] = useState<string | null>(null);
  const [status, setStatus] = useState<'connecting' | 'attached' | 'error' | 'closed'>('connecting');
  const [errorReason, setErrorReason] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ActiveTabInfo | null>(null);
  const [tabFlash, setTabFlash] = useState(false);

  useEffect(() => {
    const ws = new WebSocket(browserLiveWsUrl(agentId, session.id));
    let alive = true;

    ws.onmessage = (ev) => {
      if (!alive) return;
      try {
        const msg = JSON.parse(ev.data) as {
          type: string;
          data?: string;
          reason?: string;
          detail?: string;
          index?: number;
          url?: string;
          title?: string;
        };
        if (msg.type === 'frame' && msg.data) {
          setFrame(`data:image/jpeg;base64,${msg.data}`);
        } else if (msg.type === 'attached') {
          setStatus('attached');
          // Initial attach carries url/title/index when the relay knows them
          if (msg.url != null && msg.title != null && msg.index != null) {
            setActiveTab({ index: msg.index, url: msg.url, title: msg.title });
          }
        } else if (msg.type === 'tab_changed' && msg.url != null && msg.title != null && msg.index != null) {
          setActiveTab({ index: msg.index, url: msg.url, title: msg.title });
          setTabFlash(true);
          window.setTimeout(() => setTabFlash(false), 900);
        } else if (msg.type === 'unavailable') {
          // Relay couldn't attach (daemon not running, no page targets, or
          // no suitable tab). Clear the last frame so a stale image doesn't
          // masquerade as "live", and surface the reason.
          setFrame(null);
          setStatus('error');
          setErrorReason(msg.reason ?? 'stream unavailable');
        } else if (msg.type === 'error' || msg.type === 'detached') {
          setStatus('error');
          setErrorReason(msg.reason ?? 'stream ended');
        }
      } catch { /* ignore malformed frame */ }
    };
    ws.onclose = () => { if (alive) setStatus('closed'); };
    ws.onerror = () => { if (alive) { setStatus('error'); setErrorReason('websocket error'); } };

    return () => {
      alive = false;
      try { ws.close(); } catch {}
    };
  }, [agentId, session.id]);

  return (
    <div className="flex-1 flex items-center justify-center overflow-hidden relative bg-surface-container-lowest">
      {frame ? (
        <img
          src={frame}
          alt="live browser frame"
          className="max-w-full max-h-full object-contain select-none"
          draggable={false}
        />
      ) : (
        <div className="flex flex-col items-center justify-center text-center p-8">
          <span className="text-[32px] opacity-10 mb-3">📺</span>
          <p className="font-mono text-[10px] text-on-surface-variant/35">
            {status === 'connecting' && 'connecting to live stream…'}
            {status === 'attached' && 'waiting for first frame…'}
            {status === 'error' && `live stream unavailable${errorReason ? ` — ${errorReason}` : ''}`}
            {status === 'closed' && 'live stream closed'}
          </p>
        </div>
      )}

      {/* LIVE badge + active-tab label */}
      <div className="absolute top-3 left-3 flex items-center gap-2 max-w-[60%]">
        <div className="flex items-center gap-1.5 rounded-full bg-black/60 px-2 py-1 flex-shrink-0">
          <span className="w-1.5 h-1.5 rounded-full bg-secondary animate-pulse inline-block" />
          <span className="text-[8px] uppercase tracking-[0.15em] text-secondary/70 font-semibold">
            live
          </span>
        </div>
        {activeTab && (
          <div
            className={`flex items-center gap-1.5 rounded-full bg-black/60 px-2.5 py-1 min-w-0 transition-all duration-500 ${
              tabFlash ? 'ring-1 ring-primary/60 bg-primary/25' : ''
            }`}
            title={activeTab.url}
          >
            <span className="text-[8px] uppercase tracking-[0.15em] text-on-surface-variant/70 font-semibold flex-shrink-0">
              tab {activeTab.index}
            </span>
            <span className="w-1 h-1 rounded-full bg-on-surface-variant/30 flex-shrink-0" />
            <span className="text-[10px] text-on-surface/90 truncate">
              {activeTab.title || activeTab.url}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Replay view — <video> element with command markers laid over the scrubber
 * as chapter dots. Clicking a command seeks to its offset.
 */
function ReplayView({
  agentId,
  session,
}: {
  agentId: string;
  session: BrowserSessionDetail;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);

  const sessionStart = session.createdAt;
  const durationFromMeta = session.closedAt != null ? session.closedAt - session.createdAt : 0;

  const commandOffsets = session.commands.map((cmd) => {
    return Math.max(0, (cmd.timestamp - sessionStart) / 1000);
  });

  let activeIndex = -1;
  for (let i = 0; i < commandOffsets.length; i++) {
    if (commandOffsets[i] <= currentTime + 0.01) activeIndex = i;
  }

  const handleJump = useCallback((i: number) => {
    const video = videoRef.current;
    if (!video) return;
    const t = commandOffsets[i] ?? 0;
    video.currentTime = Math.min(t, video.duration || t);
    void video.play().catch(() => {});
  }, [commandOffsets]);

  const handleLoadedMetadata = () => {
    const d = videoRef.current?.duration ?? 0;
    setDuration(Number.isFinite(d) ? d : 0);
  };

  const handleTimeUpdate = () => {
    setCurrentTime(videoRef.current?.currentTime ?? 0);
  };

  const videoSrc = session.videoValid ? browserVideoUrl(agentId, session.id) : null;
  const effectiveDuration = duration || durationFromMeta / 1000;

  return (
    <>
      <div
        className="flex-1 flex items-center justify-center overflow-hidden relative bg-surface-container-lowest"
        style={{ minHeight: 0 }}
      >
        {videoSrc ? (
          <div className="relative w-full h-full flex items-center justify-center">
            <video
              ref={videoRef}
              src={videoSrc}
              controls
              preload="metadata"
              onLoadedMetadata={handleLoadedMetadata}
              onTimeUpdate={handleTimeUpdate}
              className="max-w-full max-h-full object-contain"
            />
            {effectiveDuration > 0 && session.commands.length > 0 && (
              <div className="absolute left-0 right-0 bottom-[42px] pointer-events-none px-[12px]">
                <div className="relative h-2">
                  {commandOffsets.map((offset, i) => {
                    const pct = Math.min(1, offset / effectiveDuration) * 100;
                    const isActive = i === activeIndex;
                    return (
                      <button
                        key={i}
                        onClick={() => handleJump(i)}
                        style={{ left: `${pct}%` }}
                        className={`absolute top-0 -translate-x-1/2 rounded-full pointer-events-auto transition-all ${
                          isActive
                            ? 'w-2.5 h-2.5 bg-primary ring-2 ring-primary/30'
                            : 'w-1.5 h-1.5 bg-primary/50 hover:bg-primary/80'
                        }`}
                        title={session.commands[i].args}
                      />
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center text-center p-8">
            <span className="text-[32px] opacity-10 mb-3">🎞</span>
            <p className="font-mono text-[10px] text-on-surface-variant/25">
              recording unavailable
            </p>
            {(session.status === 'stale' || session.status === 'crashed') && (
              <p className="font-mono text-[9px] text-warning/50 mt-2">
                session was abandoned before finalizing
              </p>
            )}
          </div>
        )}
      </div>

      <CommandList
        commands={session.commands}
        activeIndex={activeIndex}
        onJump={handleJump}
      />
    </>
  );
}

export function SessionPlayer({
  agentId,
  session: initialSession,
  onBack,
}: {
  agentId: string;
  session: BrowserSessionDetail;
  onBack: () => void;
}) {
  const [session, setSession] = useState<BrowserSessionDetail>(initialSession);

  // Refresh details every 3s while active — flips to replay when status changes
  useEffect(() => {
    if (session.status !== 'active') return;
    const id = setInterval(() => {
      fetchBrowserSession(agentId, session.id)
        .then(setSession)
        .catch(() => {});
    }, 3000);
    return () => clearInterval(id);
  }, [agentId, session.id, session.status]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onBack();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onBack]);

  const isLive = session.status === 'active';

  return (
    <div className="flex flex-1 flex-col h-full min-w-0 rounded-lg bg-surface-container-lowest">

      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-outline-variant/30 flex-shrink-0">
        <button
          onClick={onBack}
          className="flex items-center justify-center w-6 h-6 rounded transition-colors hover:bg-surface-container text-on-surface-variant hover:text-on-surface"
          title="Back to sessions"
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
            <path d="M10 3L5 8l5 5V3z" />
          </svg>
        </button>

        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-medium text-on-surface truncate">
            {session.name ?? 'Unnamed session'}
          </p>
          <p className="font-mono text-[9px] text-on-surface-variant/60 truncate">{session.id}</p>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          <StatusBadge status={session.status} />
          <span className="font-mono text-[9px] text-on-surface-variant/70 tabular-nums">
            {session.commands.length} cmd{session.commands.length === 1 ? '' : 's'}
          </span>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex min-h-0">
        {isLive ? (
          <>
            <LiveView agentId={agentId} session={session} />
            <CommandList
              commands={session.commands}
              activeIndex={session.commands.length - 1}
              onJump={() => {}}
            />
          </>
        ) : (
          <ReplayView agentId={agentId} session={session} />
        )}
      </div>
    </div>
  );
}
