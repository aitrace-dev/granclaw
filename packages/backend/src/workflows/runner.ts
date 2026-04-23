/**
 * workflows/runner.ts
 *
 * Executes a workflow: iterates through steps, runs code or LLM steps,
 * evaluates transitions, and records results in run_steps.
 *
 * Runs in the orchestrator process. Frontend polls for status updates.
 */

import path from 'path';
import { REPO_ROOT, getAgent } from '../config.js';
import {
  getWorkflow,
  createRun,
  updateRun,
  createRunStep,
  updateRunStep,
  writeRunStepEvents,
  type Step,
  type RunStepEvent,
} from '../workflows-db.js';
import { runAgent, stopAgent } from '../agent/runner-pi.js';
import { randomUUID } from 'crypto';
import { saveMessage } from '../messages-db.js';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

// ── Active run tracking (for cancellation) ──────────────────────────────

const activeRuns = new Map<string, { ctrl: AbortController; agentId: string }>();

export function cancelWorkflowRun(agentId: string, runId: string): boolean {
  const key = `${agentId}:${runId}`;
  const entry = activeRuns.get(key);
  if (!entry) return false;
  entry.ctrl.abort();
  stopAgent(agentId);
  return true;
}

export function getActiveRunIds(): string[] {
  return Array.from(activeRuns.keys());
}

// ── Browser cleanup ──────────────────────────────────────────────────────

async function closeBrowserTabs(agentId: string): Promise<void> {
  const bin = process.env.AGENT_BROWSER_BIN ?? 'agent-browser';
  try {
    await execFileAsync(bin, ['--session', agentId, 'close', '--all'], { timeout: 5000 });
  } catch { /* best effort — browser may not be running */ }
}

// ── Template resolution ───────────────────────────────────────────────────

interface StepResult {
  stepId: string;
  name: string;
  output: unknown;
}

function resolveTemplates(prompt: string, prevOutput: unknown, allResults: StepResult[]): string {
  let resolved = prompt;

  // {{prev.output}} → previous step's output as JSON string
  resolved = resolved.replace(/\{\{prev\.output\}\}/g, prevOutput !== null ? JSON.stringify(prevOutput) : 'null');

  // {{steps.<name>.output}} → named step's output
  resolved = resolved.replace(/\{\{steps\.([^.]+)\.output\}\}/g, (_match, name: string) => {
    const result = allResults.find((r) => r.name === name);
    return result ? JSON.stringify(result.output) : 'null';
  });

  return resolved;
}

// ── Workflow step signal ──────────────────────────────────────────────────

class StepFailure extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'StepFailure';
  }
}

// ── Step executor ─────────────────────────────────────────────────────────

async function executeAgentStep(
  config: Record<string, unknown>,
  prevOutput: unknown,
  allResults: StepResult[],
  agent: { id: string; name: string; model: string; workspaceDir: string },
  channelId: string,
  onEvent: (event: RunStepEvent) => void,
): Promise<unknown> {
  const rawPrompt = config.prompt as string;
  const timeoutMs = (config.timeout_ms as number) ?? 300_000;
  const prompt = resolveTemplates(rawPrompt, prevOutput, allResults);

  let responseText = '';

  // Deferred that the agent resolves via workflow_step_complete / workflow_step_fail tools
  let resolveSignal: (value: { status: 'complete' | 'fail'; output?: unknown; reason?: string }) => void;
  const signalPromise = new Promise<{ status: 'complete' | 'fail'; output?: unknown; reason?: string }>(
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
          'Call this when you have finished the task described in the step prompt. ' +
          'Pass an optional output summary for the next step to consume.',
        parameters: {
          type: 'object',
          properties: {
            output: {
              type: 'string',
              description: 'Summary or result of the step (passed to the next step as context)',
            },
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
          'Signal that this workflow step failed. ' +
          'Call this when you cannot complete the task — e.g. a required resource is unavailable, ' +
          'login failed, or the task is impossible given the current state. ' +
          'Provide a reason so the workflow run log explains what went wrong.',
        parameters: {
          type: 'object',
          properties: {
            reason: {
              type: 'string',
              description: 'Why the step failed',
            },
          },
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

  // Race: agent finishes naturally, agent calls a signal tool, or timeout
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

  const output = result.output;
  if (typeof output === 'string') {
    try { return JSON.parse(output); } catch { return output; }
  }
  return output;
}

// ── Transition evaluation ─────────────────────────────────────────────────

function evaluateTransitions(
  transitions: { conditions: { expr: string; goto: string }[] } | null,
  output: unknown,
  steps: Step[]
): Step | 'END' | null {
  if (!transitions || !transitions.conditions) return null;

  for (const condition of transitions.conditions) {
    try {
      const fn = new Function('output', 'return ' + condition.expr);
      if (fn(output)) {
        if (condition.goto === 'END') return 'END';
        return steps.find((s) => s.id === condition.goto) ?? null;
      }
    } catch (err) {
      console.error(`[workflow-runner] transition eval error:`, err);
    }
  }

  return null; // no condition matched → fall through
}

// ── Main executor ─────────────────────────────────────────────────────────

export async function executeWorkflow(
  agentId: string,
  workflowId: string,
  trigger: 'manual' | 'chat'
): Promise<string> {
  const workflow = getWorkflow(agentId, workflowId);
  if (!workflow) throw new Error(`Workflow "${workflowId}" not found`);
  if (workflow.steps.length === 0) throw new Error(`Workflow "${workflowId}" has no steps`);

  const agent = getAgent(agentId);
  if (!agent) throw new Error(`Agent "${agentId}" not found`);

  const workspaceDir = path.resolve(REPO_ROOT, agent.workspaceDir);
  const run = createRun(agentId, workflowId, trigger);
  const allResults: StepResult[] = [];
  const abortCtrl = new AbortController();
  const runKey = `${agentId}:${run.id}`;
  activeRuns.set(runKey, { ctrl: abortCtrl, agentId });

  // Pre-create all run_steps as pending
  const runStepMap = new Map<string, string>(); // stepId → runStepId
  for (const step of workflow.steps) {
    const runStep = createRunStep(agentId, { runId: run.id, stepId: step.id });
    runStepMap.set(step.id, runStep.id);
  }

  let currentStep: Step | null = workflow.steps[0];
  let prevOutput: unknown = null;

  while (currentStep) {
    if (abortCtrl.signal.aborted) {
      for (const step of workflow.steps) {
        const rsId = runStepMap.get(step.id)!;
        if (!allResults.some(r => r.stepId === step.id)) {
          updateRunStep(agentId, rsId, { status: 'skipped' });
        }
      }
      updateRun(agentId, run.id, { status: 'cancelled', finishedAt: Date.now() });
      activeRuns.delete(runKey);
      await closeBrowserTabs(agentId);
      return run.id;
    }
    const runStepId = runStepMap.get(currentStep.id)!;
    const startedAt = Date.now();

    // Mark step as running
    updateRunStep(agentId, runStepId, { status: 'running', startedAt });

    try {
      const stepChannelId = `wf-${run.id}-s${currentStep.position}`;
      const events: RunStepEvent[] = [];
      let pendingFlush: ReturnType<typeof setTimeout> | null = null;
      let lastFlushAt = 0;
      const flush = () => {
        pendingFlush = null;
        lastFlushAt = Date.now();
        try { writeRunStepEvents(agentId, runStepId, events); } catch { /* best-effort */ }
      };
      const scheduleFlush = () => {
        if (pendingFlush) return;
        const elapsed = Date.now() - lastFlushAt;
        const delay = elapsed >= 1000 ? 0 : 1000 - elapsed;
        pendingFlush = setTimeout(flush, delay);
      };
      let output: unknown;
      try {
        output = await executeAgentStep(
          currentStep.config, prevOutput, allResults, agent, stepChannelId,
          (event) => { events.push(event); scheduleFlush(); },
        );
      } finally {
        if (pendingFlush) { clearTimeout(pendingFlush); pendingFlush = null; }
        if (events.length > 0) { try { writeRunStepEvents(agentId, runStepId, events); } catch { /* ignore */ } }
      }

      const finishedAt = Date.now();
      updateRunStep(agentId, runStepId, {
        status: 'completed',
        input: prevOutput,
        output,
        startedAt,
        finishedAt,
        durationMs: finishedAt - startedAt,
      });

      allResults.push({ stepId: currentStep.id, name: currentStep.name, output });
      prevOutput = output;

      // Evaluate transitions
      const transitionResult = evaluateTransitions(currentStep.transitions, output, workflow.steps);

      if (transitionResult === 'END') {
        currentStep = null;
      } else if (transitionResult !== null) {
        currentStep = transitionResult;
      } else {
        // Fall through to next position
        const nextPos: number = currentStep.position + 1;
        currentStep = workflow.steps.find((s) => s.position === nextPos) ?? null;
      }
    } catch (err) {
      // If the abort signal fired (cancel), treat as cancellation not failure
      if (abortCtrl.signal.aborted) {
        updateRunStep(agentId, runStepId, { status: 'skipped', startedAt });
        for (const step of workflow.steps) {
          const rsId = runStepMap.get(step.id)!;
          if (rsId !== runStepId && !allResults.some(r => r.stepId === step.id)) {
            updateRunStep(agentId, rsId, { status: 'skipped' });
          }
        }
        updateRun(agentId, run.id, { status: 'cancelled', finishedAt: Date.now() });
        activeRuns.delete(runKey);
        await closeBrowserTabs(agentId);
        return run.id;
      }

      const finishedAt = Date.now();
      const message = err instanceof Error ? err.message : String(err);
      updateRunStep(agentId, runStepId, {
        status: 'failed',
        input: prevOutput,
        error: message,
        startedAt,
        finishedAt,
        durationMs: finishedAt - startedAt,
      });

      // Mark remaining steps as skipped
      for (const step of workflow.steps) {
        const rsId = runStepMap.get(step.id)!;
        if (rsId !== runStepId && !allResults.some((r) => r.stepId === step.id)) {
          updateRunStep(agentId, rsId, { status: 'skipped' });
        }
      }

      updateRun(agentId, run.id, { status: 'failed', finishedAt });
      activeRuns.delete(runKey);
      console.error(`[workflow-runner] step "${currentStep?.name}" failed:`, message);

      // Post failure to UI channel so chat has context
      const failSummary = `**Workflow "${workflow.name}" failed** at step "${currentStep?.name}"\n\nError: ${message}`;
      saveMessage({ id: randomUUID(), agentId, channelId: 'ui', role: 'assistant', content: failSummary });

      await closeBrowserTabs(agentId);
      return run.id;
    }
  }

  activeRuns.delete(runKey);
  updateRun(agentId, run.id, { status: 'completed', finishedAt: Date.now() });

  // Post workflow result summary to UI channel so chat has context
  const lastOutput = allResults[allResults.length - 1];
  const outputPreview = typeof lastOutput?.output === 'string'
    ? lastOutput.output.slice(0, 500)
    : JSON.stringify(lastOutput?.output ?? null).slice(0, 500);
  const summary = `**Workflow "${workflow.name}" completed** (${allResults.length} steps)\n\nFinal output:\n${outputPreview}`;
  saveMessage({ id: randomUUID(), agentId, channelId: 'ui', role: 'assistant', content: summary });

  await closeBrowserTabs(agentId);
  return run.id;
}
