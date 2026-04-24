/**
 * workflows/runner-graph.ts
 *
 * Executes a workflow graph (DAG) using a topological work queue.
 * Supports node types: agent, foreach, conditional, merge, trigger, end.
 *
 * Communication between steps uses tmp files in the workspace:
 *   <workspaceDir>/workflow-runs/<runId>/node-<nodeId>.output.json
 *
 * Context compaction: outputs > 2000 chars are written to file and
 * truncated in the prompt — the agent can read the full file if needed.
 */

import path from 'path';
import fs from 'fs';
import { REPO_ROOT, getAgent } from '../config.js';
import {
  getWorkflowGraph,
  getWorkflow,
  createRun,
  updateRun,
  createRunStepForNode,
  updateRunStep,
  writeRunStepEvents,
  type WorkflowNode,
  type WorkflowEdge,
  type RunStepEvent,
} from '../workflows-db.js';
import { runAgent, stopAgent } from '../agent/runner-pi.js';
import { randomUUID } from 'crypto';
import { saveMessage } from '../messages-db.js';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

// ── Active run tracking ──────────────────────────────────────────────

const activeRuns = new Map<string, { ctrl: AbortController; agentId: string }>();

export function cancelGraphRun(agentId: string, runId: string): boolean {
  const key = `${agentId}:${runId}`;
  const entry = activeRuns.get(key);
  if (!entry) return false;
  entry.ctrl.abort();
  stopAgent(agentId);
  return true;
}

export function getActiveGraphRunIds(): string[] {
  return Array.from(activeRuns.keys());
}

// ── Browser cleanup ──────────────────────────────────────────────────

async function closeBrowserTabs(agentId: string): Promise<void> {
  const bin = process.env.AGENT_BROWSER_BIN ?? 'agent-browser';
  try {
    await execFileAsync(bin, ['--session', agentId, 'close', '--all'], { timeout: 5000 });
  } catch { /* best effort */ }
}

// ── Tmp file IPC ─────────────────────────────────────────────────────

const COMPACT_THRESHOLD = 2000;

function runDir(workspaceDir: string, runId: string): string {
  return path.join(workspaceDir, 'workflow-runs', runId);
}

function ensureRunDir(workspaceDir: string, runId: string): string {
  const dir = runDir(workspaceDir, runId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function writeNodeOutput(workspaceDir: string, runId: string, nodeId: string, output: unknown, iteration?: number): string {
  const dir = ensureRunDir(workspaceDir, runId);
  const suffix = iteration != null ? `-iter-${iteration}` : '';
  const filename = `node-${nodeId}${suffix}.output.json`;
  const filepath = path.join(dir, filename);
  fs.writeFileSync(filepath, JSON.stringify(output, null, 2));
  return filepath;
}

function readNodeOutput(workspaceDir: string, runId: string, nodeId: string): unknown {
  const dir = runDir(workspaceDir, runId);
  const filepath = path.join(dir, `node-${nodeId}.output.json`);
  if (!fs.existsSync(filepath)) return null;
  return JSON.parse(fs.readFileSync(filepath, 'utf-8'));
}

function compactOutput(output: unknown, filepath: string): string {
  const str = typeof output === 'string' ? output : JSON.stringify(output, null, 2);
  if (str.length <= COMPACT_THRESHOLD) return str;
  return str.slice(0, COMPACT_THRESHOLD) + `\n\n... (truncated — full output: ${filepath})`;
}

// ── Preamble injection ───────────────────────────────────────────────

interface NodeResult {
  nodeId: string;
  name: string;
  output: unknown;
  outputFile: string;
}

function buildPreamble(
  workflowName: string,
  runId: string,
  node: WorkflowNode,
  inputResults: NodeResult[],
  outputFile: string,
  iteration?: { index: number; total: number; item: unknown },
): string {
  const lines: string[] = [
    `## Workflow Context`,
    `Workflow: ${workflowName}`,
    `Run ID: ${runId}`,
    `Step: "${node.name}"${iteration ? ` (iteration ${iteration.index + 1}/${iteration.total})` : ''}`,
    ``,
    `When you finish, call the \`workflow_step_complete\` tool with your output.`,
    `If downstream steps expect structured data (e.g. a JSON array), pass it as the output parameter.`,
    ``,
  ];

  if (iteration) {
    const itemStr = typeof iteration.item === 'string' ? iteration.item : JSON.stringify(iteration.item);
    lines.push(`Current item ({{item}}):`);
    lines.push(itemStr.length > 1000 ? itemStr.slice(0, 1000) + '...' : itemStr);
    lines.push('');
  }

  if (inputResults.length > 0) {
    lines.push(`Previous step outputs:`);
    for (const r of inputResults) {
      const compacted = compactOutput(r.output, r.outputFile);
      lines.push(`- "${r.name}": ${compacted}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ── Step failure signal ──────────────────────────────────────────────

class StepFailure extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'StepFailure';
  }
}

// ── Agent node executor ──────────────────────────────────────────────

async function executeAgentNode(
  prompt: string,
  timeoutMs: number,
  agent: { id: string; name: string; model: string; workspaceDir: string },
  channelId: string,
  onEvent: (event: RunStepEvent) => void,
): Promise<string> {
  let responseText = '';

  let resolveSignal: (value: { status: 'complete' | 'fail'; output?: string; reason?: string }) => void;
  const signalPromise = new Promise<{ status: 'complete' | 'fail'; output?: string; reason?: string }>(
    (resolve) => { resolveSignal = resolve; }
  );
  let signalFired = false;

  const extraTools: ((pi: any) => void)[] = [
    (pi: any) => {
      pi.registerTool({
        name: 'workflow_step_complete',
        label: 'Complete Workflow Step',
        description:
          'Signal that this workflow step completed successfully. ' +
          'Call this when you have finished the task. ' +
          'Pass an optional output summary for the next step.',
        parameters: {
          type: 'object',
          properties: {
            output: { type: 'string', description: 'Result summary for downstream steps' },
          },
        },
        execute(_toolCallId: string, params: { output?: string }) {
          if (!signalFired) {
            signalFired = true;
            resolveSignal({ status: 'complete', output: params.output ?? responseText.trim() });
          }
          return { content: [{ type: 'text' as const, text: 'Step marked as complete.' }] };
        },
      });
    },
    (pi: any) => {
      pi.registerTool({
        name: 'workflow_step_fail',
        label: 'Fail Workflow Step',
        description:
          'Signal that this workflow step failed. Provide a reason.',
        parameters: {
          type: 'object',
          properties: { reason: { type: 'string', description: 'Why the step failed' } },
          required: ['reason'],
        },
        execute(_toolCallId: string, params: { reason: string }) {
          if (!signalFired) {
            signalFired = true;
            resolveSignal({ status: 'fail', reason: params.reason });
          }
          return { content: [{ type: 'text' as const, text: 'Step marked as failed.' }] };
        },
      });
    },
  ];

  const agentDone = runAgent(agent, prompt, (chunk) => {
    if (chunk.type === 'text') {
      responseText += chunk.text;
    } else if (chunk.type === 'tool_call') {
      onEvent({ type: 'tool_call', ts: Date.now(), tool: chunk.tool, input: chunk.input });
    } else if (chunk.type === 'tool_result') {
      onEvent({ type: 'tool_result', ts: Date.now(), tool: chunk.tool, output: chunk.output });
    } else if (chunk.type === 'error') {
      onEvent({ type: 'error', ts: Date.now(), message: chunk.message });
    }
  }, { channelId, extraTools });

  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('Agent step timed out')), timeoutMs)
  );

  const result = await Promise.race([
    agentDone.then(() => signalFired
      ? signalPromise
      : { status: 'complete' as const, output: responseText.trim() }
    ),
    signalPromise,
    timeout,
  ]);

  if (result.status === 'fail') {
    throw new StepFailure(result.reason ?? 'Agent reported failure');
  }

  return result.output ?? responseText.trim();
}

// ── Conditional node executor (agent-based) ──────────────────────────

async function executeConditionalNode(
  prompt: string,
  handles: string[],
  timeoutMs: number,
  agent: { id: string; name: string; model: string; workspaceDir: string },
  channelId: string,
  onEvent: (event: RunStepEvent) => void,
): Promise<string> {
  let responseText = '';

  let resolveRoute: (handle: string) => void;
  const routePromise = new Promise<string>((resolve) => { resolveRoute = resolve; });
  let routeFired = false;

  const extraTools: ((pi: any) => void)[] = [
    (pi: any) => {
      pi.registerTool({
        name: 'workflow_route',
        label: 'Route Workflow',
        description:
          `Decide which branch this workflow should take. ` +
          `Available routes: ${handles.join(', ')}. ` +
          `Call this after evaluating the condition described in the prompt.`,
        parameters: {
          type: 'object',
          properties: {
            handle: {
              type: 'string',
              enum: handles,
              description: `Which branch to take: ${handles.join(' or ')}`,
            },
          },
          required: ['handle'],
        },
        execute(_toolCallId: string, params: { handle: string }) {
          if (!routeFired) {
            routeFired = true;
            resolveRoute(params.handle);
          }
          return { content: [{ type: 'text' as const, text: `Routed to: ${params.handle}` }] };
        },
      });
    },
  ];

  const agentDone = runAgent(agent, prompt, (chunk) => {
    if (chunk.type === 'text') responseText += chunk.text;
    else if (chunk.type === 'tool_call') onEvent({ type: 'tool_call', ts: Date.now(), tool: chunk.tool, input: chunk.input });
    else if (chunk.type === 'tool_result') onEvent({ type: 'tool_result', ts: Date.now(), tool: chunk.tool, output: chunk.output });
    else if (chunk.type === 'error') onEvent({ type: 'error', ts: Date.now(), message: chunk.message });
  }, { channelId, extraTools });

  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('Conditional timed out')), timeoutMs)
  );

  const handle = await Promise.race([
    agentDone.then(() => routeFired ? routePromise : handles[0]),
    routePromise,
    timeout,
  ]);

  return handle;
}

// ── Topological helpers ──────────────────────────────────────────────

function findRootNodes(nodes: WorkflowNode[], edges: WorkflowEdge[]): WorkflowNode[] {
  const targets = new Set(edges.map(e => e.targetId));
  return nodes.filter(n => !targets.has(n.id));
}

function getIncomingEdges(nodeId: string, edges: WorkflowEdge[]): WorkflowEdge[] {
  return edges.filter(e => e.targetId === nodeId);
}

function getOutgoingEdges(nodeId: string, edges: WorkflowEdge[]): WorkflowEdge[] {
  return edges.filter(e => e.sourceId === nodeId);
}

function findBodySubgraph(
  foreachNode: WorkflowNode,
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
): { bodyNodes: WorkflowNode[]; bodyEdges: WorkflowEdge[]; exitEdge: WorkflowEdge | null } {
  // The foreach node has two outgoing handles:
  //   "body" → the iteration body chain
  //   "done" → the exit path (to merge or next node)
  const bodyEdge = edges.find(e => e.sourceId === foreachNode.id && e.sourceHandle === 'body');
  const doneEdge = edges.find(e => e.sourceId === foreachNode.id && e.sourceHandle === 'done') ?? null;

  if (!bodyEdge) return { bodyNodes: [], bodyEdges: [], exitEdge: doneEdge };

  // BFS from bodyEdge.targetId, collecting nodes until we hit doneEdge.targetId or a dead end
  const doneTargetId = doneEdge?.targetId;
  const bodyNodeIds = new Set<string>();
  const queue = [bodyEdge.targetId];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (id === doneTargetId) continue;
    if (bodyNodeIds.has(id)) continue;
    bodyNodeIds.add(id);
    for (const e of edges) {
      if (e.sourceId === id && !bodyNodeIds.has(e.targetId) && e.targetId !== doneTargetId) {
        queue.push(e.targetId);
      }
    }
  }

  const nodeMap = new Map(nodes.map(n => [n.id, n]));
  const bodyNodes = Array.from(bodyNodeIds).map(id => nodeMap.get(id)!).filter(Boolean);
  const bodyEdges = edges.filter(e => bodyNodeIds.has(e.sourceId) && bodyNodeIds.has(e.targetId));

  return { bodyNodes, bodyEdges, exitEdge: doneEdge };
}

// ── Main executor ────────────────────────────────────────────────────

export async function executeGraphWorkflow(
  agentId: string,
  workflowId: string,
  trigger: 'manual' | 'chat' | 'schedule'
): Promise<string> {
  const workflowOrNull = getWorkflow(agentId, workflowId);
  if (!workflowOrNull) throw new Error(`Workflow "${workflowId}" not found`);
  const workflow = workflowOrNull;

  const graph = getWorkflowGraph(agentId, workflowId);
  if (graph.nodes.length === 0) throw new Error(`Workflow "${workflowId}" has no nodes`);

  const agentOrNull = getAgent(agentId);
  if (!agentOrNull) throw new Error(`Agent "${agentId}" not found`);
  const agent = agentOrNull;

  const workspaceDir = path.resolve(REPO_ROOT, agent.workspaceDir);
  const run = createRun(agentId, workflowId, trigger);
  const abortCtrl = new AbortController();
  const runKey = `${agentId}:${run.id}`;
  activeRuns.set(runKey, { ctrl: abortCtrl, agentId });

  ensureRunDir(workspaceDir, run.id);

  const { nodes, edges } = graph;
  const nodeMap = new Map(nodes.map(n => [n.id, n]));
  const nodeResults = new Map<string, NodeResult>();
  const resolvedEdges = new Set<string>();

  // Execute a subgraph from given root nodes — used for both the main graph and foreach bodies
  async function executeSubgraph(
    subNodes: WorkflowNode[],
    subEdges: WorkflowEdge[],
    initialInput?: NodeResult[],
    iterationCtx?: { index: number; total: number; item: unknown },
  ): Promise<unknown> {
    const subNodeMap = new Map(subNodes.map(n => [n.id, n]));
    const subResolved = new Set<string>();
    const subResults = new Map<string, NodeResult>();
    let lastOutput: unknown = null;

    // Seed input results
    if (initialInput) {
      for (const r of initialInput) subResults.set(r.nodeId, r);
    }

    // Find roots of subgraph
    const subTargets = new Set(subEdges.map(e => e.targetId));
    const roots = subNodes.filter(n => !subTargets.has(n.id));
    const queue = [...roots];
    const processed = new Set<string>();

    while (queue.length > 0) {
      if (abortCtrl.signal.aborted) throw new Error('Run cancelled');

      const node = queue.shift()!;
      if (processed.has(node.id)) continue;

      // Check all incoming edges are resolved
      const incoming = subEdges.filter(e => e.targetId === node.id);
      const allResolved = incoming.every(e => subResolved.has(e.id) || resolvedEdges.has(e.id));
      if (!allResolved) {
        queue.push(node);
        continue;
      }
      processed.add(node.id);

      // Gather input from resolved incoming edges
      const inputResults: NodeResult[] = [];
      for (const e of incoming) {
        const r = subResults.get(e.sourceId) ?? nodeResults.get(e.sourceId);
        if (r) inputResults.push(r);
      }

      const runStep = createRunStepForNode(agentId, {
        runId: run.id,
        nodeId: node.id,
        iteration: iterationCtx?.index,
      });
      const startedAt = Date.now();
      updateRunStep(agentId, runStep.id, { status: 'running', startedAt });

      const events: RunStepEvent[] = [];
      let pendingFlush: ReturnType<typeof setTimeout> | null = null;
      let lastFlushAt = 0;
      const flush = () => { pendingFlush = null; lastFlushAt = Date.now(); try { writeRunStepEvents(agentId, runStep.id, events); } catch {} };
      const scheduleFlush = () => { if (pendingFlush) return; const elapsed = Date.now() - lastFlushAt; pendingFlush = setTimeout(flush, elapsed >= 1000 ? 0 : 1000 - elapsed); };

      try {
        let output: unknown = null;
        const iterSuffix = iterationCtx ? `-iter-${iterationCtx.index}` : '';
        const outputFile = path.join(runDir(workspaceDir, run.id), `node-${node.id}${iterSuffix}.output.json`);

        switch (node.nodeType) {
          case 'trigger': {
            output = { triggered: true, trigger, timestamp: Date.now() };
            break;
          }

          case 'end': {
            output = inputResults.length > 0 ? inputResults[0].output : null;
            break;
          }

          case 'agent': {
            const prompt = node.config.prompt as string ?? '';
            const timeoutMs = (node.config.timeout_ms as number) ?? 300_000;
            const preamble = buildPreamble(workflow.name, run.id, node, inputResults, outputFile, iterationCtx);
            const fullPrompt = preamble + '\n---\n\n' + prompt;
            const channelId = `wf-${run.id}-${node.id}${iterSuffix}`;

            const raw = await executeAgentNode(
              fullPrompt, timeoutMs, agent, channelId,
              (event) => { events.push(event); scheduleFlush(); },
            );

            // Try to parse as JSON
            try { output = JSON.parse(raw); } catch { output = raw; }
            break;
          }

          case 'conditional': {
            const prompt = node.config.prompt as string ?? 'Evaluate this condition.';
            const handles = (node.config.handles as string[]) ?? ['true', 'false'];
            const timeoutMs = (node.config.timeout_ms as number) ?? 120_000;
            const preamble = buildPreamble(workflow.name, run.id, node, inputResults, outputFile, iterationCtx);
            const fullPrompt = preamble + '\n---\n\n' + prompt;
            const channelId = `wf-${run.id}-${node.id}${iterSuffix}`;

            const chosenHandle = await executeConditionalNode(
              fullPrompt, handles, timeoutMs, agent, channelId,
              (event) => { events.push(event); scheduleFlush(); },
            );

            output = { route: chosenHandle };

            // Only resolve edges matching the chosen handle
            const outgoing = getOutgoingEdges(node.id, subEdges.length > 0 ? subEdges : edges);
            for (const e of outgoing) {
              if (e.sourceHandle === chosenHandle) {
                subResolved.add(e.id);
                resolvedEdges.add(e.id);
                const targetNode = subNodeMap.get(e.targetId) ?? nodeMap.get(e.targetId);
                if (targetNode && !processed.has(targetNode.id)) queue.push(targetNode);
              }
            }

            // Write output, record result, update run step — then continue
            // (skip the normal edge resolution below since conditional did its own)
            writeNodeOutput(workspaceDir, run.id, node.id, output, iterationCtx?.index);
            const finishedAt = Date.now();
            if (pendingFlush) { clearTimeout(pendingFlush); pendingFlush = null; }
            if (events.length > 0) try { writeRunStepEvents(agentId, runStep.id, events); } catch {}
            updateRunStep(agentId, runStep.id, { status: 'completed', input: inputResults[0]?.output, output, startedAt, finishedAt, durationMs: finishedAt - startedAt });
            const nodeResult: NodeResult = { nodeId: node.id, name: node.name, output, outputFile };
            subResults.set(node.id, nodeResult);
            nodeResults.set(node.id, nodeResult);
            lastOutput = output;
            continue;
          }

          case 'foreach': {
            const expression = node.config.expression as string ?? 'input';
            const inputData = inputResults.length > 0 ? inputResults[0].output : null;

            // Evaluate expression to get array
            let items: unknown[];
            try {
              const fn = new Function('input', 'return ' + expression);
              const result = fn(inputData);
              items = Array.isArray(result) ? result : [result];
            } catch (err) {
              throw new Error(`ForEach expression error: ${err instanceof Error ? err.message : String(err)}`);
            }

            // Find body subgraph
            const { bodyNodes, bodyEdges, exitEdge } = findBodySubgraph(node, nodes, edges);
            const iterResults: unknown[] = [];

            for (let i = 0; i < items.length; i++) {
              if (abortCtrl.signal.aborted) throw new Error('Run cancelled');

              const itemInput: NodeResult = {
                nodeId: node.id,
                name: node.name,
                output: items[i],
                outputFile: writeNodeOutput(workspaceDir, run.id, `${node.id}-item`, items[i], i),
              };

              const bodyResult = await executeSubgraph(
                bodyNodes, bodyEdges, [itemInput],
                { index: i, total: items.length, item: items[i] },
              );
              iterResults.push(bodyResult);
            }

            output = iterResults;

            // Resolve the "done" exit edge
            if (exitEdge) {
              subResolved.add(exitEdge.id);
              resolvedEdges.add(exitEdge.id);
              const targetNode = subNodeMap.get(exitEdge.targetId) ?? nodeMap.get(exitEdge.targetId);
              if (targetNode && !processed.has(targetNode.id)) queue.push(targetNode);
            }

            writeNodeOutput(workspaceDir, run.id, node.id, output, iterationCtx?.index);
            const finAt = Date.now();
            if (pendingFlush) { clearTimeout(pendingFlush); pendingFlush = null; }
            if (events.length > 0) try { writeRunStepEvents(agentId, runStep.id, events); } catch {}
            updateRunStep(agentId, runStep.id, { status: 'completed', input: inputData, output, startedAt, finishedAt: finAt, durationMs: finAt - startedAt });
            const nodeRes: NodeResult = { nodeId: node.id, name: node.name, output, outputFile };
            subResults.set(node.id, nodeRes);
            nodeResults.set(node.id, nodeRes);
            lastOutput = output;
            continue;
          }

          case 'merge': {
            const mergedInputs = inputResults.map(r => r.output);
            output = mergedInputs.length === 1 ? mergedInputs[0] : mergedInputs;
            break;
          }
        }

        // Write output file
        const outFile = writeNodeOutput(workspaceDir, run.id, node.id, output, iterationCtx?.index);
        const finishedAt = Date.now();

        if (pendingFlush) { clearTimeout(pendingFlush); pendingFlush = null; }
        if (events.length > 0) try { writeRunStepEvents(agentId, runStep.id, events); } catch {}

        updateRunStep(agentId, runStep.id, {
          status: 'completed',
          input: inputResults.length > 0 ? inputResults[0].output : null,
          output,
          startedAt,
          finishedAt,
          durationMs: finishedAt - startedAt,
        });

        const nodeResult: NodeResult = { nodeId: node.id, name: node.name, output, outputFile: outFile };
        subResults.set(node.id, nodeResult);
        nodeResults.set(node.id, nodeResult);
        lastOutput = output;

        // Resolve all outgoing edges and enqueue targets
        const outgoing = getOutgoingEdges(node.id, subEdges.length > 0 ? subEdges : edges);
        for (const e of outgoing) {
          subResolved.add(e.id);
          resolvedEdges.add(e.id);
          const targetNode = subNodeMap.get(e.targetId) ?? nodeMap.get(e.targetId);
          if (targetNode && !processed.has(targetNode.id)) {
            const targetIncoming = subEdges.filter(ie => ie.targetId === targetNode.id);
            const targetAllResolved = targetIncoming.every(ie => subResolved.has(ie.id) || resolvedEdges.has(ie.id));
            if (targetAllResolved) queue.push(targetNode);
          }
        }

      } catch (err) {
        if (pendingFlush) { clearTimeout(pendingFlush); pendingFlush = null; }
        if (events.length > 0) try { writeRunStepEvents(agentId, runStep.id, events); } catch {}

        const finishedAt = Date.now();
        const message = err instanceof Error ? err.message : String(err);
        updateRunStep(agentId, runStep.id, {
          status: 'failed',
          input: inputResults.length > 0 ? inputResults[0].output : null,
          error: message,
          startedAt,
          finishedAt,
          durationMs: finishedAt - startedAt,
        });
        throw err;
      }
    }

    return lastOutput;
  }

  // ── Execute the main graph ─────────────────────────────────────────

  try {
    const roots = findRootNodes(nodes, edges);
    if (roots.length === 0) throw new Error('No root nodes found (every node has incoming edges)');

    await executeSubgraph(nodes, edges);

    activeRuns.delete(runKey);
    updateRun(agentId, run.id, { status: 'completed', finishedAt: Date.now() });

    // Post summary
    const lastResult = Array.from(nodeResults.values()).pop();
    const outputPreview = typeof lastResult?.output === 'string'
      ? lastResult.output.slice(0, 500)
      : JSON.stringify(lastResult?.output ?? null).slice(0, 500);
    const summary = `**Workflow "${workflow.name}" completed** (${nodeResults.size} nodes)\n\nFinal output:\n${outputPreview}`;
    saveMessage({ id: randomUUID(), agentId, channelId: 'ui', role: 'assistant', content: summary });

  } catch (err) {
    activeRuns.delete(runKey);
    const message = err instanceof Error ? err.message : String(err);

    if (abortCtrl.signal.aborted) {
      updateRun(agentId, run.id, { status: 'cancelled', finishedAt: Date.now() });
    } else {
      updateRun(agentId, run.id, { status: 'failed', finishedAt: Date.now() });
      console.error(`[workflow-runner-graph] failed:`, message, err instanceof Error ? err.stack : '');
      const failSummary = `**Workflow "${workflow.name}" failed**\n\nError: ${message}`;
      saveMessage({ id: randomUUID(), agentId, channelId: 'ui', role: 'assistant', content: failSummary });
    }
  }

  await closeBrowserTabs(agentId);
  return run.id;
}
