import { useState, useEffect, useCallback } from 'react';
import {
  updateWorkflow,
  deleteWorkflow,
  createStep,
  updateStep,
  deleteStep,
  fetchWorkflowSchedules,
  createScheduleApi,
  updateScheduleApi,
  deleteScheduleApi,
  type WorkflowWithSteps,
  type WorkflowRun,
  type WorkflowStep,
  type StepInput,
  type WorkflowStatus,
  type Schedule,
} from '../lib/api.ts';
import { RunDetail } from './RunDetail.tsx';
import { WorkflowFormModal } from './WorkflowFormModal.tsx';
import { StepFormModal } from './StepFormModal.tsx';
import { WorkflowScheduleModal } from './WorkflowScheduleModal.tsx';
import { buttonPrimary, buttonGhost, buttonDanger, buttonSecondary, cardCls } from '../ui/primitives';
import { useT } from '../lib/i18n.tsx';

interface Props {
  agentId: string;
  workflow: WorkflowWithSteps;
  runs: WorkflowRun[];
  onBack: () => void | Promise<void>;
  onRun: () => void;
  onRefresh: () => Promise<void>;
  onDeleted: () => Promise<void>;
}

function cronToHuman(cron: string): string {
  const parts = cron.split(' ');
  if (parts.length !== 5) return cron;
  const [min, hour, dom, mon, dow] = parts;
  if (dom === '*' && mon === '*' && dow === '*') {
    if (hour !== '*' && min !== '*') return `Daily at ${hour.padStart(2, '0')}:${min.padStart(2, '0')}`;
    if (hour === '*' && min === '0') return 'Every hour';
    if (hour === '*') return `Every hour at :${min.padStart(2, '0')}`;
  }
  if (dom === '*' && mon === '*' && dow !== '*') {
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const dayNames = dow.split(',').map(d => days[Number(d)] ?? d).join(', ');
    if (hour !== '*' && min !== '*') return `${dayNames} at ${hour.padStart(2, '0')}:${min.padStart(2, '0')}`;
  }
  return cron;
}

function relativeTime(ms: number | null): string {
  if (!ms) return '—';
  const diff = ms - Date.now();
  const absDiff = Math.abs(diff);
  if (absDiff < 60_000) return diff > 0 ? 'in <1m' : '<1m ago';
  if (absDiff < 3_600_000) return diff > 0 ? `in ${Math.round(absDiff / 60_000)}m` : `${Math.round(absDiff / 60_000)}m ago`;
  if (absDiff < 86_400_000) return diff > 0 ? `in ${Math.round(absDiff / 3_600_000)}h` : `${Math.round(absDiff / 3_600_000)}h ago`;
  const days = Math.round(absDiff / 86_400_000);
  return diff > 0 ? `in ${days}d` : `${days}d ago`;
}

const runStatusDot: Record<string, string> = {
  running:   'bg-warning',
  completed: 'bg-success',
  failed:    'bg-error',
  cancelled: 'bg-outline',
};

export function WorkflowDetail({ agentId, workflow, runs, onBack, onRun, onRefresh, onDeleted }: Props) {
  const { t } = useT();
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [expandedSteps, setExpandedSteps] = useState<Set<string>>(new Set());
  const [editingWorkflow, setEditingWorkflow] = useState(false);
  const [addingStep, setAddingStep] = useState(false);
  const [editingStep, setEditingStep] = useState<WorkflowStep | null>(null);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [addingSchedule, setAddingSchedule] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<Schedule | null>(null);

  const loadSchedules = useCallback(async () => {
    try {
      setSchedules(await fetchWorkflowSchedules(agentId, workflow.id));
    } catch { /* ignore */ }
  }, [agentId, workflow.id]);

  useEffect(() => { void loadSchedules(); }, [loadSchedules]);

  const handleAddSchedule = async (data: { name: string; cron: string; timezone: string }) => {
    await createScheduleApi(agentId, { ...data, workflowId: workflow.id });
    setAddingSchedule(false);
    await loadSchedules();
  };

  const handleUpdateSchedule = async (data: { name: string; cron: string; timezone: string }) => {
    if (!editingSchedule) return;
    await updateScheduleApi(agentId, editingSchedule.id, data);
    setEditingSchedule(null);
    await loadSchedules();
  };

  const handleDeleteSchedule = async (schedule: Schedule) => {
    if (!window.confirm(t('workflows.deleteScheduleConfirm', { name: schedule.name }))) return;
    await deleteScheduleApi(agentId, schedule.id);
    await loadSchedules();
  };

  const handleToggleSchedule = async (schedule: Schedule) => {
    await updateScheduleApi(agentId, schedule.id, {
      status: schedule.status === 'active' ? 'paused' : 'active',
    });
    await loadSchedules();
  };

  const toggleStep = (stepId: string) => {
    setExpandedSteps(prev => {
      const next = new Set(prev);
      if (next.has(stepId)) next.delete(stepId);
      else next.add(stepId);
      return next;
    });
  };

  const handleUpdateWorkflow = async (data: { name: string; description: string; status?: WorkflowStatus }) => {
    await updateWorkflow(agentId, workflow.id, data);
    setEditingWorkflow(false);
    await onRefresh();
  };

  const handleDeleteWorkflow = async () => {
    if (!window.confirm(t('workflows.confirmDelete', { name: workflow.name }))) return;
    await deleteWorkflow(agentId, workflow.id);
    await onDeleted();
  };

  const handleAddStep = async (data: StepInput) => {
    await createStep(agentId, workflow.id, data);
    setAddingStep(false);
    await onRefresh();
  };

  const handleUpdateStep = async (data: StepInput) => {
    if (!editingStep) return;
    await updateStep(agentId, workflow.id, editingStep.id, data);
    setEditingStep(null);
    await onRefresh();
  };

  const handleDeleteStep = async (step: WorkflowStep) => {
    if (!window.confirm(t('workflows.confirmDeleteStep', { name: step.name }))) return;
    await deleteStep(agentId, workflow.id, step.id);
    await onRefresh();
  };

  const handleMoveStep = async (step: WorkflowStep, direction: -1 | 1) => {
    const sorted = [...workflow.steps].sort((a, b) => a.position - b.position);
    const idx = sorted.findIndex(s => s.id === step.id);
    const targetIdx = idx + direction;
    if (targetIdx < 0 || targetIdx >= sorted.length) return;
    const target = sorted[targetIdx];
    await Promise.all([
      updateStep(agentId, workflow.id, step.id, { position: target.position }),
      updateStep(agentId, workflow.id, target.id, { position: step.position }),
    ]);
    await onRefresh();
  };

  if (selectedRunId) {
    return (
      <RunDetail
        agentId={agentId}
        workflowId={workflow.id}
        runId={selectedRunId}
        steps={workflow.steps}
        onBack={() => { setSelectedRunId(null); void onRefresh(); }}
      />
    );
  }

  const sortedSteps = [...workflow.steps].sort((a, b) => a.position - b.position);

  return (
    <div className="p-4 flex-1 overflow-y-auto">
      <button onClick={() => void onBack()} className={`${buttonGhost} mb-3`}>
        {t('workflows.back')}
      </button>

      <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
        <h2 className="font-headline text-xl font-bold text-on-surface">{workflow.name}</h2>
        <div className="flex items-center gap-2">
          <button onClick={() => setEditingWorkflow(true)} className={buttonGhost}>
            {t('workflows.edit')}
          </button>
          <button onClick={() => void handleDeleteWorkflow()} className={buttonDanger}>
            {t('workflows.delete')}
          </button>
          <button onClick={() => setAddingSchedule(true)} className={buttonSecondary}>
            {t('workflows.schedule')}
          </button>
          <button onClick={onRun} className={buttonPrimary}>
            {t('workflows.run_button')}
          </button>
        </div>
      </div>

      {workflow.description && (
        <p className="text-sm text-on-surface-variant mb-4">{workflow.description}</p>
      )}

      <div className="flex items-center justify-between mb-2">
        <h3 className="font-label text-[11px] font-semibold uppercase tracking-widest text-on-surface-variant">
          {t('workflows.stepsTitle', { count: sortedSteps.length })}
        </h3>
        <button onClick={() => setAddingStep(true)} className={buttonSecondary}>
          {t('workflows.addStep')}
        </button>
      </div>

      <div className="flex flex-col gap-1 mb-6">
        {sortedSteps.length === 0 && (
          <p className="text-xs text-on-surface-variant py-2">{t('workflows.noSteps')}</p>
        )}
        {sortedSteps.map((step: WorkflowStep, i: number) => {
          const config = step.config as unknown as Record<string, unknown>;
          const prompt = (config.prompt ?? config.script ?? '') as string;
          const isExpanded = expandedSteps.has(step.id);
          const timeoutMs = config.timeout_ms as number | undefined;
          return (
            <div
              key={step.id}
              className={`${cardCls} p-3 transition-colors hover:border-primary/40`}
            >
              <div className="flex items-center gap-2 cursor-pointer" onClick={() => toggleStep(step.id)}>
                <span className="font-mono text-[10px] text-on-surface-variant w-5 text-center">{i + 1}</span>
                <span className="text-sm text-on-surface flex-1">{step.name}</span>
                {step.transitions && (
                  <span className="font-mono text-[10px] text-on-surface-variant">
                    {t(step.transitions.conditions.length === 1 ? 'workflows.conditionsOne' : 'workflows.conditionsOther', { count: step.transitions.conditions.length })}
                  </span>
                )}
                <div className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
                  <button
                    onClick={() => void handleMoveStep(step, -1)}
                    disabled={i === 0}
                    className={buttonGhost}
                    title={t('workflows.moveUp')}
                  >↑</button>
                  <button
                    onClick={() => void handleMoveStep(step, 1)}
                    disabled={i === sortedSteps.length - 1}
                    className={buttonGhost}
                    title={t('workflows.moveDown')}
                  >↓</button>
                  <button
                    onClick={() => setEditingStep(step)}
                    className={buttonGhost}
                    title={t('workflows.edit')}
                  >✎</button>
                  <button
                    onClick={() => void handleDeleteStep(step)}
                    className={buttonDanger}
                    title={t('workflows.delete')}
                  >✕</button>
                </div>
                <span
                  className="text-[10px] text-on-surface-variant transition-transform"
                  style={{ transform: isExpanded ? 'rotate(90deg)' : 'none' }}
                >
                  ▶
                </span>
              </div>
              {!isExpanded && prompt && (
                <p className="mt-1 ml-7 text-xs text-on-surface-variant truncate">
                  {prompt}
                </p>
              )}
              {isExpanded && (
                <div className="mt-2 ml-7">
                  {prompt && (
                    <pre className="font-mono text-xs text-on-surface-variant whitespace-pre-wrap break-words leading-relaxed p-2 bg-surface-container-low rounded max-h-80 overflow-auto">
                      {prompt}
                    </pre>
                  )}
                  <div className="flex gap-4 mt-1.5 font-mono text-[10px] text-on-surface-variant">
                    {timeoutMs && <span>{t('workflows.stepTimeout', { seconds: timeoutMs / 1000 })}</span>}
                    <span>{t('workflows.stepId', { id: step.id.slice(0, 8) })}</span>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Schedules */}
      <h3 className="font-label text-[11px] font-semibold uppercase tracking-widest text-on-surface-variant mb-2">
        {t('workflows.schedulesTitle', { count: schedules.length })}
      </h3>
      {schedules.length === 0 ? (
        <p className="text-xs text-on-surface-variant mb-6">{t('workflows.noSchedules')}</p>
      ) : (
        <div className="flex flex-col gap-1 mb-6">
          {schedules.map((sch) => (
            <div key={sch.id} className={`${cardCls} p-3`}>
              <div className="flex items-center gap-2">
                <span className={`h-1.5 w-1.5 rounded-full ${sch.status === 'active' ? 'bg-success' : 'bg-warning/50'}`} />
                <span className="text-sm text-on-surface flex-1">{sch.name}</span>
                <span className="font-mono text-[10px] text-on-surface-variant">{cronToHuman(sch.cron)}</span>
                <span className="font-mono text-[10px] text-on-surface-variant">{sch.timezone}</span>
                <div className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
                  <button onClick={() => void handleToggleSchedule(sch)} className={buttonGhost}>
                    {sch.status === 'active' ? t('schedules.pause') : t('schedules.resume')}
                  </button>
                  <button onClick={() => setEditingSchedule(sch)} className={buttonGhost} title={t('workflows.edit')}>
                    ✎
                  </button>
                  <button onClick={() => void handleDeleteSchedule(sch)} className={buttonDanger} title={t('workflows.delete')}>
                    ✕
                  </button>
                </div>
              </div>
              {sch.nextRun && (
                <div className="mt-1 ml-3.5 font-mono text-[10px] text-on-surface-variant">
                  {t('schedules.next', { time: relativeTime(sch.nextRun) })}
                  {sch.lastRun && ` · ${t('schedules.last', { time: relativeTime(sch.lastRun) })}`}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <h3 className="font-label text-[11px] font-semibold uppercase tracking-widest text-on-surface-variant mb-2">
        {t('workflows.runHistoryTitle', { count: runs.length })}
      </h3>
      {runs.length === 0 ? (
        <p className="text-xs text-on-surface-variant">{t('workflows.noRuns')}</p>
      ) : (
        <div className="flex flex-col gap-1">
          {runs.map((run: WorkflowRun) => (
            <div
              key={run.id}
              onClick={() => setSelectedRunId(run.id)}
              className={`${cardCls} flex items-center justify-between p-2.5 cursor-pointer transition-colors hover:border-primary/40`}
            >
              <div className="flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${runStatusDot[run.status] ?? 'bg-outline'}`} />
                <span className="text-sm text-on-surface">{run.status}</span>
                <span className="font-mono text-[11px] text-on-surface-variant">({run.trigger})</span>
              </div>
              <div className="font-mono text-[10px] text-on-surface-variant">
                {new Date(run.startedAt).toLocaleString()}
                {run.finishedAt && ` · ${((run.finishedAt - run.startedAt) / 1000).toFixed(1)}s`}
              </div>
            </div>
          ))}
        </div>
      )}

      {editingWorkflow && (
        <WorkflowFormModal
          title={t('workflows.editWorkflow')}
          initial={{ name: workflow.name, description: workflow.description, status: workflow.status }}
          allowStatus
          onSave={handleUpdateWorkflow}
          onCancel={() => setEditingWorkflow(false)}
        />
      )}

      {addingStep && (
        <StepFormModal
          title={t('workflows.addStepTitle')}
          onSave={handleAddStep}
          onCancel={() => setAddingStep(false)}
        />
      )}

      {editingStep && (
        <StepFormModal
          title={t('workflows.editStepTitle')}
          initial={editingStep}
          onSave={handleUpdateStep}
          onCancel={() => setEditingStep(null)}
        />
      )}

      {addingSchedule && (
        <WorkflowScheduleModal
          title={t('workflows.scheduleTitle')}
          onSave={handleAddSchedule}
          onCancel={() => setAddingSchedule(false)}
        />
      )}

      {editingSchedule && (
        <WorkflowScheduleModal
          title={t('workflows.editSchedule')}
          initial={{ name: editingSchedule.name, cron: editingSchedule.cron, timezone: editingSchedule.timezone }}
          onSave={handleUpdateSchedule}
          onCancel={() => setEditingSchedule(null)}
        />
      )}
    </div>
  );
}
