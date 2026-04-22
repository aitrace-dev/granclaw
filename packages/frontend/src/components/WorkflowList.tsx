import { useState, useEffect, useCallback } from 'react';
import {
  fetchWorkflows,
  fetchWorkflow,
  fetchWorkflowRuns,
  triggerWorkflowRun,
  createWorkflow,
  type Workflow,
  type WorkflowWithSteps,
  type WorkflowRun,
} from '../lib/api.ts';
import { WorkflowDetail } from './WorkflowDetail.tsx';
import { WorkflowFormModal } from './WorkflowFormModal.tsx';
import { badgeSuccess, badgeWarning, badgeNeutral, buttonPrimary, buttonSecondary, cardCls } from '../ui/primitives';
import { useT } from '../lib/i18n.tsx';

export function WorkflowList({ agentId }: { agentId: string }) {
  const { t } = useT();
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [selected, setSelected] = useState<WorkflowWithSteps | null>(null);
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [running, setRunning] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

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

  const handleCreate = async (data: { name: string; description: string }) => {
    const wf = await createWorkflow(agentId, data);
    setCreating(false);
    await loadWorkflows();
    await handleSelect(wf.id);
  };

  if (selected) {
    return (
      <WorkflowDetail
        agentId={agentId}
        workflow={selected}
        runs={runs}
        onBack={async () => { setSelected(null); await loadWorkflows(); }}
        onRun={() => handleRun(selected.id)}
        onRefresh={async () => {
          const [wf, wfRuns] = await Promise.all([
            fetchWorkflow(agentId, selected.id),
            fetchWorkflowRuns(agentId, selected.id),
          ]);
          setSelected(wf);
          setRuns(wfRuns);
        }}
        onDeleted={async () => {
          setSelected(null);
          await loadWorkflows();
        }}
      />
    );
  }

  const statusBadge: Record<string, string> = {
    active:   badgeSuccess,
    paused:   badgeWarning,
    archived: badgeNeutral,
  };

  const runBadgeCls = (status: string | undefined): string => {
    if (status === 'running') return 'inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-medium bg-primary/15 text-primary';
    if (status === 'completed') return `${badgeSuccess} text-[10px]`;
    if (status === 'failed') return `${badgeWarning} text-[10px]`;
    if (status === 'cancelled') return `${badgeNeutral} text-[10px]`;
    return '';
  };

  const formatAge = (ts: number): string => {
    const diff = Date.now() - ts;
    const s = Math.floor(diff / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h`;
    return `${Math.floor(h / 24)}d`;
  };

  return (
    <div className="p-3 sm:p-4 min-w-0">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-headline text-xl font-bold text-on-surface">{t('workflows.title')}</h2>
        <button onClick={() => setCreating(true)} className={buttonSecondary}>
          {t('workflows.newWorkflow')}
        </button>
      </div>

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
                <div className="flex items-center gap-2 min-w-0 flex-wrap">
                  <span className="font-headline font-bold text-on-surface truncate">{wf.name}</span>
                  <span className={statusBadge[wf.status] ?? badgeNeutral}>
                    {wf.status}
                  </span>
                  {wf.lastRun && (
                    <span className={runBadgeCls(wf.lastRun.status)}>
                      {wf.lastRun.status === 'running' && (
                        <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
                      )}
                      {t(`workflows.runStatus.${wf.lastRun.status}`)}
                      <span className="opacity-60">
                        · {formatAge(wf.lastRun.finishedAt ?? wf.lastRun.startedAt)}
                      </span>
                    </span>
                  )}
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

      {creating && (
        <WorkflowFormModal
          title={t('workflows.newWorkflow')}
          onSave={handleCreate}
          onCancel={() => setCreating(false)}
        />
      )}
    </div>
  );
}
