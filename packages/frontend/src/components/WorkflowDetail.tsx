import { useState } from 'react';
import {
  type WorkflowWithSteps,
  type WorkflowRun,
  type WorkflowStep,
} from '../lib/api.ts';
import { RunDetail } from './RunDetail.tsx';
import { buttonPrimary, buttonGhost, cardCls, badgeBase } from '../ui/primitives';

interface Props {
  agentId: string;
  workflow: WorkflowWithSteps;
  runs: WorkflowRun[];
  onBack: () => void;
  onRun: () => void;
  onRefreshRuns: () => Promise<void>;
}

// Step-type chip colors, keyed to the new semantic palette.
const stepTypeChip: Record<string, string> = {
  code:  `${badgeBase} bg-primary/10 border border-primary/20 text-primary`,
  llm:   `${badgeBase} bg-info/10 border border-info/20 text-info`,
  agent: `${badgeBase} bg-success/10 border border-success/20 text-success`,
};

// Run-status dot colors, read from the theme's semantic tokens via Tailwind
// arbitrary values that reference the CSS variables. This keeps both light
// and dark themes in sync without per-component overrides.
const runStatusDot: Record<string, string> = {
  running:   'bg-warning',
  completed: 'bg-success',
  failed:    'bg-error',
  cancelled: 'bg-outline',
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
    <div className="p-4">
      <button onClick={onBack} className={`${buttonGhost} mb-3`}>
        ← Back to workflows
      </button>

      <div className="flex items-center justify-between mb-4">
        <h2 className="font-headline text-xl font-bold text-on-surface">{workflow.name}</h2>
        <button onClick={onRun} className={buttonPrimary}>
          Run
        </button>
      </div>

      {workflow.description && (
        <p className="text-sm text-on-surface-variant mb-4">{workflow.description}</p>
      )}

      {/* Steps timeline */}
      <h3 className="font-label text-[11px] font-semibold uppercase tracking-widest text-on-surface-variant mb-2">
        Steps ({workflow.steps.length})
      </h3>
      <div className="flex flex-col gap-1 mb-6">
        {workflow.steps.map((step: WorkflowStep, i: number) => {
          const config = step.config as unknown as Record<string, unknown>;
          const prompt = (config.prompt ?? config.script ?? '') as string;
          const isExpanded = expandedSteps.has(step.id);
          const timeoutMs = config.timeout_ms as number | undefined;
          return (
            <div
              key={step.id}
              onClick={() => toggleStep(step.id)}
              className={`${cardCls} p-3 cursor-pointer transition-colors hover:border-primary/40`}
            >
              <div className="flex items-center gap-2">
                <span className="font-mono text-[10px] text-on-surface-variant w-5 text-center">{i + 1}</span>
                <span className={stepTypeChip[step.type] ?? stepTypeChip.agent}>
                  {step.type}
                </span>
                <span className="text-sm text-on-surface flex-1">{step.name}</span>
                {step.transitions && (
                  <span className="font-mono text-[10px] text-on-surface-variant">
                    {step.transitions.conditions.length} condition{step.transitions.conditions.length !== 1 ? 's' : ''}
                  </span>
                )}
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
      <h3 className="font-label text-[11px] font-semibold uppercase tracking-widest text-on-surface-variant mb-2">
        Run History ({runs.length})
      </h3>
      {runs.length === 0 ? (
        <p className="text-xs text-on-surface-variant">No runs yet.</p>
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
    </div>
  );
}
