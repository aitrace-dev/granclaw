import { useState, useEffect, useCallback } from 'react';
import {
  fetchWorkflowRun,
  cancelWorkflowRun,
  type WorkflowRunWithSteps,
  type WorkflowRunStep,
  type WorkflowStep,
  type RunStepEvent,
} from '../lib/api.ts';
import { buttonGhost, buttonDanger, cardCls } from '../ui/primitives';
import { useT } from '../lib/i18n.tsx';

interface Props {
  agentId: string;
  workflowId: string;
  runId: string;
  steps: WorkflowStep[];
  onBack: () => void;
}

// Tailwind text-color class per status, pulled from the semantic theme
// tokens so both themes stay in sync.
const statusText: Record<string, string> = {
  pending:   'text-on-surface-variant',
  running:   'text-warning',
  completed: 'text-success',
  failed:    'text-error',
  skipped:   'text-on-surface-variant/60',
};

const statusIcons: Record<string, string> = {
  pending: '○',
  running: '◉',
  completed: '●',
  failed: '✕',
  skipped: '—',
};

const eventIcons: Record<RunStepEvent['type'], string> = {
  tool_call: '→',
  tool_result: '←',
  error: '✕',
};

const eventColors: Record<RunStepEvent['type'], string> = {
  tool_call: 'text-primary',
  tool_result: 'text-success',
  error: 'text-error',
};

function previewValue(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v.length > 200 ? v.slice(0, 200) + '…' : v;
  try {
    const s = JSON.stringify(v);
    return s.length > 200 ? s.slice(0, 200) + '…' : s;
  } catch {
    return String(v);
  }
}

export function RunDetail({ agentId, workflowId, runId, steps, onBack }: Props) {
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

  const stepMap = new Map(steps.map((s) => [s.id, s]));

  return (
    <div className="p-4">
      <button onClick={onBack} className={`${buttonGhost} mb-3`}>
        {t('runDetail.back')}
      </button>

      <div className="flex items-center justify-between mb-4">
        <h2 className="font-headline text-xl font-bold text-on-surface">
          {t('runDetail.runLabel')} <span className={statusText[run.status]}>{run.status}</span>
        </h2>
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
            {run.finishedAt && ` · ${((run.finishedAt - run.startedAt) / 1000).toFixed(1)}s`}
          </span>
        </div>
      </div>

      {/* Step timeline */}
      <div className="flex flex-col gap-1">
        {run.steps.map((rs: WorkflowRunStep) => {
          const stepDef = stepMap.get(rs.stepId);
          const isExpanded = expanded.has(rs.id);

          return (
            <div key={rs.id} className={`${cardCls} overflow-hidden`}>
              <div
                onClick={() => toggle(rs.id)}
                className="flex items-center gap-2 px-3 py-2 cursor-pointer"
              >
                <span className={`text-sm ${statusText[rs.status]}`}>
                  {statusIcons[rs.status]}
                </span>
                <span className="text-sm text-on-surface flex-1">
                  {stepDef?.name ?? rs.stepId}
                </span>
                {rs.durationMs !== null && (
                  <span className="font-mono text-[10px] text-on-surface-variant">
                    {(rs.durationMs / 1000).toFixed(1)}s
                  </span>
                )}
                <span className="font-mono text-[10px] text-on-surface-variant">
                  {isExpanded ? '▾' : '▸'}
                </span>
              </div>

              {isExpanded && (
                <div className="px-3 pb-3 text-sm space-y-2">
                  {rs.error && (
                    <div className="text-error whitespace-pre-wrap font-mono text-xs">
                      {t('runDetail.errorPrefix')} {rs.error}
                    </div>
                  )}
                  {rs.events && rs.events.length > 0 && (
                    <div>
                      <div className="font-label text-[10px] font-semibold uppercase tracking-widest text-on-surface-variant mb-1">
                        {t('runDetail.activity')}
                      </div>
                      <div className="flex flex-col gap-1 bg-surface-container-low p-2 rounded">
                        {rs.events.map((ev, i) => {
                          const relTs = rs.startedAt ? ((ev.ts - rs.startedAt) / 1000).toFixed(1) : '';
                          return (
                            <div key={i} className="flex items-start gap-2 font-mono text-[11px]">
                              <span className="text-on-surface-variant/60 w-10 text-right shrink-0">
                                {relTs && `+${relTs}s`}
                              </span>
                              <span className={`shrink-0 ${eventColors[ev.type]}`}>{eventIcons[ev.type]}</span>
                              {ev.type === 'tool_call' && (
                                <div className="flex-1 min-w-0">
                                  <span className="text-on-surface font-semibold">{ev.tool}</span>
                                  {ev.input !== undefined && ev.input !== null && (
                                    <span className="text-on-surface-variant ml-2 break-all">{previewValue(ev.input)}</span>
                                  )}
                                </div>
                              )}
                              {ev.type === 'tool_result' && (
                                <div className="flex-1 min-w-0">
                                  <span className="text-on-surface">{ev.tool}</span>
                                  {ev.output !== undefined && ev.output !== null && (
                                    <span className="text-on-surface-variant ml-2 break-all">{previewValue(ev.output)}</span>
                                  )}
                                </div>
                              )}
                              {ev.type === 'error' && (
                                <div className="flex-1 min-w-0 text-error break-all">{ev.message}</div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  {rs.input !== null && (
                    <div>
                      <div className="font-label text-[10px] font-semibold uppercase tracking-widest text-on-surface-variant mb-1">{t('runDetail.input')}</div>
                      <pre className="font-mono text-xs text-on-surface bg-surface-container-low p-2 rounded overflow-auto max-h-52 whitespace-pre-wrap break-words">
                        {typeof rs.input === 'string' ? rs.input : JSON.stringify(rs.input, null, 2)}
                      </pre>
                    </div>
                  )}
                  {rs.output !== null && (
                    <div>
                      <div className="font-label text-[10px] font-semibold uppercase tracking-widest text-on-surface-variant mb-1">{t('runDetail.output')}</div>
                      <pre className="font-mono text-xs text-on-surface bg-surface-container-low p-2 rounded overflow-auto max-h-52 whitespace-pre-wrap break-words">
                        {typeof rs.output === 'string' ? rs.output : JSON.stringify(rs.output, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
