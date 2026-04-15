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
import { badgeSuccess, badgeWarning, badgeNeutral, buttonPrimary, cardCls } from '../ui/primitives';
import { useT } from '../lib/i18n.tsx';

export function WorkflowList({ agentId }: { agentId: string }) {
  const { t } = useT();
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

  const statusBadge: Record<string, string> = {
    active:   badgeSuccess,
    paused:   badgeWarning,
    archived: badgeNeutral,
  };

  return (
    <div className="p-3 sm:p-4 min-w-0">
      <h2 className="font-headline text-xl font-bold text-on-surface mb-4">{t('workflows.title')}</h2>

      {workflows.length === 0 ? (
        <p className="font-mono text-xs text-on-surface-variant">
          {t('workflows.emptyText')}
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {workflows.map((wf) => (
            <div
              key={wf.id}
              onClick={() => handleSelect(wf.id)}
              className={`${cardCls} p-4 cursor-pointer transition-colors hover:border-primary/40`}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-headline font-bold text-on-surface truncate">{wf.name}</span>
                  <span className={statusBadge[wf.status] ?? badgeNeutral}>
                    {wf.status}
                  </span>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); handleRun(wf.id); }}
                  disabled={running === wf.id || wf.status !== 'active'}
                  className={buttonPrimary}
                >
                  {running === wf.id ? t('workflows.running') : t('workflows.run')}
                </button>
              </div>
              {wf.description && (
                <p className="mt-1.5 text-sm text-on-surface-variant">
                  {wf.description}
                </p>
              )}
              <div className="mt-1 font-mono text-[10px] text-on-surface-variant/60">
                {t('workflows.createdOn', { id: wf.id, date: new Date(wf.createdAt).toLocaleDateString() })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
