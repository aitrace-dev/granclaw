import { useState } from 'react';
import {
  type WorkflowWithSteps,
  type WorkflowRun,
  type WorkflowStep,
} from '../lib/api.ts';
import { RunDetail } from './RunDetail.tsx';

interface Props {
  agentId: string;
  workflow: WorkflowWithSteps;
  runs: WorkflowRun[];
  onBack: () => void;
  onRun: () => void;
  onRefreshRuns: () => Promise<void>;
}

const typeColors: Record<string, string> = { code: '#a78bfa', llm: '#38bdf8', agent: '#4ade80' };
const runStatusColors: Record<string, string> = {
  running: '#facc15',
  completed: '#4ade80',
  failed: '#f87171',
  cancelled: '#94a3b8',
};

export function WorkflowDetail({ agentId, workflow, runs, onBack, onRun, onRefreshRuns }: Props) {
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [expandedSteps, setExpandedSteps] = useState<Set<string>>(new Set());

  const toggleStep = (stepId: string) => {
    setExpandedSteps(prev => {
      const next = new Set(prev);
      if (next.has(stepId)) next.delete(stepId);
      else next.add(stepId);
      return next;
    });
  };

  if (selectedRunId) {
    return (
      <RunDetail
        agentId={agentId}
        workflowId={workflow.id}
        runId={selectedRunId}
        steps={workflow.steps}
        onBack={() => { setSelectedRunId(null); void onRefreshRuns(); }}
      />
    );
  }

  return (
    <div style={{ padding: '1rem' }}>
      <button onClick={onBack} style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: 0, marginBottom: '0.75rem' }}>
        ← Back to workflows
      </button>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h2 style={{ margin: 0, fontSize: '1.1rem', color: '#e2e8f0' }}>{workflow.name}</h2>
        <button
          onClick={onRun}
          style={{ padding: '4px 12px', fontSize: '0.8rem', background: '#3b82f6', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
        >
          Run
        </button>
      </div>

      {workflow.description && (
        <p style={{ color: '#94a3b8', fontSize: '0.85rem', margin: '0 0 1rem' }}>{workflow.description}</p>
      )}

      {/* Steps timeline */}
      <h3 style={{ fontSize: '0.9rem', color: '#cbd5e1', margin: '0 0 0.5rem' }}>Steps ({workflow.steps.length})</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', marginBottom: '1.5rem' }}>
        {workflow.steps.map((step: WorkflowStep, i: number) => {
          const config = step.config as unknown as Record<string, unknown>;
          const prompt = (config.prompt ?? config.script ?? '') as string;
          const isExpanded = expandedSteps.has(step.id);
          const timeoutMs = config.timeout_ms as number | undefined;
          return (
            <div
              key={step.id}
              onClick={() => toggleStep(step.id)}
              style={{ padding: '0.5rem', background: '#1e293b', borderRadius: '4px', cursor: 'pointer', transition: 'background 0.15s' }}
              onMouseEnter={e => (e.currentTarget.style.background = '#253047')}
              onMouseLeave={e => (e.currentTarget.style.background = '#1e293b')}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ fontSize: '0.7rem', color: '#64748b', width: '1.5rem', textAlign: 'center' }}>{i + 1}</span>
                <span style={{
                  fontSize: '0.65rem', padding: '1px 5px', borderRadius: '3px',
                  background: typeColors[step.type] ?? '#94a3b8', color: '#0f172a', fontWeight: 600,
                }}>
                  {step.type.toUpperCase()}
                </span>
                <span style={{ color: '#e2e8f0', fontSize: '0.85rem', flex: 1 }}>{step.name}</span>
                {step.transitions && (
                  <span style={{ fontSize: '0.7rem', color: '#64748b' }}>
                    {step.transitions.conditions.length} condition{step.transitions.conditions.length !== 1 ? 's' : ''}
                  </span>
                )}
                <span style={{ fontSize: '0.7rem', color: '#475569', transition: 'transform 0.15s', transform: isExpanded ? 'rotate(90deg)' : 'none' }}>▶</span>
              </div>
              {!isExpanded && prompt && (
                <p style={{
                  margin: '0.35rem 0 0 2rem', fontSize: '0.75rem', color: '#64748b',
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>
                  {prompt}
                </p>
              )}
              {isExpanded && (
                <div style={{ margin: '0.5rem 0 0 2rem' }}>
                  {prompt && (
                    <pre style={{
                      fontSize: '0.75rem', color: '#94a3b8', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                      lineHeight: '1.5', margin: 0, padding: '0.5rem', background: '#0f172a', borderRadius: '4px',
                      fontFamily: 'monospace', maxHeight: '20rem', overflow: 'auto',
                    }}>
                      {prompt}
                    </pre>
                  )}
                  <div style={{ display: 'flex', gap: '1rem', marginTop: '0.4rem', fontSize: '0.7rem', color: '#475569' }}>
                    <span>Type: {step.type}</span>
                    {timeoutMs && <span>Timeout: {(timeoutMs / 1000)}s</span>}
                    <span>ID: {step.id.slice(0, 8)}</span>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Run history */}
      <h3 style={{ fontSize: '0.9rem', color: '#cbd5e1', margin: '0 0 0.5rem' }}>Run History ({runs.length})</h3>
      {runs.length === 0 ? (
        <p style={{ color: '#64748b', fontSize: '0.8rem' }}>No runs yet.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          {runs.map((run: WorkflowRun) => (
            <div
              key={run.id}
              onClick={() => setSelectedRunId(run.id)}
              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem', background: '#1e293b', borderRadius: '4px', cursor: 'pointer' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{
                  width: '8px', height: '8px', borderRadius: '50%',
                  background: runStatusColors[run.status] ?? '#94a3b8',
                }} />
                <span style={{ color: '#e2e8f0', fontSize: '0.85rem' }}>{run.status}</span>
                <span style={{ color: '#64748b', fontSize: '0.75rem' }}>({run.trigger})</span>
              </div>
              <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
                {new Date(run.startedAt).toLocaleString()}
                {run.finishedAt && ` · ${((run.finishedAt - run.startedAt) / 1000).toFixed(1)}s`}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
