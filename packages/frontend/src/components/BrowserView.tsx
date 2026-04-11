import { useState, useEffect } from 'react';
import type { BrowserSessionSummary, BrowserSessionDetail } from '../lib/api.ts';
import { fetchBrowserSessions, fetchBrowserSession, launchBrowser, closeBrowser, fetchBrowserProfile, deleteBrowserProfile } from '../lib/api.ts';
import { SessionPlayer } from './SessionPlayer.tsx';

/* ═══════════════════════════════════════════════════════════════════════════
 *  BrowserView
 *  ────────────
 *  Shows a list of browser sessions for an agent, and allows drilling
 *  into a session to view it in the SessionPlayer.
 * ═══════════════════════════════════════════════════════════════════════════ */

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function formatDuration(createdAt: number, closedAt: number | null): string {
  const end = closedAt ?? Date.now();
  const ms = end - createdAt;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function StatusBadge({ status }: { status: 'active' | 'closed' | 'stale' | 'crashed' }) {
  const style =
    status === 'active'
      ? 'bg-secondary-container text-[#002113]'
      : status === 'stale' || status === 'crashed'
      ? 'bg-amber-500/20 text-amber-300'
      : 'bg-[#33343b] text-on-surface-variant/60';
  return (
    <span
      className={`rounded-full px-1.5 py-[2px] text-[8px] font-semibold uppercase tracking-[0.1em] ${style}`}
    >
      {status}
    </span>
  );
}

function SessionCard({
  session,
  onClick,
}: {
  session: BrowserSessionSummary;
  onClick: () => void;
}) {
  const isActive = session.status === 'active';

  return (
    <button
      onClick={onClick}
      className="w-full text-left rounded-md transition-colors hover:brightness-110"
      style={{ background: isActive ? '#1e1f26' : '#191b22' }}
    >
      <div className="p-3">
        {isActive && (
          <div
            className="absolute top-3 right-3 w-1.5 h-1.5 rounded-full bg-secondary animate-pulse"
            style={{ position: 'absolute' }}
          />
        )}
        <div className="flex items-start justify-between gap-2 relative">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-medium text-on-surface truncate">
              {session.name ?? 'Unnamed session'}
            </p>
            <p className="font-mono text-[9px] text-on-surface-variant/30 mt-0.5 truncate">
              {session.id}
            </p>
          </div>
          <div className="flex flex-col items-end gap-1 flex-shrink-0">
            <StatusBadge status={session.status} />
            {isActive && (
              <span className="w-1.5 h-1.5 rounded-full bg-secondary animate-pulse inline-block" />
            )}
          </div>
        </div>

        <div className="flex items-center gap-3 mt-2">
          <span className="font-mono text-[9px] text-on-surface-variant/30">
            {session.videoValid ? 'video' : 'no recording'}
          </span>
          <span className="font-mono text-[9px] text-on-surface-variant/20">·</span>
          <span className="font-mono text-[9px] text-on-surface-variant/30">
            {formatDuration(session.createdAt, session.closedAt)}
          </span>
          <span className="font-mono text-[9px] text-on-surface-variant/20">·</span>
          <span className="font-mono text-[9px] text-on-surface-variant/30">
            {relativeTime(session.createdAt)}
          </span>
        </div>
      </div>
    </button>
  );
}

function BrowserLauncher({ agentId }: { agentId: string }) {
  const [url, setUrl] = useState('');
  const [launching, setLaunching] = useState(false);
  const [activeUrl, setActiveUrl] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  const [hasProfile, setHasProfile] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadProfile = () => {
    fetchBrowserProfile(agentId).then(data => {
      setHasProfile(data.hasProfile);
      setActiveUrl(data.activeBrowser?.url ?? null);
    }).catch(console.error);
  };

  useEffect(() => { loadProfile(); }, [agentId]);

  async function handleLaunch() {
    if (!url.trim()) return;
    setLaunching(true);
    setError(null);
    try {
      await launchBrowser(agentId, url.trim());
      setActiveUrl(url.trim());
      setUrl('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to launch');
    } finally {
      setLaunching(false);
    }
  }

  async function handleClose() {
    setClosing(true);
    setError(null);
    try {
      await closeBrowser(agentId);
      setActiveUrl(null);
      setHasProfile(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to close');
    } finally {
      setClosing(false);
    }
  }

  async function handleDeleteProfile() {
    if (!confirm('Delete browser profile? All saved logins will be lost.')) return;
    await deleteBrowserProfile(agentId);
    setHasProfile(false);
    loadProfile();
  }

  const inputCls = 'rounded bg-[#33343b] px-2.5 py-[7px] text-[11px] text-on-surface placeholder:text-on-surface-variant/30 outline-none focus:ring-1 focus:ring-primary/25 font-mono transition-shadow';

  return (
    <div className="px-4 py-3 border-b border-white/5 space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-[13px] opacity-60">🔑</span>
        <span className="text-[11px] uppercase tracking-[0.14em] font-medium text-on-surface-variant">
          Browser Login
        </span>
        {hasProfile && (
          <span className="ml-auto text-[9px] font-mono text-secondary/50">profile saved</span>
        )}
      </div>

      {activeUrl ? (
        <div className="space-y-2">
          <p className="font-mono text-[10px] text-secondary/60">
            Browser open — log in, then close when done. Profile saves automatically.
          </p>
          <button
            onClick={handleClose}
            disabled={closing}
            className="w-full rounded bg-secondary/20 px-3 py-2 font-mono text-[11px] text-secondary transition-all hover:bg-secondary/30 disabled:opacity-30"
          >
            {closing ? 'Closing…' : 'Close Browser'}
          </button>
        </div>
      ) : (
        <div className="flex gap-1.5">
          <input
            className={`${inputCls} flex-1 min-w-0`}
            placeholder="https://linkedin.com/login"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleLaunch()}
          />
          <button
            onClick={handleLaunch}
            disabled={launching || !url.trim()}
            className="rounded bg-[#33343b] px-2.5 py-[7px] text-[11px] text-on-surface-variant/50 transition-all disabled:opacity-20 hover:bg-[#282a30] hover:text-on-surface flex-shrink-0"
          >
            {launching ? '…' : 'Launch'}
          </button>
        </div>
      )}

      {error && (
        <p className="font-mono text-[9px] text-red-400/70">{error}</p>
      )}

      {hasProfile && !activeUrl && (
        <div className="flex items-center justify-between">
          <span className="font-mono text-[10px] text-on-surface-variant/40">
            Persistent profile — all logins retained
          </span>
          <button
            onClick={handleDeleteProfile}
            className="text-[9px] text-on-surface-variant/30 hover:text-red-400 transition-colors"
          >
            Reset
          </button>
        </div>
      )}
    </div>
  );
}

export function BrowserView({ agentId }: { agentId: string }) {
  const [sessions, setSessions] = useState<BrowserSessionSummary[]>([]);
  const [selectedSession, setSelectedSession] = useState<BrowserSessionDetail | null>(null);
  const [loading, setLoading] = useState(false);

  // Poll sessions list every 5s
  useEffect(() => {
    let cancelled = false;

    const load = () => {
      fetchBrowserSessions(agentId)
        .then((data) => {
          if (!cancelled) {
            // Active sessions pinned at top
            const sorted = [...data].sort((a, b) => {
              if (a.status === 'active' && b.status !== 'active') return -1;
              if (a.status !== 'active' && b.status === 'active') return 1;
              return b.createdAt - a.createdAt;
            });
            setSessions(sorted);
          }
        })
        .catch(console.error);
    };

    load();
    const id = setInterval(load, 5000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [agentId]);

  const handleSelectSession = async (summary: BrowserSessionSummary) => {
    setLoading(true);
    try {
      const detail = await fetchBrowserSession(agentId, summary.id);
      setSelectedSession(detail);
    } catch (err) {
      console.error('Failed to load session', err);
    } finally {
      setLoading(false);
    }
  };

  if (selectedSession) {
    return (
      <SessionPlayer
        agentId={agentId}
        session={selectedSession}
        onBack={() => setSelectedSession(null)}
      />
    );
  }

  return (
    <div className="flex flex-1 flex-col h-full min-w-0 rounded-lg" style={{ background: '#111319' }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
        <div className="flex items-center gap-2">
          <span className="text-[13px] opacity-60">🌐</span>
          <span className="text-[11px] uppercase tracking-[0.14em] font-medium text-on-surface-variant">
            Browser Sessions
          </span>
        </div>
        <span className="font-mono text-[9px] text-on-surface-variant/30 tabular-nums">
          {sessions.length} sessions
        </span>
      </div>

      {/* Manual login launcher */}
      <BrowserLauncher agentId={agentId} />

      {/* Loading overlay */}
      {loading && (
        <div className="flex items-center justify-center py-8">
          <span className="font-mono text-[10px] text-on-surface-variant/30 animate-pulse">
            loading session…
          </span>
        </div>
      )}

      {/* Session list */}
      {!loading && (
        <div className="flex-1 overflow-y-auto p-3 space-y-1.5 scrollbar-thin">
          {sessions.length === 0 ? (
            <div className="flex items-center justify-center flex-1">
              <div className="max-w-lg w-full mx-auto text-center px-8">
                <img
                  src="/browser-onboarding.png"
                  alt=""
                  className="w-44 h-44 mx-auto mb-6 opacity-90"
                />
                <h2 className="font-display text-xl font-semibold text-on-surface mb-3">
                  Set up browser access
                </h2>
                <p className="text-[13px] text-on-surface-variant/50 leading-relaxed mb-8 max-w-sm mx-auto">
                  Your agent needs a browser profile to access websites with your saved logins.
                </p>
                <div className="flex flex-col gap-4 max-w-xs mx-auto text-left mb-8">
                  <div className="flex items-start gap-4">
                    <span className="w-7 h-7 rounded-full bg-primary/15 text-primary text-[12px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5">1</span>
                    <div>
                      <p className="text-[13px] text-on-surface/80 font-medium">Launch a browser</p>
                      <p className="text-[11px] text-on-surface-variant/40 mt-0.5">Enter a login URL above and click Launch</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-4">
                    <span className="w-7 h-7 rounded-full bg-primary/15 text-primary text-[12px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5">2</span>
                    <div>
                      <p className="text-[13px] text-on-surface/80 font-medium">Log in to your accounts</p>
                      <p className="text-[11px] text-on-surface-variant/40 mt-0.5">Sign in to any website the agent needs access to</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-4">
                    <span className="w-7 h-7 rounded-full bg-primary/15 text-primary text-[12px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5">3</span>
                    <div>
                      <p className="text-[13px] text-on-surface/80 font-medium">Close the browser</p>
                      <p className="text-[11px] text-on-surface-variant/40 mt-0.5">Your logins are saved automatically for the agent to reuse</p>
                    </div>
                  </div>
                </div>
                <p className="font-mono text-[10px] text-on-surface-variant/20">
                  Sessions will appear here once the agent starts browsing.
                </p>
              </div>
            </div>
          ) : (
            sessions.map((session) => (
              <SessionCard
                key={session.id}
                session={session}
                onClick={() => void handleSelectSession(session)}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}
