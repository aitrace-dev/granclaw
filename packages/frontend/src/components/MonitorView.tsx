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

function StatusDot({ tone, pulse }: { tone: 'success' | 'warning' | 'primary' | 'info' | 'muted' | 'muted-dim'; pulse?: boolean }) {
  const cls =
    tone === 'success' ? 'bg-success' :
    tone === 'warning' ? 'bg-warning' :
    tone === 'primary' ? 'bg-primary' :
    tone === 'info' ? 'bg-info' :
    tone === 'muted' ? 'bg-outline' :
    'bg-outline/50';
  return <span className={`inline-block h-1.5 w-1.5 rounded-full flex-shrink-0 ${pulse ? 'animate-pulse' : ''} ${cls}`} />;
}

function ProcessCard({ info, label, extra }: { info: ProcessInfo | null; label: string; extra?: React.ReactNode }) {
  if (!info) return null;
  return (
    <div className="rounded bg-surface-container-lowest border border-outline-variant/40 p-3 space-y-2">
      <div className="flex items-center gap-2">
        <StatusDot tone="success" pulse />
        <span className="font-label text-[10px] uppercase tracking-wider text-on-surface font-semibold">{label}</span>
        <span className="font-mono text-[9px] text-on-surface-variant/60 ml-auto">PID {info.pid}</span>
      </div>
      <div className="grid grid-cols-4 gap-2">
        <div>
          <p className="font-label text-[8px] uppercase tracking-wider text-on-surface-variant mb-0.5">CPU</p>
          <p className="font-mono text-[11px] text-on-surface/80">{info.cpu}</p>
        </div>
        <div>
          <p className="font-label text-[8px] uppercase tracking-wider text-on-surface-variant mb-0.5">MEM</p>
          <p className="font-mono text-[11px] text-on-surface/80">{info.mem}</p>
        </div>
        <div>
          <p className="font-label text-[8px] uppercase tracking-wider text-on-surface-variant mb-0.5">RSS</p>
          <p className="font-mono text-[11px] text-on-surface/80">{info.rss}</p>
        </div>
        <div>
          <p className="font-label text-[8px] uppercase tracking-wider text-on-surface-variant mb-0.5">Uptime</p>
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
    return <div className="text-on-surface-variant/70 text-xs p-6">Cargando monitor...</div>;
  }

  const processing = data.jobs.processing;
  const pending = data.jobs.pending;
  const workflows = data.workflows;
  const totalClaude = data.claudeProcesses.length;
  const isIdle = processing.length === 0 && workflows.length === 0 && totalClaude === 0;

  return (
    <div className="flex flex-col h-full min-w-0 bg-surface-container-lowest">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-outline-variant/30">
        <div className="flex items-center gap-2">
          <span className="text-[13px] opacity-60">📡</span>
          <span className="font-label text-[11px] uppercase tracking-[0.14em] font-semibold text-on-surface">
            Monitor
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className={`font-mono text-[9px] ${isIdle ? 'text-on-surface-variant/60' : 'text-secondary'}`}>
            {isIdle ? 'inactivo' : `${totalClaude} sesión${totalClaude !== 1 ? 'es' : ''} claude`}
          </span>
          <span className={`h-1.5 w-1.5 rounded-full animate-pulse ${isIdle ? 'bg-outline/50' : 'bg-success'}`} />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-thin">

        {/* ── Processes ── */}
        <div>
          <p className="font-label text-[9px] uppercase tracking-[0.18em] text-on-surface-variant font-semibold mb-2">
            Procesos
          </p>
          <div className="space-y-1.5">
            <ProcessCard
              info={data.agent}
              label="Proceso del Agente"
              extra={data.agent ? <span className="font-mono text-[9px] text-primary/40">pid {data.agent.pid}</span> : undefined}
            />
            <ProcessCard
              info={data.guardian}
              label="Guardián (Big Brother)"
            />
            {data.browserProcess && (
              <div className="rounded bg-surface-container-lowest border border-outline-variant/40 p-3">
                <div className="flex items-center gap-2">
                  <StatusDot tone="warning" pulse />
                  <span className="font-label text-[10px] uppercase tracking-wider text-on-surface font-semibold">Demonio de Navegador</span>
                  <span className="font-mono text-[9px] text-on-surface-variant/60 ml-auto">PID {data.browserProcess.pid}</span>
                </div>
                <div className="grid grid-cols-3 gap-2 mt-2">
                  <div>
                    <p className="font-label text-[8px] uppercase tracking-wider text-on-surface-variant mb-0.5">CPU</p>
                    <p className="font-mono text-[11px] text-on-surface/80">{data.browserProcess.cpu}</p>
                  </div>
                  <div>
                    <p className="font-label text-[8px] uppercase tracking-wider text-on-surface-variant mb-0.5">MEM</p>
                    <p className="font-mono text-[11px] text-on-surface/80">{data.browserProcess.mem}</p>
                  </div>
                  <div>
                    <p className="font-label text-[8px] uppercase tracking-wider text-on-surface-variant mb-0.5">RSS</p>
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
            <p className="font-label text-[9px] uppercase tracking-[0.18em] text-on-surface-variant font-semibold mb-2">
              Sesiones Claude Activas — {totalClaude}
            </p>
            <div className="space-y-1.5">
              {data.claudeProcesses.map(cp => (
                <div key={cp.pid} className="rounded bg-surface-container-lowest border border-outline-variant/40 p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <StatusDot tone="primary" pulse />
                    <span className="font-mono text-[10px] text-on-surface/70">claude</span>
                    <span className="font-mono text-[9px] text-on-surface-variant/60 ml-auto">PID {cp.pid}</span>
                  </div>
                  <div className="grid grid-cols-4 gap-2">
                    <div>
                      <p className="font-label text-[8px] uppercase tracking-wider text-on-surface-variant mb-0.5">CPU</p>
                      <p className="font-mono text-[11px] text-on-surface/80">{cp.cpu}</p>
                    </div>
                    <div>
                      <p className="font-label text-[8px] uppercase tracking-wider text-on-surface-variant mb-0.5">MEM</p>
                      <p className="font-mono text-[11px] text-on-surface/80">{cp.mem}</p>
                    </div>
                    <div>
                      <p className="font-label text-[8px] uppercase tracking-wider text-on-surface-variant mb-0.5">RSS</p>
                      <p className="font-mono text-[11px] text-on-surface/80">{cp.rss}</p>
                    </div>
                    <div>
                      <p className="font-label text-[8px] uppercase tracking-wider text-on-surface-variant mb-0.5">Uptime</p>
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
          <p className="font-label text-[9px] uppercase tracking-[0.18em] text-on-surface-variant font-semibold mb-2">
            Cola de trabajos — {processing.length} en proceso, {pending.length} en espera
          </p>

          {processing.length === 0 && pending.length === 0 ? (
            <p className="text-[10px] text-on-surface-variant italic">Sin trabajos activos</p>
          ) : (
            <div className="space-y-1.5">
              {processing.map(j => (
                <div key={j.id} className="rounded bg-surface-container-lowest border border-outline-variant/40 p-2.5">
                  <div className="flex items-center gap-2 mb-1">
                    <StatusDot tone="success" pulse />
                    <span className="font-mono text-[9px] text-secondary/70 uppercase">procesando</span>
                    <span className="font-mono text-[9px] text-on-surface-variant/60 ml-auto">{j.channelId}</span>
                    <button
                      onClick={() => killJob(agentId, j.id).catch(console.error)}
                      className="text-[8px] px-1.5 py-0.5 rounded bg-red-950/30 text-error/60 hover:text-error hover:bg-red-950/50 transition-colors"
                    >
                      Terminar
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
                    <StatusDot tone="muted" />
                    <span className="font-mono text-[9px] text-on-surface-variant/70 uppercase">en cola</span>
                    <span className="font-mono text-[9px] text-on-surface-variant/60 ml-auto">{j.channelId}</span>
                    <button
                      onClick={() => killJob(agentId, j.id).catch(console.error)}
                      className="text-[8px] px-1.5 py-0.5 rounded bg-surface-container text-on-surface-variant/70 hover:text-error transition-colors"
                    >
                      Cancelar
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
            <p className="font-label text-[9px] uppercase tracking-[0.18em] text-on-surface-variant font-semibold mb-2">
              Flujos de trabajo en ejecución
            </p>
            <div className="space-y-1.5">
              {workflows.map(w => (
                <div key={w.runId} className="rounded bg-surface-container-lowest border border-outline-variant/40 p-2.5 flex items-center gap-2">
                  <StatusDot tone="warning" pulse />
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
