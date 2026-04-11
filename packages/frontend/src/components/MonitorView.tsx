import { useState, useEffect } from 'react';
import { fetchMonitor, killJob, type MonitorData, type ProcessInfo } from '../lib/api.ts';

function relativeTime(ms: number): string {
  const diff = Date.now() - ms;
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m ago`;
}

function StatusDot({ color, pulse }: { color: string; pulse?: boolean }) {
  return <span className={`inline-block h-1.5 w-1.5 rounded-full flex-shrink-0 ${pulse ? 'animate-pulse' : ''}`} style={{ background: color }} />;
}

function ProcessCard({ info, label, extra }: { info: ProcessInfo | null; label: string; extra?: React.ReactNode }) {
  if (!info) return null;
  return (
    <div className="rounded bg-surface-container-lowest border border-outline-variant/40 p-3 space-y-2">
      <div className="flex items-center gap-2">
        <StatusDot color="#4ade80" pulse />
        <span className="font-mono text-[10px] text-on-surface/70 font-medium">{label}</span>
        <span className="font-mono text-[9px] text-on-surface-variant/60 ml-auto">PID {info.pid}</span>
      </div>
      <div className="grid grid-cols-4 gap-2">
        <div>
          <p className="text-[8px] uppercase text-on-surface-variant/60 mb-0.5">CPU</p>
          <p className="font-mono text-[11px] text-on-surface/80">{info.cpu}</p>
        </div>
        <div>
          <p className="text-[8px] uppercase text-on-surface-variant/60 mb-0.5">MEM</p>
          <p className="font-mono text-[11px] text-on-surface/80">{info.mem}</p>
        </div>
        <div>
          <p className="text-[8px] uppercase text-on-surface-variant/60 mb-0.5">RSS</p>
          <p className="font-mono text-[11px] text-on-surface/80">{info.rss}</p>
        </div>
        <div>
          <p className="text-[8px] uppercase text-on-surface-variant/60 mb-0.5">Uptime</p>
          <p className="font-mono text-[11px] text-on-surface/80">{info.elapsed}</p>
        </div>
      </div>
      {extra}
      <p className="font-mono text-[8px] text-on-surface-variant/20 truncate" title={info.command}>
        {info.command}
      </p>
    </div>
  );
}

export function MonitorView({ agentId }: { agentId: string }) {
  const [data, setData] = useState<MonitorData | null>(null);

  useEffect(() => {
    const load = () => fetchMonitor(agentId).then(setData).catch(console.error);
    load();
    const id = setInterval(load, 2000);
    return () => clearInterval(id);
  }, [agentId]);

  if (!data) {
    return <div className="text-on-surface-variant/70 text-xs p-6">Loading monitor...</div>;
  }

  const processing = data.jobs.processing;
  const pending = data.jobs.pending;
  const workflows = data.workflows;
  const totalClaude = data.claudeProcesses.length;
  const isIdle = processing.length === 0 && workflows.length === 0 && totalClaude === 0;

  return (
    <div className="flex flex-col h-full" style={{ background: '#111319' }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-outline-variant/30">
        <div className="flex items-center gap-2">
          <span className="text-[13px] opacity-60">📡</span>
          <span className="text-[11px] uppercase tracking-[0.14em] font-medium text-on-surface-variant">
            Monitor
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className={`font-mono text-[9px] ${isIdle ? 'text-on-surface-variant/60' : 'text-secondary'}`}>
            {isIdle ? 'idle' : `${totalClaude} claude session${totalClaude !== 1 ? 's' : ''}`}
          </span>
          <span className="h-1.5 w-1.5 rounded-full animate-pulse" style={{ background: isIdle ? '#475569' : '#4ade80' }} />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-thin">

        {/* ── Processes ── */}
        <div>
          <p className="text-[8px] uppercase tracking-[0.18em] text-on-surface-variant/35 font-semibold mb-2">
            Processes
          </p>
          <div className="space-y-1.5">
            <ProcessCard
              info={data.agent}
              label="Agent Process"
              extra={data.agent ? <span className="font-mono text-[9px] text-primary/40">pid {data.agent.pid}</span> : undefined}
            />
            <ProcessCard
              info={data.guardian}
              label="Guardian (Big Brother)"
            />
            {data.browserProcess && (
              <div className="rounded bg-surface-container-lowest border border-outline-variant/40 p-3">
                <div className="flex items-center gap-2">
                  <StatusDot color="#facc15" pulse />
                  <span className="font-mono text-[10px] text-on-surface/70 font-medium">Browser Daemon</span>
                  <span className="font-mono text-[9px] text-on-surface-variant/60 ml-auto">PID {data.browserProcess.pid}</span>
                </div>
                <div className="grid grid-cols-3 gap-2 mt-2">
                  <div>
                    <p className="text-[8px] uppercase text-on-surface-variant/60 mb-0.5">CPU</p>
                    <p className="font-mono text-[11px] text-on-surface/80">{data.browserProcess.cpu}</p>
                  </div>
                  <div>
                    <p className="text-[8px] uppercase text-on-surface-variant/60 mb-0.5">MEM</p>
                    <p className="font-mono text-[11px] text-on-surface/80">{data.browserProcess.mem}</p>
                  </div>
                  <div>
                    <p className="text-[8px] uppercase text-on-surface-variant/60 mb-0.5">RSS</p>
                    <p className="font-mono text-[11px] text-on-surface/80">{data.browserProcess.rss}</p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── Claude Sessions ── */}
        {totalClaude > 0 && (
          <div>
            <p className="text-[8px] uppercase tracking-[0.18em] text-on-surface-variant/35 font-semibold mb-2">
              Active Claude Sessions — {totalClaude}
            </p>
            <div className="space-y-1.5">
              {data.claudeProcesses.map(cp => (
                <div key={cp.pid} className="rounded bg-surface-container-lowest border border-outline-variant/40 p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <StatusDot color="#a78bfa" pulse />
                    <span className="font-mono text-[10px] text-on-surface/70">claude</span>
                    <span className="font-mono text-[9px] text-on-surface-variant/60 ml-auto">PID {cp.pid}</span>
                  </div>
                  <div className="grid grid-cols-4 gap-2">
                    <div>
                      <p className="text-[8px] uppercase text-on-surface-variant/60 mb-0.5">CPU</p>
                      <p className="font-mono text-[11px] text-on-surface/80">{cp.cpu}</p>
                    </div>
                    <div>
                      <p className="text-[8px] uppercase text-on-surface-variant/60 mb-0.5">MEM</p>
                      <p className="font-mono text-[11px] text-on-surface/80">{cp.mem}</p>
                    </div>
                    <div>
                      <p className="text-[8px] uppercase text-on-surface-variant/60 mb-0.5">RSS</p>
                      <p className="font-mono text-[11px] text-on-surface/80">{cp.rss}</p>
                    </div>
                    <div>
                      <p className="text-[8px] uppercase text-on-surface-variant/60 mb-0.5">Uptime</p>
                      <p className="font-mono text-[11px] text-on-surface/80">{cp.elapsed}</p>
                    </div>
                  </div>
                  <p className="font-mono text-[8px] text-on-surface-variant/20 mt-1.5 break-all leading-relaxed" style={{ whiteSpace: 'pre-wrap' }}>
                    {cp.command}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Jobs ── */}
        <div>
          <p className="text-[8px] uppercase tracking-[0.18em] text-on-surface-variant/35 font-semibold mb-2">
            Job Queue — {processing.length} running, {pending.length} queued
          </p>

          {processing.length === 0 && pending.length === 0 ? (
            <p className="font-mono text-[10px] text-on-surface-variant/25 italic">No active jobs</p>
          ) : (
            <div className="space-y-1.5">
              {processing.map(j => (
                <div key={j.id} className="rounded bg-surface-container-lowest border border-outline-variant/40 p-2.5">
                  <div className="flex items-center gap-2 mb-1">
                    <StatusDot color="#4ade80" pulse />
                    <span className="font-mono text-[9px] text-secondary/70 uppercase">processing</span>
                    <span className="font-mono text-[9px] text-on-surface-variant/60 ml-auto">{j.channelId}</span>
                    <button
                      onClick={() => killJob(agentId, j.id).catch(console.error)}
                      className="text-[8px] px-1.5 py-0.5 rounded bg-red-950/30 text-error/60 hover:text-error hover:bg-red-950/50 transition-colors"
                    >
                      Kill
                    </button>
                  </div>
                  <p className="font-mono text-[10px] text-on-surface-variant leading-relaxed break-words" style={{ whiteSpace: 'pre-wrap' }}>
                    {j.message}
                  </p>
                  <span className="font-mono text-[8px] text-on-surface-variant/20 mt-1 block">{relativeTime(j.createdAt)}</span>
                </div>
              ))}
              {pending.map(j => (
                <div key={j.id} className="rounded bg-surface-container-lowest p-2.5">
                  <div className="flex items-center gap-2 mb-1">
                    <StatusDot color="#64748b" />
                    <span className="font-mono text-[9px] text-on-surface-variant/70 uppercase">queued</span>
                    <span className="font-mono text-[9px] text-on-surface-variant/60 ml-auto">{j.channelId}</span>
                    <button
                      onClick={() => killJob(agentId, j.id).catch(console.error)}
                      className="text-[8px] px-1.5 py-0.5 rounded bg-surface-container text-on-surface-variant/70 hover:text-error transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                  <p className="font-mono text-[10px] text-on-surface-variant/70 leading-relaxed break-words" style={{ whiteSpace: 'pre-wrap' }}>
                    {j.message}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Running Workflows ── */}
        {workflows.length > 0 && (
          <div>
            <p className="text-[8px] uppercase tracking-[0.18em] text-on-surface-variant/35 font-semibold mb-2">
              Running Workflows
            </p>
            <div className="space-y-1.5">
              {workflows.map(w => (
                <div key={w.runId} className="rounded bg-surface-container-lowest border border-outline-variant/40 p-2.5 flex items-center gap-2">
                  <StatusDot color="#facc15" pulse />
                  <div className="flex-1 min-w-0">
                    <span className="font-mono text-[10px] text-on-surface/70">{w.workflowName}</span>
                    <span className="font-mono text-[8px] text-on-surface-variant/60 ml-2">{w.runId.slice(0, 8)}</span>
                  </div>
                  <span className="font-mono text-[9px] text-on-surface-variant/60 flex-shrink-0">{relativeTime(w.startedAt)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
