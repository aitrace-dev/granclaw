import { useState, useEffect, useCallback } from 'react';
import {
  fetchWorkflowRun,
  cancelWorkflowRun,
  type WorkflowRunWithSteps,
  type WorkflowRunStep,
  type RunStepEvent,
} from '../lib/api.ts';
import { buttonGhost, buttonDanger } from '../ui/primitives';
import { useT } from '../lib/i18n.tsx';

interface Props {
  agentId: string;
  workflowId: string;
  runId: string;
  onBack: () => void;
}

const statusColor: Record<string, string> = {
  pending:   'text-on-surface-variant',
  running:   'text-warning',
  completed: 'text-success',
  failed:    'text-error',
  skipped:   'text-on-surface-variant/60',
};

const statusDot: Record<string, string> = {
  pending:   'bg-on-surface-variant/40',
  running:   'bg-warning',
  completed: 'bg-success',
  failed:    'bg-error',
  skipped:   'bg-on-surface-variant/30',
};

function shortenValue(v: unknown, max = 120): string {
  if (v == null) return '';
  let s = typeof v === 'string' ? v : JSON.stringify(v);
  s = s.replace(/\/Users\/[^/]+\/[^"}\s]*/g, (p) => '…/' + p.split('/').slice(-2).join('/'));
  return s.length > max ? s.slice(0, max) + '…' : s;
}

function formatOutput(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') {
    try { const parsed = JSON.parse(v); return JSON.stringify(parsed, null, 2); } catch { return v; }
  }
  return JSON.stringify(v, null, 2);
}

function formatDuration(ms: number | null): string {
  if (ms == null) return '';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function RunDetail({ agentId, workflowId, runId, onBack }: Props) {
  const { t } = useT();
  const [run, setRun] = useState<WorkflowRunWithSteps | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [cancelling, setCancelling] = useState(false);

  const loadRun = useCallback(async () => {
    try {
      const data = await fetchWorkflowRun(agentId, workflowId, runId);
      setRun(data);
    } catch { /* ignore polling errors */ }
  }, [agentId, workflowId, runId]);

  useEffect(() => {
    void loadRun();
    const id = setInterval(() => { void loadRun(); }, 1500);
    return () => clearInterval(id);
  }, [loadRun]);

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  if (!run) {
    return (
      <div className="p-4 font-mono text-sm text-on-surface-variant">
        {t('runDetail.loading')}
      </div>
    );
  }

  const totalDuration = run.finishedAt ? (run.finishedAt - run.startedAt) : null;

  return (
    <div className="flex-1 flex flex-col overflow-hidden p-4">
      {/* Header */}
      <div className="flex-shrink-0 mb-4">
        <button onClick={onBack} className={`${buttonGhost} mb-3`}>
          {t('runDetail.back')}
        </button>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h2 className="font-headline text-lg font-bold text-on-surface">
              {t('runDetail.runLabel')}
            </h2>
            <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${statusColor[run.status]} bg-current/10`}>
              <span className={`h-1.5 w-1.5 rounded-full ${statusDot[run.status]}`} />
              {run.status}
            </span>
          </div>
          <div className="flex items-center gap-3">
            {run.status === 'running' && (
              <button
                disabled={cancelling}
                onClick={async () => {
                  setCancelling(true);
                  try {
                    await cancelWorkflowRun(agentId, workflowId, runId);
                    await loadRun();
                  } catch { /* ignore */ }
                  setCancelling(false);
                }}
                className={buttonDanger}
              >
                {cancelling ? t('runDetail.cancelling') : t('runDetail.cancel')}
              </button>
            )}
            <span className="font-mono text-[11px] text-on-surface-variant">
              {new Date(run.startedAt).toLocaleString()}
              {totalDuration != null && ` · ${formatDuration(totalDuration)}`}
            </span>
          </div>
        </div>
      </div>

      {/* Step timeline */}
      <div className="flex-1 overflow-y-auto">
        <div className="flex flex-col gap-0">
          {run.steps.map((rs: WorkflowRunStep, idx: number) => {
            const displayName = rs.nodeName ?? rs.nodeId ?? rs.stepId;
            const iterLabel = rs.iteration != null ? ` #${rs.iteration + 1}` : '';
            const isExpanded = expanded.has(rs.id);
            const isIteration = rs.iteration != null;
            const isLast = idx === run.steps.length - 1;

            return (
              <div key={rs.id} className="flex">
                {/* Timeline rail */}
                <div className="flex flex-col items-center w-6 shrink-0">
                  <div className={`h-3 w-px ${idx === 0 ? 'bg-transparent' : 'bg-outline-variant/40'}`} />
                  <div className={`h-2.5 w-2.5 rounded-full shrink-0 ${statusDot[rs.status]} ${rs.status === 'running' ? 'animate-pulse' : ''}`} />
                  <div className={`flex-1 w-px ${isLast ? 'bg-transparent' : 'bg-outline-variant/40'}`} />
                </div>

                {/* Content */}
                <div className={`flex-1 min-w-0 pb-1 ${isIteration ? 'ml-4' : ''}`}>
                  <div
                    onClick={() => toggle(rs.id)}
                    className="flex items-center gap-2 py-1.5 cursor-pointer group"
                  >
                    <span className={`text-sm font-medium ${rs.status === 'failed' ? 'text-error' : 'text-on-surface'} ${isIteration ? 'text-xs text-on-surface-variant' : ''}`}>
                      {displayName}{iterLabel}
                    </span>
                    {rs.durationMs != null && rs.durationMs > 0 && (
                      <span className="font-mono text-[10px] text-on-surface-variant/60">
                        {formatDuration(rs.durationMs)}
                      </span>
                    )}
                    <span className="font-mono text-[10px] text-on-surface-variant/40 opacity-0 group-hover:opacity-100 transition-opacity">
                      {isExpanded ? '▾' : '▸'}
                    </span>
                  </div>

                  {isExpanded && (
                    <div className="pb-2 space-y-2">
                      {/* Error */}
                      {rs.error && (
                        <div className="text-error text-xs font-mono bg-error/5 border border-error/20 rounded p-2 whitespace-pre-wrap">
                          {rs.error}
                        </div>
                      )}

                      {/* Activity */}
                      {rs.events && rs.events.length > 0 && (
                        <div className="bg-surface-container-low rounded border border-outline-variant/20 overflow-hidden">
                          <div className="px-2 py-1 border-b border-outline-variant/20">
                            <span className="font-label text-[9px] font-semibold uppercase tracking-widest text-on-surface-variant/60">
                              {t('runDetail.activity')}
                            </span>
                          </div>
                          <div className="max-h-48 overflow-y-auto divide-y divide-outline-variant/10">
                            {rs.events.map((ev: RunStepEvent, i: number) => {
                              const relTs = rs.startedAt ? ((ev.ts - rs.startedAt) / 1000).toFixed(1) : '';
                              return (
                                <div key={i} className="flex items-start gap-2 px-2 py-1 font-mono text-[10px] hover:bg-surface-container">
                                  <span className="text-on-surface-variant/40 w-8 text-right shrink-0">
                                    {relTs && `+${relTs}s`}
                                  </span>
                                  {ev.type === 'tool_call' && (
                                    <div className="flex-1 min-w-0 flex items-baseline gap-1.5">
                                      <span className="text-primary shrink-0">→</span>
                                      <span className="text-on-surface font-semibold shrink-0">{ev.tool}</span>
                                      {ev.input != null && (
                                        <span className="text-on-surface-variant/60 truncate">{shortenValue(ev.input)}</span>
                                      )}
                                    </div>
                                  )}
                                  {ev.type === 'tool_result' && (
                                    <div className="flex-1 min-w-0 flex items-baseline gap-1.5">
                                      <span className="text-success shrink-0">←</span>
                                      <span className="text-on-surface shrink-0">{ev.tool}</span>
                                      {ev.output != null && (
                                        <span className="text-on-surface-variant/60 truncate">{shortenValue(ev.output)}</span>
                                      )}
                                    </div>
                                  )}
                                  {ev.type === 'error' && (
                                    <div className="flex-1 min-w-0 flex items-baseline gap-1.5">
                                      <span className="text-error shrink-0">✕</span>
                                      <span className="text-error truncate">{ev.message}</span>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* Output — show by default, more useful than input */}
                      {rs.output != null && (
                        <details className="group/details">
                          <summary className="font-label text-[9px] font-semibold uppercase tracking-widest text-on-surface-variant/60 cursor-pointer select-none hover:text-on-surface-variant">
                            {t('runDetail.output')}
                          </summary>
                          <pre className="mt-1 font-mono text-[11px] text-on-surface bg-surface-container-low border border-outline-variant/20 p-2 rounded overflow-auto max-h-40 whitespace-pre-wrap break-words">
                            {formatOutput(rs.output)}
                          </pre>
                        </details>
                      )}

                      {/* Input — collapsed */}
                      {rs.input != null && (
                        <details className="group/details">
                          <summary className="font-label text-[9px] font-semibold uppercase tracking-widest text-on-surface-variant/60 cursor-pointer select-none hover:text-on-surface-variant">
                            {t('runDetail.input')}
                          </summary>
                          <pre className="mt-1 font-mono text-[11px] text-on-surface bg-surface-container-low border border-outline-variant/20 p-2 rounded overflow-auto max-h-40 whitespace-pre-wrap break-words">
                            {formatOutput(rs.input)}
                          </pre>
                        </details>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
