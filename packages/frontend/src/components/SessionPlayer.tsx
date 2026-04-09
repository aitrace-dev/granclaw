import { useState, useEffect, useRef, useCallback } from 'react';
import type { BrowserSessionDetail } from '../lib/api.ts';
import { fetchBrowserSession, generateBrowserSessionName, browserScreenshotUrl } from '../lib/api.ts';

/* ═══════════════════════════════════════════════════════════════════════════
 *  SessionPlayer
 *  ─────────────
 *  Timeline player for browsing through browser session screenshots.
 *  Supports play/pause, speed control, live mode, and scrubbing.
 * ═══════════════════════════════════════════════════════════════════════════ */

function StatusBadge({ status }: { status: 'active' | 'closed' }) {
  return (
    <span
      className={`rounded-full px-1.5 py-[2px] text-[8px] font-semibold uppercase tracking-[0.1em] ${
        status === 'active'
          ? 'bg-secondary-container text-[#002113]'
          : 'bg-[#33343b] text-on-surface-variant/60'
      }`}
    >
      {status}
    </span>
  );
}

type Speed = 1 | 2 | 4;

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
  const [currentFrame, setCurrentFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<Speed>(1);
  const [live, setLive] = useState(initialSession.status === 'active');

  const screenshots = session.screenshots;
  const totalFrames = screenshots.length;

  // Interval ref for playback
  const playIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Interval ref for live polling
  const liveIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Playback ──────────────────────────────────────────────────────────────

  const stopPlayback = useCallback(() => {
    if (playIntervalRef.current) {
      clearInterval(playIntervalRef.current);
      playIntervalRef.current = null;
    }
    setPlaying(false);
  }, []);

  const startPlayback = useCallback(() => {
    if (playIntervalRef.current) clearInterval(playIntervalRef.current);

    // Base interval: 500ms per frame at 1x (screenshots are typically seconds apart)
    playIntervalRef.current = setInterval(() => {
      setCurrentFrame((prev) => {
        const next = prev + 1;
        if (next >= totalFrames) {
          stopPlayback();
          return prev;
        }
        return next;
      });
    }, Math.round(500 / speed));

    setPlaying(true);
  }, [speed, totalFrames, stopPlayback]);

  // Restart interval when speed changes while playing
  useEffect(() => {
    if (playing) {
      startPlayback();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [speed]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (playIntervalRef.current) clearInterval(playIntervalRef.current);
      if (liveIntervalRef.current) clearInterval(liveIntervalRef.current);
    };
  }, []);

  // ── Live polling ──────────────────────────────────────────────────────────

  const pollSession = useCallback(async () => {
    try {
      const updated = await fetchBrowserSession(agentId, session.id);
      setSession(updated);

      // Auto-advance to latest frame in live mode
      setCurrentFrame(Math.max(0, updated.screenshots.length - 1));

      // Session just closed — name it if unnamed
      if (updated.status === 'closed' && !updated.name) {
        const name = await generateBrowserSessionName(agentId, session.id).catch(() => null);
        if (name) setSession((s) => ({ ...s, name }));
        setLive(false);
      }

      if (updated.status === 'closed') {
        setLive(false);
      }
    } catch (err) {
      console.error('SessionPlayer poll error', err);
    }
  }, [agentId, session.id]);

  useEffect(() => {
    if (live) {
      if (liveIntervalRef.current) clearInterval(liveIntervalRef.current);
      liveIntervalRef.current = setInterval(() => void pollSession(), 2000);
    } else {
      if (liveIntervalRef.current) {
        clearInterval(liveIntervalRef.current);
        liveIntervalRef.current = null;
      }
    }
    return () => {
      if (liveIntervalRef.current) clearInterval(liveIntervalRef.current);
    };
  }, [live, pollSession]);

  // ── Keyboard shortcuts ────────────────────────────────────────────────────

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') { e.preventDefault(); handlePrev(); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); handleNext(); }
      else if (e.key === ' ') { e.preventDefault(); handlePlayPause(); }
      else if (e.key === 'Escape') { onBack(); }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  });

  // ── Image preloading ──────────────────────────────────────────────────────

  useEffect(() => {
    for (let i = 1; i <= 5; i++) {
      const idx = currentFrame + i;
      if (idx < screenshots.length) {
        const img = new Image();
        img.src = browserScreenshotUrl(agentId, session.id, screenshots[idx]);
      }
    }
  }, [currentFrame, screenshots, agentId, session.id]);

  // ── Command mapping ────────────────────────────────────────────────────────

  const currentScreenshotFilename = screenshots[currentFrame] ?? null;

  // Map each command to its frame index (for click-to-jump)
  const commandFrameMap = session.commands.map((cmd) => {
    const frameIdx = cmd.screenshot ? screenshots.indexOf(cmd.screenshot) : -1;
    return { ...cmd, frameIdx };
  });

  // Ref for auto-scrolling active event into view
  const eventListRef = useRef<HTMLDivElement>(null);
  const activeEventRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    activeEventRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [currentFrame]);

  // ── Controls ──────────────────────────────────────────────────────────────

  const handlePlayPause = () => {
    if (playing) {
      stopPlayback();
    } else {
      if (currentFrame >= totalFrames - 1) {
        // At end — restart from beginning
        setCurrentFrame(0);
      }
      startPlayback();
    }
  };

  const handlePrev = () => {
    stopPlayback();
    setLive(false);
    setCurrentFrame((f) => Math.max(0, f - 1));
  };

  const handleNext = () => {
    stopPlayback();
    setLive(false);
    setCurrentFrame((f) => Math.min(totalFrames - 1, f + 1));
  };

  const handleScrub = (e: React.ChangeEvent<HTMLInputElement>) => {
    stopPlayback();
    setLive(false);
    setCurrentFrame(Number(e.target.value));
  };

  const handleLiveToggle = () => {
    if (!live) {
      setCurrentFrame(Math.max(0, screenshots.length - 1));
    }
    setLive((l) => !l);
  };

  // ── Screenshot URL ────────────────────────────────────────────────────────

  const screenshotUrl =
    currentScreenshotFilename
      ? browserScreenshotUrl(agentId, session.id, currentScreenshotFilename)
      : null;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-1 flex-col h-full min-w-0 rounded-lg" style={{ background: '#111319' }}>

      {/* ══ Header ══════════════════════════════════════════════════════════ */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-white/5 flex-shrink-0">
        {/* Back */}
        <button
          onClick={onBack}
          className="flex items-center justify-center w-6 h-6 rounded transition-colors hover:bg-[#282a30] text-on-surface-variant/50 hover:text-on-surface"
          title="Back to sessions"
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
            <path d="M10 3L5 8l5 5V3z" />
          </svg>
        </button>

        {/* Session info */}
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-medium text-on-surface truncate">
            {session.name ?? 'Unnamed session'}
          </p>
          <p className="font-mono text-[9px] text-on-surface-variant/30 truncate">{session.id}</p>
        </div>

        {/* Status + live indicator + frame counter */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <StatusBadge status={session.status} />
          {live && (
            <span className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-secondary animate-pulse inline-block" />
              <span className="text-[8px] uppercase tracking-[0.15em] text-secondary/70 font-semibold">
                live
              </span>
            </span>
          )}
          <span className="font-mono text-[9px] text-on-surface-variant/40 tabular-nums">
            {totalFrames === 0 ? '0 / 0' : `${currentFrame + 1} / ${totalFrames}`}
          </span>
        </div>
      </div>

      {/* ══ Main content: Screenshot + Event Log ════════════════════════════ */}
      <div className="flex-1 flex min-h-0">

        {/* Screenshot area */}
        <div
          className="flex-1 flex items-center justify-center overflow-hidden"
          style={{ background: '#111319', minHeight: 0 }}
        >
          {screenshotUrl ? (
            <img
              key={screenshotUrl}
              src={screenshotUrl}
              alt={`Frame ${currentFrame + 1}`}
              className="max-w-full max-h-full object-contain select-none"
              draggable={false}
              loading="eager"
              style={{ imageRendering: 'auto' }}
            />
          ) : (
            <div className="flex flex-col items-center justify-center text-center p-8">
              <span className="text-[32px] opacity-10 mb-3">🖼</span>
              <p className="font-mono text-[10px] text-on-surface-variant/25">
                No screenshots captured yet
              </p>
            </div>
          )}
        </div>

        {/* Event log panel */}
        {commandFrameMap.length > 0 && (
          <div
            className="w-56 flex-shrink-0 flex flex-col border-l border-white/5 overflow-hidden"
            style={{ background: '#191b22' }}
          >
            <div className="px-3 py-2 border-b border-white/5">
              <span className="text-[8px] uppercase tracking-[0.18em] text-on-surface-variant/35 font-semibold">
                Events ({commandFrameMap.length})
              </span>
            </div>
            <div ref={eventListRef} className="flex-1 overflow-y-auto scrollbar-thin">
              {commandFrameMap.map((cmd, i) => {
                const isActive = cmd.frameIdx === currentFrame;
                const hasFrame = cmd.frameIdx >= 0;
                return (
                  <div
                    key={i}
                    ref={isActive ? activeEventRef : undefined}
                    onClick={() => {
                      if (hasFrame) {
                        stopPlayback();
                        setLive(false);
                        setCurrentFrame(cmd.frameIdx);
                      }
                    }}
                    className={`px-3 py-2 border-b border-white/3 transition-colors ${
                      hasFrame ? 'cursor-pointer hover:bg-[#282a30]/50' : 'opacity-40'
                    } ${isActive ? 'bg-primary/10 border-l-2 border-l-primary' : ''}`}
                  >
                    <p
                      className={`font-mono text-[10px] leading-snug break-all ${
                        isActive ? 'text-primary' : 'text-on-surface-variant/50'
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
        )}
      </div>

      {/* ══ Controls bar ═════════════════════════════════════════════════════ */}
      <div
        className="px-4 py-3 flex flex-col gap-2.5 flex-shrink-0 border-t border-white/5"
        style={{ background: '#1e1f26' }}
      >
        {/* Scrubber */}
        <input
          type="range"
          min={0}
          max={Math.max(0, totalFrames - 1)}
          value={currentFrame}
          onChange={handleScrub}
          disabled={totalFrames === 0}
          className="w-full h-1 accent-primary rounded cursor-pointer disabled:opacity-30"
          style={{ accentColor: 'var(--color-primary, #a178ff)' }}
        />

        {/* Buttons row */}
        <div className="flex items-center gap-2">
          {/* Prev */}
          <button
            onClick={handlePrev}
            disabled={currentFrame === 0 || totalFrames === 0}
            className="rounded bg-primary/15 text-primary/70 hover:bg-primary/25 px-2 py-1 text-[10px] transition-colors disabled:opacity-20"
            title="Previous frame"
          >
            ‹
          </button>

          {/* Play/Pause */}
          <button
            onClick={handlePlayPause}
            disabled={totalFrames === 0}
            className="rounded bg-primary/15 text-primary/70 hover:bg-primary/25 px-3 py-1 text-[10px] transition-colors disabled:opacity-20 font-mono min-w-[40px] text-center"
          >
            {playing ? '⏸' : '▶'}
          </button>

          {/* Next */}
          <button
            onClick={handleNext}
            disabled={currentFrame >= totalFrames - 1 || totalFrames === 0}
            className="rounded bg-primary/15 text-primary/70 hover:bg-primary/25 px-2 py-1 text-[10px] transition-colors disabled:opacity-20"
            title="Next frame"
          >
            ›
          </button>

          <div className="flex-1" />

          {/* Speed selector */}
          <div className="flex items-center gap-1">
            <span className="text-[8px] uppercase tracking-[0.18em] text-on-surface-variant/35 font-semibold mr-1">
              speed
            </span>
            {([1, 2, 4] as Speed[]).map((s) => (
              <button
                key={s}
                onClick={() => setSpeed(s)}
                className={`rounded px-1.5 py-[2px] text-[9px] font-mono transition-colors ${
                  speed === s
                    ? 'bg-primary/25 text-primary'
                    : 'bg-primary/10 text-primary/40 hover:bg-primary/20 hover:text-primary/60'
                }`}
              >
                {s}×
              </button>
            ))}
          </div>

          {/* Live toggle (only for active sessions) */}
          {session.status === 'active' && (
            <button
              onClick={handleLiveToggle}
              className={`rounded px-2 py-[2px] text-[8px] font-semibold uppercase tracking-[0.1em] transition-colors ${
                live
                  ? 'bg-secondary-container text-[#002113]'
                  : 'bg-[#33343b] text-on-surface-variant/50 hover:text-on-surface-variant/80'
              }`}
            >
              live
            </button>
          )}
        </div>

        {/* Frame label row */}
        <div className="flex items-center justify-between">
          <span className="text-[8px] uppercase tracking-[0.18em] text-on-surface-variant/25 font-semibold">
            frames
          </span>
          <span className="font-mono text-[9px] text-on-surface-variant/30 tabular-nums">
            {totalFrames === 0 ? '—' : `${currentFrame + 1} of ${totalFrames}`}
          </span>
        </div>
      </div>
    </div>
  );
}
