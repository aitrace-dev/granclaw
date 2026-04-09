import { useState, useEffect, useCallback } from 'react';
import {
  fetchWorkflows,
  fetchWorkflow,
  fetchWorkflowRuns,
  triggerWorkflowRun,
  type Workflow,
  type WorkflowWithSteps,
  type WorkflowRun,
} from '../lib/api.ts';
import { WorkflowDetail } from './WorkflowDetail.tsx';

export function WorkflowList({ agentId }: { agentId: string }) {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [selected, setSelected] = useState<WorkflowWithSteps | null>(null);
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [running, setRunning] = useState<string | null>(null);

  const loadWorkflows = useCallback(async () => {
    try {
      const data = await fetchWorkflows(agentId);
      setWorkflows(data);
    } catch { /* silently ignore polling errors */ }
  }, [agentId]);

  useEffect(() => {
    void loadWorkflows();
    const id = setInterval(() => { void loadWorkflows(); }, 4000);
    return () => clearInterval(id);
  }, [loadWorkflows]);

  const handleSelect = async (wfId: string) => {
    const [wf, wfRuns] = await Promise.all([
      fetchWorkflow(agentId, wfId),
      fetchWorkflowRuns(agentId, wfId),
    ]);
    setSelected(wf);
    setRuns(wfRuns);
  };

  const handleRun = async (wfId: string) => {
    setRunning(wfId);
    try {
      await triggerWorkflowRun(agentId, wfId);
      // Refresh runs after trigger
      const wfRuns = await fetchWorkflowRuns(agentId, wfId);
      setRuns(wfRuns);
    } catch (err) {
      console.error('Failed to trigger workflow:', err);
    } finally {
      setRunning(null);
    }
  };

  if (selected) {
    return (
      <WorkflowDetail
        agentId={agentId}
        workflow={selected}
        runs={runs}
        onBack={() => setSelected(null)}
        onRun={() => handleRun(selected.id)}
        onRefreshRuns={async () => {
          const wfRuns = await fetchWorkflowRuns(agentId, selected.id);
          setRuns(wfRuns);
        }}
      />
    );
  }

  const statusColor: Record<string, string> = {
    active: '#4ade80',
    paused: '#facc15',
    archived: '#94a3b8',
  };

  return (
    <div style={{ padding: '1rem' }}>
      <h2 style={{ margin: '0 0 1rem', fontSize: '1.1rem', color: '#e2e8f0' }}>Workflows</h2>

      {workflows.length === 0 ? (
        <p style={{ color: '#64748b', fontSize: '0.85rem' }}>
          No workflows yet. Ask the agent to create one via chat.
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {workflows.map((wf) => (
            <div
              key={wf.id}
              onClick={() => handleSelect(wf.id)}
              style={{
                padding: '0.75rem',
                background: '#1e293b',
                borderRadius: '6px',
                cursor: 'pointer',
                border: '1px solid #334155',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <span style={{ color: '#e2e8f0', fontWeight: 500 }}>{wf.name}</span>
                  <span style={{
                    marginLeft: '0.5rem',
                    fontSize: '0.7rem',
                    padding: '2px 6px',
                    borderRadius: '3px',
                    background: statusColor[wf.status] ?? '#94a3b8',
                    color: '#0f172a',
                  }}>
                    {wf.status}
                  </span>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); handleRun(wf.id); }}
                  disabled={running === wf.id || wf.status !== 'active'}
                  style={{
                    padding: '4px 12px',
                    fontSize: '0.8rem',
                    background: running === wf.id ? '#334155' : '#3b82f6',
                    color: '#fff',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: running === wf.id ? 'not-allowed' : 'pointer',
                  }}
                >
                  {running === wf.id ? 'Running...' : 'Run'}
                </button>
              </div>
              {wf.description && (
                <p style={{ margin: '0.25rem 0 0', fontSize: '0.8rem', color: '#94a3b8' }}>
                  {wf.description}
                </p>
              )}
              <div style={{ fontSize: '0.7rem', color: '#64748b', marginTop: '0.25rem' }}>
                {wf.id} · Created {new Date(wf.createdAt).toLocaleDateString()}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
