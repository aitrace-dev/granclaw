import { useState } from 'react';
import {
  updateWorkflow,
  deleteWorkflow,
  createStep,
  updateStep,
  deleteStep,
  type WorkflowWithSteps,
  type WorkflowRun,
  type WorkflowStep,
  type StepInput,
  type WorkflowStatus,
} from '../lib/api.ts';
import { RunDetail } from './RunDetail.tsx';
import { WorkflowFormModal } from './WorkflowFormModal.tsx';
import { StepFormModal } from './StepFormModal.tsx';
import { buttonPrimary, buttonGhost, buttonDanger, buttonSecondary, cardCls, badgeBase } from '../ui/primitives';
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

const stepTypeChip: Record<string, string> = {
  code:  `${badgeBase} bg-primary/10 border border-primary/20 text-primary`,
  llm:   `${badgeBase} bg-info/10 border border-info/20 text-info`,
  agent: `${badgeBase} bg-success/10 border border-success/20 text-success`,
};

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
    <div className="p-4">
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
                <span className={stepTypeChip[step.type] ?? stepTypeChip.agent}>
                  {step.type}
                </span>
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
                    <span>{t('workflows.stepType', { type: step.type })}</span>
                    {timeoutMs && <span>{t('workflows.stepTimeout', { seconds: timeoutMs / 1000 })}</span>}
                    <span>{t('workflows.stepId', { id: step.id.slice(0, 8) })}</span>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

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
    </div>
  );
}
