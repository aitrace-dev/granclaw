/**
 * workflows/runner.ts
 *
 * Executes a workflow: iterates through steps, runs code or LLM steps,
 * evaluates transitions, and records results in run_steps.
 *
 * Runs in the orchestrator process. Frontend polls for status updates.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { REPO_ROOT, getAgent } from '../config.js';
import {
  getWorkflow,
  createRun,
  updateRun,
  createRunStep,
  updateRunStep,
  type Step,
} from '../workflows-db.js';
import { getProvider, getProviderApiKey } from '../providers-config.js';
import { runAgent } from '../agent/runner-pi.js';
import { randomUUID } from 'crypto';
import { saveMessage } from '../messages-db.js';

const execAsync = promisify(exec);

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

// ── Step executors ────────────────────────────────────────────────────────

async function executeCodeStep(
  config: Record<string, unknown>,
  workspaceDir: string
): Promise<unknown> {
  const script = config.script as string;
  const shell = (config.shell as string) ?? 'bash';
  const timeoutMs = (config.timeout_ms as number) ?? 30000;

  const { stdout } = await execAsync(script, {
    cwd: workspaceDir,
    shell,
    timeout: timeoutMs,
    env: { ...process.env, HOME: process.env.HOME ?? '' },
  });

  // Try parsing as JSON, fallback to raw string
  const trimmed = stdout.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    return trimmed;
  }
}

function providerEnvKey(provider: string): string {
  const keys: Record<string, string> = {
    google: 'GEMINI_API_KEY',
    openai: 'OPENAI_API_KEY',
    anthropic: 'ANTHROPIC_API_KEY',
    groq: 'GROQ_API_KEY',
    xai: 'XAI_API_KEY',
    mistral: 'MISTRAL_API_KEY',
    cerebras: 'CEREBRAS_API_KEY',
    openrouter: 'OPENROUTER_API_KEY',
  };
  return keys[provider] ?? `${provider.toUpperCase()}_API_KEY`;
}

async function executeLlmStep(
  config: Record<string, unknown>,
  prevOutput: unknown,
  allResults: StepResult[],
  workspaceDir: string,
  agentModel: string | undefined,
): Promise<unknown> {
  const providerCfg = getProvider();
  if (!providerCfg) throw new Error('No provider configured. Go to Settings to add a provider.');

  const apiKey = getProviderApiKey();
  if (!apiKey) throw new Error('Provider API key missing. Go to Settings to reconfigure.');

  const { getModel, complete } = await import('@mariozechner/pi-ai');

  const modelId = agentModel?.trim() || providerCfg.model;
  const model = (getModel as (p: string, m: string) => unknown)(providerCfg.provider, modelId);
  if (!model) throw new Error(`Model "${modelId}" not found for provider "${providerCfg.provider}".`);

  const prompt = resolveTemplates(config.prompt as string, prevOutput, allResults);
  const envKey = providerEnvKey(providerCfg.provider);
  const prevValue = process.env[envKey];
  process.env[envKey] = apiKey;
  try {
    const response = await (complete as Function)(model, {
      messages: [{ role: 'user', content: prompt }],
    });
    // Extract text from pi-ai response (same shape as runner-pi.ts events)
    if (typeof response === 'string') return response;
    if (response && typeof response === 'object') {
      // Try common text extraction paths
      const r = response as Record<string, unknown>;
      if (typeof r.text === 'string') return r.text;
      if (Array.isArray(r.content)) {
        const textBlock = (r.content as Array<Record<string, unknown>>).find(b => b.type === 'text');
        if (textBlock && typeof textBlock.text === 'string') return textBlock.text;
      }
      if (typeof r.message === 'string') return r.message;
    }
    return String(response);
  } finally {
    if (prevValue === undefined) delete process.env[envKey];
    else process.env[envKey] = prevValue;
  }
}

async function executeAgentStep(
  config: Record<string, unknown>,
  prevOutput: unknown,
  allResults: StepResult[],
  agent: { id: string; name: string; model: string; workspaceDir: string; allowedTools: string[] },
  channelId: string
): Promise<unknown> {
  const rawPrompt = config.prompt as string;
  const timeoutMs = (config.timeout_ms as number) ?? 300_000;
  const prompt = resolveTemplates(rawPrompt, prevOutput, allResults);

  let responseText = '';

  await Promise.race([
    runAgent(agent, prompt, (chunk) => {
      if (chunk.type === 'text') responseText += chunk.text;
    }, { channelId }),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Agent step timed out')), timeoutMs)
    ),
  ]);

  const trimmed = responseText.trim();

  // Check for agent-reported failure
  // Convention: agent includes "STEP_FAILED:" or "FAILED:" in output to signal failure
  // Also supports custom fail_if regex pattern in step config
  const failIf = config.fail_if as string | undefined;
  const failMatch = trimmed.match(/(?:STEP_FAILED|FAILED):\s*(.*)/s);
  if (failMatch) {
    const reason = failMatch[1]?.trim().slice(0, 200) || 'Agent reported failure';
    throw new Error(reason);
  }
  if (failIf) {
    const regex = new RegExp(failIf, 'i');
    if (regex.test(trimmed)) {
      throw new Error(`Output matched fail_if pattern: ${failIf}`);
    }
  }

  try { return JSON.parse(trimmed); } catch { return trimmed; }
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

  // Pre-create all run_steps as pending
  const runStepMap = new Map<string, string>(); // stepId → runStepId
  for (const step of workflow.steps) {
    const runStep = createRunStep(agentId, { runId: run.id, stepId: step.id });
    runStepMap.set(step.id, runStep.id);
  }

  let currentStep: Step | null = workflow.steps[0];
  let prevOutput: unknown = null;

  while (currentStep) {
    const runStepId = runStepMap.get(currentStep.id)!;
    const startedAt = Date.now();

    // Mark step as running
    updateRunStep(agentId, runStepId, { status: 'running', startedAt });

    try {
      let output: unknown;

      if (currentStep.type === 'code') {
        output = await executeCodeStep(currentStep.config, workspaceDir);
      } else if (currentStep.type === 'agent') {
        const stepChannelId = `wf-${run.id}-s${currentStep.position}`;
        output = await executeAgentStep(currentStep.config, prevOutput, allResults, agent, stepChannelId);
      } else {
        output = await executeLlmStep(currentStep.config, prevOutput, allResults, workspaceDir, agent.model);
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
      console.error(`[workflow-runner] step "${currentStep?.name}" failed:`, message);

      // Post failure to UI channel so chat has context
      const failSummary = `**Workflow "${workflow.name}" failed** at step "${currentStep?.name}"\n\nError: ${message}`;
      saveMessage({ id: randomUUID(), agentId, channelId: 'ui', role: 'assistant', content: failSummary });

      return run.id;
    }
  }

  updateRun(agentId, run.id, { status: 'completed', finishedAt: Date.now() });

  // Post workflow result summary to UI channel so chat has context
  const lastOutput = allResults[allResults.length - 1];
  const outputPreview = typeof lastOutput?.output === 'string'
    ? lastOutput.output.slice(0, 500)
    : JSON.stringify(lastOutput?.output ?? null).slice(0, 500);
  const summary = `**Workflow "${workflow.name}" completed** (${allResults.length} steps)\n\nFinal output:\n${outputPreview}`;
  saveMessage({ id: randomUUID(), agentId, channelId: 'ui', role: 'assistant', content: summary });

  return run.id;
}
