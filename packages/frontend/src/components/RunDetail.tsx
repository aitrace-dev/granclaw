import { useState, useEffect, useCallback } from 'react';
import {
  fetchWorkflowRun,
  type WorkflowRunWithSteps,
  type WorkflowRunStep,
  type WorkflowStep,
} from '../lib/api.ts';

interface Props {
  agentId: string;
  workflowId: string;
  runId: string;
  steps: WorkflowStep[];
  onBack: () => void;
}

const statusColors: Record<string, string> = {
  pending: '#64748b',
  running: '#facc15',
  completed: '#4ade80',
  failed: '#f87171',
  skipped: '#475569',
};

const statusIcons: Record<string, string> = {
  pending: '○',
  running: '◉',
  completed: '●',
  failed: '✕',
  skipped: '—',
};

export function RunDetail({ agentId, workflowId, runId, steps, onBack }: Props) {
  const [run, setRun] = useState<WorkflowRunWithSteps | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const loadRun = useCallback(async () => {
    try {
      const data = await fetchWorkflowRun(agentId, workflowId, runId);
      setRun(data);
    } catch { /* ignore polling errors */ }
  }, [agentId, workflowId, runId]);

  useEffect(() => {
    void loadRun();
    // Poll while running
    const id = setInterval(() => { void loadRun(); }, 1500);
    return () => clearInterval(id);
  }, [loadRun]);

  // Stop polling when run is done
  useEffect(() => {
    if (run && run.status !== 'running') {
      // One final load then stop (handled by cleanup)
    }
  }, [run]);

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  if (!run) {
    return <div style={{ padding: '1rem', color: '#94a3b8' }}>Loading run...</div>;
  }

  // Match run_steps to step definitions for names
  const stepMap = new Map(steps.map((s) => [s.id, s]));

  return (
    <div style={{ padding: '1rem' }}>
      <button onClick={onBack} style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: 0, marginBottom: '0.75rem' }}>
        ← Back to workflow
      </button>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h2 style={{ margin: 0, fontSize: '1.1rem', color: '#e2e8f0' }}>
          Run — <span style={{ color: statusColors[run.status] }}>{run.status}</span>
        </h2>
        <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
          {new Date(run.startedAt).toLocaleString()}
          {run.finishedAt && ` · ${((run.finishedAt - run.startedAt) / 1000).toFixed(1)}s`}
        </span>
      </div>

      {/* Step timeline */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
        {run.steps.map((rs: WorkflowRunStep) => {
          const stepDef = stepMap.get(rs.stepId);
          const isExpanded = expanded.has(rs.id);

          return (
            <div key={rs.id} style={{ background: '#1e293b', borderRadius: '4px', overflow: 'hidden' }}>
              <div
                onClick={() => toggle(rs.id)}
                style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 0.75rem', cursor: 'pointer' }}
              >
                <span style={{ color: statusColors[rs.status], fontSize: '0.9rem' }}>
                  {statusIcons[rs.status]}
                </span>
                <span style={{ color: '#e2e8f0', fontSize: '0.85rem', flex: 1 }}>
                  {stepDef?.name ?? rs.stepId}
                </span>
                {rs.durationMs !== null && (
                  <span style={{ fontSize: '0.7rem', color: '#64748b' }}>
                    {(rs.durationMs / 1000).toFixed(1)}s
                  </span>
                )}
                <span style={{ fontSize: '0.7rem', color: '#64748b' }}>
                  {isExpanded ? '▾' : '▸'}
                </span>
              </div>

              {isExpanded && (
                <div style={{ padding: '0 0.75rem 0.75rem', fontSize: '0.8rem' }}>
                  {rs.error && (
                    <div style={{ color: '#f87171', marginBottom: '0.5rem', whiteSpace: 'pre-wrap' }}>
                      Error: {rs.error}
                    </div>
                  )}
                  {rs.input !== null && (
                    <div style={{ marginBottom: '0.5rem' }}>
                      <div style={{ color: '#94a3b8', fontSize: '0.7rem', marginBottom: '0.25rem' }}>Input:</div>
                      <pre style={{ margin: 0, color: '#cbd5e1', background: '#0f172a', padding: '0.5rem', borderRadius: '4px', overflowY: 'auto', maxHeight: '200px', fontSize: '0.75rem', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                        {typeof rs.input === 'string' ? rs.input : JSON.stringify(rs.input, null, 2)}
                      </pre>
                    </div>
                  )}
                  {rs.output !== null && (
                    <div>
                      <div style={{ color: '#94a3b8', fontSize: '0.7rem', marginBottom: '0.25rem' }}>Output:</div>
                      <pre style={{ margin: 0, color: '#cbd5e1', background: '#0f172a', padding: '0.5rem', borderRadius: '4px', overflowY: 'auto', maxHeight: '200px', fontSize: '0.75rem', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
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
