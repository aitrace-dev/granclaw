import { useState, useEffect, useCallback } from 'react';
import {
  updateWorkflow,
  deleteWorkflow,
  fetchWorkflowSchedules,
  fetchWorkflowGraph,
  createScheduleApi,
  updateScheduleApi,
  deleteScheduleApi,
  type Workflow,
  type WorkflowRun,
  type WorkflowNode,
  type WorkflowEdge,
  type WorkflowStatus,
  type Schedule,
} from '../lib/api.ts';
import { RunDetail } from './RunDetail.tsx';
import { WorkflowFormModal } from './WorkflowFormModal.tsx';
import { WorkflowScheduleModal } from './WorkflowScheduleModal.tsx';
import { buttonPrimary, buttonGhost, buttonDanger, buttonSecondary } from '../ui/primitives';
import { WorkflowCanvas } from './workflow-canvas/WorkflowCanvas';
import { useT } from '../lib/i18n.tsx';

interface Props {
  agentId: string;
  workflow: Workflow;
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

const runStatusDot: Record<string, string> = {
  running:   'bg-warning',
  completed: 'bg-success',
  failed:    'bg-error',
  cancelled: 'bg-outline',
};

const nodeTypeIcon: Record<string, string> = {
  trigger: '▶',
  agent: '◆',
  foreach: '↻',
  conditional: '◇',
  merge: '⊕',
  end: '■',
};

const nodeTypeLabel: Record<string, string> = {
  trigger: 'Trigger',
  agent: 'Agent',
  foreach: 'ForEach',
  conditional: 'Conditional',
  merge: 'Merge',
  end: 'End',
};

function topoSort(nodes: WorkflowNode[], edges: WorkflowEdge[]): WorkflowNode[] {
  const inDeg = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const n of nodes) { inDeg.set(n.id, 0); adj.set(n.id, []); }
  for (const e of edges) {
    adj.get(e.sourceId)?.push(e.targetId);
    inDeg.set(e.targetId, (inDeg.get(e.targetId) ?? 0) + 1);
  }
  const queue = nodes.filter(n => (inDeg.get(n.id) ?? 0) === 0).map(n => n.id);
  const order: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    order.push(id);
    for (const next of adj.get(id) ?? []) {
      const d = (inDeg.get(next) ?? 1) - 1;
      inDeg.set(next, d);
      if (d === 0) queue.push(next);
    }
  }
  const pos = new Map(order.map((id, i) => [id, i]));
  return [...nodes].sort((a, b) => (pos.get(a.id) ?? 0) - (pos.get(b.id) ?? 0));
}

export function WorkflowDetail({ agentId, workflow, runs, onBack, onRun, onRefresh, onDeleted }: Props) {
  const { t } = useT();
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [editingWorkflow, setEditingWorkflow] = useState(false);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [addingSchedule, setAddingSchedule] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<Schedule | null>(null);
  const [viewMode, setViewMode] = useState<'canvas' | 'list'>('canvas');
  const [graphNodes, setGraphNodes] = useState<WorkflowNode[]>([]);
  const [graphEdges, setGraphEdges] = useState<WorkflowEdge[]>([]);
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());

  const loadSchedules = useCallback(async () => {
    try {
      setSchedules(await fetchWorkflowSchedules(agentId, workflow.id));
    } catch { /* ignore */ }
  }, [agentId, workflow.id]);

  const loadGraph = useCallback(async () => {
    try {
      const g = await fetchWorkflowGraph(agentId, workflow.id);
      setGraphNodes(g.nodes);
      setGraphEdges(g.edges);
    } catch { /* ignore */ }
  }, [agentId, workflow.id]);

  useEffect(() => { void loadSchedules(); }, [loadSchedules]);
  useEffect(() => { void loadGraph(); }, [loadGraph]);

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

  if (selectedRunId) {
    return (
      <RunDetail
        agentId={agentId}
        workflowId={workflow.id}
        runId={selectedRunId}
        onBack={() => { setSelectedRunId(null); void onRefresh(); }}
      />
    );
  }

  const sorted = topoSort(graphNodes, graphEdges);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-4 pt-4 shrink-0">
        <button onClick={() => void onBack()} className={`${buttonGhost} mb-3`}>
          {t('workflows.back')}
        </button>

        <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
          <h2 className="font-headline text-xl font-bold text-on-surface">{workflow.name}</h2>
          <div className="flex items-center gap-2">
            <button onClick={() => setEditingWorkflow(true)} className={buttonGhost}>
              {t('workflows.edit')}
            </button>
            <button onClick={() => void handleDeleteWorkflow()} className={buttonDanger}>
              {t('workflows.delete')}
            </button>
            <div className="flex items-center border border-outline-variant/40 rounded overflow-hidden">
              <button
                onClick={() => setViewMode('canvas')}
                className={`px-2.5 py-1.5 text-[10px] font-label font-semibold uppercase tracking-wider transition-colors ${viewMode === 'canvas' ? 'bg-primary/10 text-primary' : 'text-on-surface-variant hover:bg-surface-container'}`}
              >
                Canvas
              </button>
              <button
                onClick={() => setViewMode('list')}
                className={`px-2.5 py-1.5 text-[10px] font-label font-semibold uppercase tracking-wider transition-colors ${viewMode === 'list' ? 'bg-primary/10 text-primary' : 'text-on-surface-variant hover:bg-surface-container'}`}
              >
                List
              </button>
            </div>
            <button onClick={() => setAddingSchedule(true)} className={buttonSecondary}>
              {t('workflows.schedule')}
            </button>
            <button onClick={onRun} className={buttonPrimary}>
              {t('workflows.run_button')}
            </button>
          </div>
        </div>

        {workflow.description && (
          <p className="text-sm text-on-surface-variant mb-2">{workflow.description}</p>
        )}

        {/* Schedules & Run history — compact strip */}
        <div className="flex items-start gap-6 mb-2 text-xs text-on-surface-variant">
          <div className="flex items-center gap-2">
            <span className="font-label text-[10px] font-semibold uppercase tracking-widest">
              {t('workflows.schedulesTitle', { count: schedules.length })}
            </span>
            {schedules.length === 0 ? (
              <span>{t('workflows.noSchedules')}</span>
            ) : (
              schedules.map((sch) => (
                <span key={sch.id} className="inline-flex items-center gap-1">
                  <span className={`h-1.5 w-1.5 rounded-full ${sch.status === 'active' ? 'bg-success' : 'bg-warning/50'}`} />
                  <span>{sch.name}</span>
                  <span className="font-mono text-[10px]">{cronToHuman(sch.cron)}</span>
                  <span className="font-mono text-[10px]">{sch.timezone}</span>
                  <button onClick={() => void handleToggleSchedule(sch)} className={buttonGhost + ' !text-[9px] !py-0 !px-1'}>
                    {sch.status === 'active' ? t('schedules.pause') : t('schedules.resume')}
                  </button>
                  <button onClick={() => setEditingSchedule(sch)} className={buttonGhost + ' !text-[9px] !py-0 !px-1'}>✎</button>
                  <button onClick={() => void handleDeleteSchedule(sch)} className={buttonDanger + ' !text-[9px] !py-0 !px-1'}>✕</button>
                </span>
              ))
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="font-label text-[10px] font-semibold uppercase tracking-widest">
              {t('workflows.runHistoryTitle', { count: runs.length })}
            </span>
            {runs.length === 0 ? (
              <span>{t('workflows.noRuns')}</span>
            ) : (
              <div className="flex items-center gap-1 overflow-x-auto max-w-md">
                {runs.slice(0, 5).map((run: WorkflowRun) => (
                  <button
                    key={run.id}
                    onClick={() => setSelectedRunId(run.id)}
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-outline-variant/30 hover:border-primary/40 transition-colors shrink-0"
                  >
                    <span className={`h-1.5 w-1.5 rounded-full ${runStatusDot[run.status] ?? 'bg-outline'}`} />
                    <span className="font-mono text-[10px]">{run.status}</span>
                    <span className="font-mono text-[9px] text-on-surface-variant/60">
                      {new Date(run.startedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </button>
                ))}
                {runs.length > 5 && <span className="text-[10px] text-on-surface-variant/60">+{runs.length - 5} more</span>}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Canvas — fills remaining space */}
      {viewMode === 'canvas' && (
        <div className="flex-1 min-h-0 mx-4 mb-4 border border-outline-variant/40 rounded-xl overflow-hidden">
          <WorkflowCanvas agentId={agentId} workflowId={workflow.id} />
        </div>
      )}

      {/* List view — read-only flat rendering of graph nodes */}
      {viewMode === 'list' && (
        <div className="flex-1 overflow-y-auto px-4 pb-4">
          <h3 className="font-label text-[11px] font-semibold uppercase tracking-widest text-on-surface-variant mb-2">
            {t('workflows.stepsTitle', { count: sorted.length })}
          </h3>

          {sorted.length === 0 ? (
            <p className="text-xs text-on-surface-variant py-2">{t('workflows.noSteps')}</p>
          ) : (
            <div className="flex flex-col gap-0">
              {sorted.map((node, i) => {
                const isExpanded = expandedNodes.has(node.id);
                const prompt = (node.config.prompt ?? '') as string;
                const timeoutMs = node.config.timeout_ms as number | undefined;
                const expression = node.config.expression as string | undefined;
                const isLast = i === sorted.length - 1;
                const outEdges = graphEdges.filter(e => e.sourceId === node.id);

                return (
                  <div key={node.id} className="flex">
                    {/* Timeline rail */}
                    <div className="flex flex-col items-center w-6 shrink-0">
                      <div className={`h-3 w-px ${i === 0 ? 'bg-transparent' : 'bg-outline-variant/40'}`} />
                      <div className="h-2.5 w-2.5 rounded-full shrink-0 bg-primary/60" />
                      <div className={`flex-1 w-px ${isLast ? 'bg-transparent' : 'bg-outline-variant/40'}`} />
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0 pb-1">
                      <div
                        onClick={() => {
                          setExpandedNodes(prev => {
                            const next = new Set(prev);
                            if (next.has(node.id)) next.delete(node.id); else next.add(node.id);
                            return next;
                          });
                        }}
                        className="flex items-center gap-2 py-1.5 cursor-pointer group"
                      >
                        <span className="text-xs text-on-surface-variant/60">{nodeTypeIcon[node.nodeType] ?? '?'}</span>
                        <span className="text-sm font-medium text-on-surface">{node.name}</span>
                        <span className="font-mono text-[10px] text-on-surface-variant/40">{nodeTypeLabel[node.nodeType]}</span>
                        {outEdges.length > 1 && (
                          <span className="font-mono text-[10px] text-on-surface-variant/40">→ {outEdges.length} edges</span>
                        )}
                        <span className="font-mono text-[10px] text-on-surface-variant/40 opacity-0 group-hover:opacity-100 transition-opacity ml-auto">
                          {isExpanded ? '▾' : '▸'}
                        </span>
                      </div>

                      {!isExpanded && prompt && (
                        <p className="text-xs text-on-surface-variant/60 truncate ml-5 -mt-1 mb-1">{prompt}</p>
                      )}

                      {isExpanded && (
                        <div className="ml-5 pb-2 space-y-1.5">
                          {prompt && (
                            <pre className="font-mono text-[11px] text-on-surface-variant whitespace-pre-wrap break-words leading-relaxed p-2 bg-surface-container-low border border-outline-variant/20 rounded max-h-60 overflow-auto">
                              {prompt}
                            </pre>
                          )}
                          <div className="flex gap-3 font-mono text-[10px] text-on-surface-variant/50">
                            {timeoutMs && <span>timeout: {timeoutMs / 1000}s</span>}
                            {expression && <span>iterate: {expression}</span>}
                            <span>id: {node.id}</span>
                          </div>
                          {outEdges.length > 0 && (
                            <div className="flex flex-wrap gap-1">
                              {outEdges.map(e => {
                                const target = graphNodes.find(n => n.id === e.targetId);
                                return (
                                  <span key={e.id} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-surface-container text-[10px] font-mono text-on-surface-variant/60">
                                    → {target?.name ?? e.targetId}
                                    {e.sourceHandle !== 'default' && <span className="text-primary/60">({e.sourceHandle})</span>}
                                  </span>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
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
