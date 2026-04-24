/**
 * workflows-db.ts
 *
 * Per-agent SQLite store for workflows, steps, runs, and run steps.
 * Backed by <workspaceDir>/agent.sqlite (shared via workspace-pool).
 */

import path from 'path';
import { randomUUID } from 'crypto';
import { REPO_ROOT, getAgent } from './config.js';
import { getWorkspaceDb, closeWorkspaceDb } from './workspace-pool.js';

// ── Types ─────────────────────────────────────────────────────────────────

export type WorkflowStatus = 'active' | 'paused' | 'archived';

export type RunStatus = 'running' | 'completed' | 'failed' | 'cancelled';
export type RunStepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

export type NodeType = 'agent' | 'foreach' | 'conditional' | 'merge' | 'trigger' | 'end';

export interface Workflow {
  id: string;
  name: string;
  description: string;
  status: WorkflowStatus;
  createdAt: number;
  updatedAt: number;
}

export interface WorkflowNode {
  id: string;
  workflowId: string;
  nodeType: NodeType;
  name: string;
  config: Record<string, unknown>;
  positionX: number;
  positionY: number;
}

export interface WorkflowEdge {
  id: string;
  workflowId: string;
  sourceId: string;
  targetId: string;
  sourceHandle: string;
  condition: string | null;
}

export interface WorkflowGraph {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

export interface WorkflowWithGraph extends Workflow {
  graph: WorkflowGraph;
}

export interface Run {
  id: string;
  workflowId: string;
  status: RunStatus;
  trigger: string;
  startedAt: number;
  finishedAt: number | null;
}

/**
 * Live events produced by an agent-type step while it runs. The runner
 * buffers these in workflows/runner-graph.ts and flushes them to the DB every
 * few events so the frontend RunDetail view can show what the agent is
 * doing in real time (polls every 1.5 s). Other step types
 * (code, llm) don't emit events — only the final output is captured.
 */
export interface RunStepEvent {
  type: 'tool_call' | 'tool_result' | 'error';
  ts: number;
  tool?: string;
  input?: unknown;
  output?: unknown;
  message?: string;
}

export interface RunStep {
  id: string;
  runId: string;
  stepId: string;
  nodeId: string | null;
  iteration: number | null;
  status: RunStepStatus;
  input: unknown;
  output: unknown;
  error: string | null;
  events: RunStepEvent[] | null;
  startedAt: number | null;
  finishedAt: number | null;
  durationMs: number | null;
}

export interface RunWithSteps extends Run {
  steps: RunStep[];
}

// ── Internal DB accessor ──────────────────────────────────────────────────

function getDb(agentId: string) {
  const agent = getAgent(agentId);
  if (!agent) throw new Error(`Agent "${agentId}" not found in config`);
  return getWorkspaceDb(path.resolve(REPO_ROOT, agent.workspaceDir));
}

// ── Row mappers ───────────────────────────────────────────────────────────

function rowToWorkflow(r: Record<string, unknown>): Workflow {
  return {
    id: r.id as string,
    name: r.name as string,
    description: r.description as string,
    status: r.status as WorkflowStatus,
    createdAt: r.created_at as number,
    updatedAt: r.updated_at as number,
  };
}

function rowToRun(r: Record<string, unknown>): Run {
  return {
    id: r.id as string,
    workflowId: r.workflow_id as string,
    status: r.status as RunStatus,
    trigger: r.trigger as string,
    startedAt: r.started_at as number,
    finishedAt: (r.finished_at as number) ?? null,
  };
}

function rowToRunStep(r: Record<string, unknown>): RunStep {
  return {
    id: r.id as string,
    runId: r.run_id as string,
    stepId: r.step_id as string,
    nodeId: (r.node_id as string) ?? null,
    iteration: (r.iteration as number) ?? null,
    status: r.status as RunStepStatus,
    input: r.input ? JSON.parse(r.input as string) : null,
    output: r.output ? JSON.parse(r.output as string) : null,
    error: (r.error as string) ?? null,
    events: r.events ? (JSON.parse(r.events as string) as RunStepEvent[]) : null,
    startedAt: (r.started_at as number) ?? null,
    finishedAt: (r.finished_at as number) ?? null,
    durationMs: (r.duration_ms as number) ?? null,
  };
}

function rowToNode(r: Record<string, unknown>): WorkflowNode {
  return {
    id: r.id as string,
    workflowId: r.workflow_id as string,
    nodeType: r.node_type as NodeType,
    name: r.name as string,
    config: JSON.parse(r.config as string),
    positionX: r.position_x as number,
    positionY: r.position_y as number,
  };
}

function rowToEdge(r: Record<string, unknown>): WorkflowEdge {
  return {
    id: r.id as string,
    workflowId: r.workflow_id as string,
    sourceId: r.source_id as string,
    targetId: r.target_id as string,
    sourceHandle: r.source_handle as string,
    condition: (r.condition as string) ?? null,
  };
}

// ── Workflow CRUD ─────────────────────────────────────────────────────────

function nextWorkflowId(db: ReturnType<typeof getWorkspaceDb>): string {
  const row = db.prepare(`SELECT COALESCE(MAX(CAST(SUBSTR(id, 4) AS INTEGER)), 0) + 1 AS next FROM workflows`).get() as { next: number };
  return `WF-${String(row.next).padStart(3, '0')}`;
}

export function listWorkflows(agentId: string): Workflow[] {
  const db = getDb(agentId);
  return (db.prepare(`SELECT * FROM workflows ORDER BY created_at DESC`).all() as Record<string, unknown>[]).map(rowToWorkflow);
}

export function getWorkflow(agentId: string, workflowId: string): Workflow | null {
  const db = getDb(agentId);
  const row = db.prepare(`SELECT * FROM workflows WHERE id = ?`).get(workflowId);
  if (!row) return null;
  return rowToWorkflow(row as Record<string, unknown>);
}

export function createWorkflow(agentId: string, data: { name: string; description?: string }): Workflow {
  const db = getDb(agentId);
  const id = nextWorkflowId(db);
  const now = Date.now();
  db.prepare(`
    INSERT INTO workflows (id, name, description, status, created_at, updated_at)
    VALUES (?, ?, ?, 'active', ?, ?)
  `).run(id, data.name, data.description ?? '', now, now);
  return getWorkflow(agentId, id)!;
}

export function updateWorkflow(agentId: string, workflowId: string, data: { name?: string; description?: string; status?: WorkflowStatus }): Workflow | null {
  const db = getDb(agentId);
  const existing = getWorkflow(agentId, workflowId);
  if (!existing) return null;
  const now = Date.now();
  db.prepare(`
    UPDATE workflows SET name = ?, description = ?, status = ?, updated_at = ? WHERE id = ?
  `).run(
    data.name ?? existing.name,
    data.description ?? existing.description,
    data.status ?? existing.status,
    now,
    workflowId,
  );
  return getWorkflow(agentId, workflowId);
}

export function deleteWorkflow(agentId: string, workflowId: string): boolean {
  const db = getDb(agentId);
  const result = db.prepare(`DELETE FROM workflows WHERE id = ?`).run(workflowId);
  return result.changes > 0;
}

// ── Run management ────────────────────────────────────────────────────────

export function createRun(agentId: string, workflowId: string, trigger: string): Run {
  const db = getDb(agentId);
  const id = randomUUID();
  const now = Date.now();
  db.prepare(`
    INSERT INTO runs (id, workflow_id, status, trigger, started_at)
    VALUES (?, ?, 'running', ?, ?)
  `).run(id, workflowId, trigger, now);
  return rowToRun(db.prepare(`SELECT * FROM runs WHERE id = ?`).get(id) as Record<string, unknown>);
}

export function updateRun(agentId: string, runId: string, data: { status: RunStatus; finishedAt?: number }): void {
  getDb(agentId).prepare(`UPDATE runs SET status = ?, finished_at = ? WHERE id = ?`).run(data.status, data.finishedAt ?? null, runId);
}

export function listRuns(agentId: string, workflowId: string): Run[] {
  const db = getDb(agentId);
  return (db.prepare(`SELECT * FROM runs WHERE workflow_id = ? ORDER BY started_at DESC`).all(workflowId) as Record<string, unknown>[]).map(rowToRun);
}

export function getRun(agentId: string, runId: string): RunWithSteps | null {
  const db = getDb(agentId);
  const row = db.prepare(`SELECT * FROM runs WHERE id = ?`).get(runId);
  if (!row) return null;
  const run = rowToRun(row as Record<string, unknown>);
  const steps = (db.prepare(`
    SELECT rs.*, wn.name as node_name, wn.node_type as node_type
    FROM run_steps rs LEFT JOIN workflow_nodes wn ON rs.node_id = wn.id
    WHERE rs.run_id = ? ORDER BY rs.started_at
  `).all(runId) as Record<string, unknown>[]).map(r => {
    const step = rowToRunStep(r);
    return { ...step, nodeName: (r.node_name as string) ?? null, nodeType: (r.node_type as string) ?? null };
  });
  return { ...run, steps };
}

// ── Run step management ───────────────────────────────────────────────────

export function createRunStep(agentId: string, data: { runId: string; stepId: string }): RunStep {
  const db = getDb(agentId);
  const id = randomUUID();
  db.prepare(`
    INSERT INTO run_steps (id, run_id, step_id, status) VALUES (?, ?, ?, 'pending')
  `).run(id, data.runId, data.stepId);
  return rowToRunStep(db.prepare(`SELECT * FROM run_steps WHERE id = ?`).get(id) as Record<string, unknown>);
}

export function updateRunStep(agentId: string, runStepId: string, data: {
  status: RunStepStatus; input?: unknown; output?: unknown; error?: string;
  startedAt?: number; finishedAt?: number; durationMs?: number;
}): void {
  getDb(agentId).prepare(`
    UPDATE run_steps SET status = ?, input = ?, output = ?, error = ?,
      started_at = ?, finished_at = ?, duration_ms = ?
    WHERE id = ?
  `).run(
    data.status,
    data.input !== undefined ? JSON.stringify(data.input) : null,
    data.output !== undefined ? JSON.stringify(data.output) : null,
    data.error ?? null,
    data.startedAt ?? null,
    data.finishedAt ?? null,
    data.durationMs ?? null,
    runStepId,
  );
}

/**
 * Overwrite the run_step's event log with the given array. The runner
 * keeps the authoritative buffer in memory and flushes periodically;
 * doing a full rewrite is simpler than append-and-merge in SQLite and
 * the arrays are small (tens of events per step).
 */
export function writeRunStepEvents(agentId: string, runStepId: string, events: RunStepEvent[]): void {
  getDb(agentId).prepare(`UPDATE run_steps SET events = ? WHERE id = ?`)
    .run(JSON.stringify(events), runStepId);
}

// ── Monitor ──────────────────────────────────────────────────────────────

export function getRunningRuns(agentId: string): { runId: string; workflowId: string; workflowName: string; startedAt: number }[] {
  try {
    const db = getDb(agentId);
    return (db.prepare(`
      SELECT r.id as run_id, r.workflow_id, w.name as workflow_name, r.started_at
      FROM runs r JOIN workflows w ON r.workflow_id = w.id
      WHERE r.status = 'running'
      ORDER BY r.started_at DESC
    `).all() as { run_id: string; workflow_id: string; workflow_name: string; started_at: number }[]).map(r => ({
      runId: r.run_id,
      workflowId: r.workflow_id,
      workflowName: r.workflow_name,
      startedAt: r.started_at,
    }));
  } catch { return []; }
}

/**
 * Flip every run still marked 'running' (and its still-'running' steps) to
 * 'failed'. Called at boot from `packages/backend/src/index.ts` so a run
 * that was mid-flight when the container was killed (sync-server-image
 * does `docker rm -f`, crash, OOM, etc.) doesn't stay stuck in 'running'
 * forever — the UI was showing the last run perpetually in-progress,
 * blocking the run button's disabled-state heuristics and confusing users
 * into thinking the workflow was "still going" hours later.
 *
 * Returns the number of runs flipped. Best-effort — errors are swallowed
 * per-agent to keep boot from blocking on a single bad workspace.
 */
export function finalizeRunningRuns(agentId: string): number {
  try {
    const db = getDb(agentId);
    const now = Date.now();
    const err = 'Run interrupted — backend restarted while executing.';
    // Step-level first so the run summary in the UI shows WHERE it died.
    db.prepare(`
      UPDATE run_steps SET status = 'failed', error = COALESCE(error, ?), finished_at = COALESCE(finished_at, ?)
      WHERE status = 'running'
    `).run(err, now);
    db.prepare(`
      UPDATE run_steps SET status = 'skipped'
      WHERE status = 'pending' AND run_id IN (SELECT id FROM runs WHERE status = 'running')
    `).run();
    const result = db.prepare(`
      UPDATE runs SET status = 'failed', finished_at = COALESCE(finished_at, ?)
      WHERE status = 'running'
    `).run(now);
    return result.changes ?? 0;
  } catch { return 0; }
}

/**
 * Most recent run for a workflow, or null if the workflow has never run.
 * Lightweight (no joins to run_steps) so the workflow list endpoint can
 * hydrate every card without an N+1 problem. Used by the UI to show an
 * at-a-glance "last run: running / completed / failed" badge without
 * forcing the user to click into the detail view.
 */
export function getLatestRun(agentId: string, workflowId: string): Run | null {
  try {
    const db = getDb(agentId);
    const row = db.prepare(`
      SELECT * FROM runs WHERE workflow_id = ? ORDER BY started_at DESC LIMIT 1
    `).get(workflowId);
    return row ? rowToRun(row as Record<string, unknown>) : null;
  } catch { return null; }
}

// ── Graph CRUD (nodes + edges) ───────────────────────────────────────

export function getWorkflowGraph(agentId: string, workflowId: string): WorkflowGraph {
  const db = getDb(agentId);
  const nodes = (db.prepare(`SELECT * FROM workflow_nodes WHERE workflow_id = ?`).all(workflowId) as Record<string, unknown>[]).map(rowToNode);
  const edges = (db.prepare(`SELECT * FROM workflow_edges WHERE workflow_id = ?`).all(workflowId) as Record<string, unknown>[]).map(rowToEdge);
  return { nodes, edges };
}

export function saveWorkflowGraph(agentId: string, workflowId: string, graph: {
  nodes: { id: string; nodeType: NodeType; name: string; config: Record<string, unknown>; positionX: number; positionY: number }[];
  edges: { id: string; sourceId: string; targetId: string; sourceHandle: string; condition?: string | null }[];
}): WorkflowGraph {
  const db = getDb(agentId);

  // Validate DAG (reject cycles)
  const adj = new Map<string, string[]>();
  for (const n of graph.nodes) adj.set(n.id, []);
  for (const e of graph.edges) {
    const list = adj.get(e.sourceId);
    if (list) list.push(e.targetId);
  }
  const visited = new Set<string>();
  const stack = new Set<string>();
  function hasCycle(node: string): boolean {
    if (stack.has(node)) return true;
    if (visited.has(node)) return false;
    visited.add(node);
    stack.add(node);
    for (const next of adj.get(node) ?? []) {
      if (hasCycle(next)) return true;
    }
    stack.delete(node);
    return false;
  }
  for (const n of graph.nodes) {
    if (hasCycle(n.id)) throw new Error('Workflow graph contains a cycle — only DAGs are allowed');
  }

  const txn = db.transaction(() => {
    db.prepare(`DELETE FROM workflow_edges WHERE workflow_id = ?`).run(workflowId);
    db.prepare(`DELETE FROM workflow_nodes WHERE workflow_id = ?`).run(workflowId);

    const insertNode = db.prepare(`
      INSERT INTO workflow_nodes (id, workflow_id, node_type, name, config, position_x, position_y)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const n of graph.nodes) {
      insertNode.run(n.id, workflowId, n.nodeType, n.name, JSON.stringify(n.config), n.positionX, n.positionY);
    }

    const insertEdge = db.prepare(`
      INSERT INTO workflow_edges (id, workflow_id, source_id, target_id, source_handle, condition)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const e of graph.edges) {
      insertEdge.run(e.id, workflowId, e.sourceId, e.targetId, e.sourceHandle, e.condition ?? null);
    }

    db.prepare(`UPDATE workflows SET updated_at = ? WHERE id = ?`).run(Date.now(), workflowId);
  });
  txn();

  return getWorkflowGraph(agentId, workflowId);
}

export function addNode(agentId: string, workflowId: string, data: {
  nodeType: NodeType; name: string; config?: Record<string, unknown>;
  positionX?: number; positionY?: number;
}): WorkflowNode {
  const db = getDb(agentId);
  const id = randomUUID();
  db.prepare(`
    INSERT INTO workflow_nodes (id, workflow_id, node_type, name, config, position_x, position_y)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, workflowId, data.nodeType, data.name, JSON.stringify(data.config ?? {}), data.positionX ?? 0, data.positionY ?? 0);
  db.prepare(`UPDATE workflows SET updated_at = ? WHERE id = ?`).run(Date.now(), workflowId);
  return rowToNode(db.prepare(`SELECT * FROM workflow_nodes WHERE id = ?`).get(id) as Record<string, unknown>);
}

export function updateNode(agentId: string, nodeId: string, data: {
  name?: string; config?: Record<string, unknown>; positionX?: number; positionY?: number;
}): WorkflowNode | null {
  const db = getDb(agentId);
  const existing = db.prepare(`SELECT * FROM workflow_nodes WHERE id = ?`).get(nodeId) as Record<string, unknown> | undefined;
  if (!existing) return null;
  const node = rowToNode(existing);
  db.prepare(`
    UPDATE workflow_nodes SET name = ?, config = ?, position_x = ?, position_y = ? WHERE id = ?
  `).run(
    data.name ?? node.name,
    data.config ? JSON.stringify(data.config) : existing.config as string,
    data.positionX ?? node.positionX,
    data.positionY ?? node.positionY,
    nodeId,
  );
  db.prepare(`UPDATE workflows SET updated_at = ? WHERE id = ?`).run(Date.now(), node.workflowId);
  return rowToNode(db.prepare(`SELECT * FROM workflow_nodes WHERE id = ?`).get(nodeId) as Record<string, unknown>);
}

export function removeNode(agentId: string, nodeId: string): boolean {
  const db = getDb(agentId);
  const node = db.prepare(`SELECT workflow_id FROM workflow_nodes WHERE id = ?`).get(nodeId) as { workflow_id: string } | undefined;
  if (!node) return false;
  db.prepare(`DELETE FROM workflow_nodes WHERE id = ?`).run(nodeId);
  db.prepare(`UPDATE workflows SET updated_at = ? WHERE id = ?`).run(Date.now(), node.workflow_id);
  return true;
}

export function addEdge(agentId: string, workflowId: string, data: {
  sourceId: string; targetId: string; sourceHandle?: string; condition?: string;
}): WorkflowEdge {
  const db = getDb(agentId);
  const id = randomUUID();
  db.prepare(`
    INSERT INTO workflow_edges (id, workflow_id, source_id, target_id, source_handle, condition)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, workflowId, data.sourceId, data.targetId, data.sourceHandle ?? 'default', data.condition ?? null);
  db.prepare(`UPDATE workflows SET updated_at = ? WHERE id = ?`).run(Date.now(), workflowId);
  return rowToEdge(db.prepare(`SELECT * FROM workflow_edges WHERE id = ?`).get(id) as Record<string, unknown>);
}

export function removeEdge(agentId: string, edgeId: string): boolean {
  const db = getDb(agentId);
  const edge = db.prepare(`SELECT workflow_id FROM workflow_edges WHERE id = ?`).get(edgeId) as { workflow_id: string } | undefined;
  if (!edge) return false;
  db.prepare(`DELETE FROM workflow_edges WHERE id = ?`).run(edgeId);
  db.prepare(`UPDATE workflows SET updated_at = ? WHERE id = ?`).run(Date.now(), edge.workflow_id);
  return true;
}

export function createRunStepForNode(agentId: string, data: { runId: string; nodeId: string; iteration?: number }): RunStep {
  const db = getDb(agentId);
  const id = randomUUID();
  db.prepare(`
    INSERT INTO run_steps (id, run_id, step_id, node_id, iteration, status) VALUES (?, ?, NULL, ?, ?, 'pending')
  `).run(id, data.runId, data.nodeId, data.iteration ?? null);
  return rowToRunStep(db.prepare(`SELECT * FROM run_steps WHERE id = ?`).get(id) as Record<string, unknown>);
}

// ── Lifecycle ─────────────────────────────────────────────────────────────

export function closeWorkflowsDb(agentId: string): void {
  const agent = getAgent(agentId);
  if (!agent) return;
  closeWorkspaceDb(path.resolve(REPO_ROOT, agent.workspaceDir));
}
