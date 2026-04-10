/**
 * agent/runner-pi.ts
 *
 * Pi-based agent runner using createAgentSession() from @mariozechner/pi-coding-agent.
 * Same runAgent/stopAgent/StreamChunk interface as runner.ts so the rest of the
 * backend can switch runners without any other change.
 *
 * Key differences from runner.ts:
 *   - No subprocess: pi runs in-process via the SDK.
 *   - Model comes from providers-config.ts (getProvider/getProviderApiKey) rather
 *     than a Claude CLI subscription.
 *   - Session files are managed by pi's SessionManager (JSONL on disk) and the
 *     session file path is saved via the 5th arg of saveSession().
 *   - Events are translated from pi's AgentEvent/AgentSessionEvent to StreamChunk.
 */

import path from 'path';
import fs from 'fs';
import { AgentConfig, REPO_ROOT } from '../config.js';
import { saveSession } from '../agent-db.js';
import { logAction } from '../logs-db.js';
import { getProvider, getProviderApiKey } from '../providers-config.js';
import { bootstrapWorkspace } from './runner.js';

// ── ESM imports — tsx handles interop at runtime ─────────────────────────────
// The pi packages are ESM-only. The backend tsconfig targets CommonJS so
// TypeScript's module resolution rejects these. @ts-ignore is intentional;
// tsx resolves them correctly at runtime. Type information is inferred from
// the d.ts files we inspected during development.
// @ts-ignore
import { createAgentSession, SessionManager } from '@mariozechner/pi-coding-agent';
// @ts-ignore
import { getModel, type Model, type Api } from '@mariozechner/pi-ai';
// @ts-ignore
import type { AgentEvent } from '@mariozechner/pi-agent-core'; // eslint-disable-line @typescript-eslint/no-unused-vars

// ── StreamChunk ──────────────────────────────────────────────────────────────
// Identical to runner.ts so callers can switch without changes.

export type StreamChunk =
  | { type: 'text'; text: string }
  | { type: 'tool_call'; tool: string; input: unknown }
  | { type: 'tool_result'; tool: string; output: unknown }
  | { type: 'agent_ready'; name: string }
  | { type: 'done'; sessionId: string }
  | { type: 'error'; message: string };

// ── Active session tracking ──────────────────────────────────────────────────

const activeSessions = new Map<string, { session: any }>();

export function stopAgent(agentId: string): boolean {
  const entry = activeSessions.get(agentId);
  if (entry) {
    try { entry.session.abort(); } catch { /* already stopped */ }
    activeSessions.delete(agentId);
    return true;
  }
  return false;
}

// ── Provider → env-var mapping ───────────────────────────────────────────────
// pi-ai reads API keys from conventional env vars (GEMINI_API_KEY, etc.).
// We inject the key from providers-config into the correct env var so that
// pi-ai's AuthStorage/getEnvApiKey chain finds it.

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

// ── Agent name extraction ────────────────────────────────────────────────────

function extractAgentName(workspaceDir: string): string | null {
  // Check AGENT.md first (pi runner), fall back to CLAUDE.md (legacy)
  for (const filename of ['AGENT.md', 'CLAUDE.md']) {
    const mdPath = path.join(workspaceDir, filename);
    if (!fs.existsSync(mdPath)) continue;
    const content = fs.readFileSync(mdPath, 'utf8');
    const match = content.match(/^#\s+(.+)/m);
    if (match) return match[1].trim();
  }
  return null;
}

// ── Runner ───────────────────────────────────────────────────────────────────

export async function runAgent(
  agent: AgentConfig,
  message: string,
  onChunk: (chunk: StreamChunk) => void,
  options?: { channelId?: string }
): Promise<void> {
  const workspaceDir = path.resolve(REPO_ROOT, agent.workspaceDir);
  const channelId = options?.channelId ?? 'ui';

  bootstrapWorkspace(workspaceDir);

  // ── Provider / API key ──────────────────────────────────────────────────
  const providerCfg = getProvider();
  if (!providerCfg) {
    onChunk({ type: 'error', message: 'No provider configured. Go to Settings to add a provider.' });
    return;
  }

  const apiKey = getProviderApiKey();
  if (!apiKey) {
    onChunk({ type: 'error', message: 'Provider API key missing. Go to Settings to reconfigure.' });
    return;
  }

  const modelId = agent.model?.trim() || providerCfg.model;
  const startedAt = Date.now();

  // Track soul state before this turn for onboarding detection
  const soulExistedBefore = fs.existsSync(path.join(workspaceDir, 'SOUL.md'));

  logAction(agent.id, 'message', { text: message });

  // Declare outside try so finally can restore the env var.
  // undefined means injection hasn't happened yet (e.g. model-not-found early return).
  let envKey: string | undefined;
  let prevValue: string | undefined;

  try {
    // ── Resolve model ───────────────────────────────────────────────────
    // getModel() expects KnownProvider literals at the type level, but our
    // provider string comes from runtime config. The cast is safe — getModel()
    // returns undefined for unknown provider/model combos, which we handle below.
    const model = (getModel as (p: string, m: string) => Model<Api> | undefined)(
      providerCfg.provider,
      modelId,
    );
    if (!model) {
      onChunk({
        type: 'error',
        message: `Model "${modelId}" not found for provider "${providerCfg.provider}". Check Settings.`,
      });
      return;
    }

    // Inject the API key into the env so pi-ai's credential chain picks it up.
    // Done here (after model guard) so the finally block always restores it.
    envKey = providerEnvKey(providerCfg.provider);
    prevValue = process.env[envKey];
    process.env[envKey] = apiKey;

    // ── Session manager ─────────────────────────────────────────────────
    // pi stores sessions as JSONL in a sessions directory. We place it
    // inside the agent workspace so it lives alongside the workspace data.
    const sessionsDir = path.join(workspaceDir, '.pi-sessions');
    fs.mkdirSync(sessionsDir, { recursive: true });

    const sessionManager = SessionManager.continueRecent(workspaceDir, sessionsDir);

    // ── Create agent session ────────────────────────────────────────────
    // Note: agentDir omitted — pi resolves it from cwd and ~/.pi/agent by default.
    // The plan specified it as workspaceDir but the actual pi API doesn't require it.
    const { session } = await (createAgentSession as Function)({
      cwd: workspaceDir,
      model,
      sessionManager,
    }) as { session: any };

    // Register for abort
    activeSessions.set(agent.id, { session });

    // ── Subscribe to events ─────────────────────────────────────────────
    // pi emits AgentEvent (from pi-agent-core) and AgentSessionEvent
    // (extended by pi-coding-agent). We translate the subset we care about
    // into StreamChunk.
    session.subscribe((event: any) => {
      try {
        switch (event.type) {
          // ── Text streaming ────────────────────────────────────────
          case 'message_update': {
            // event.assistantMessageEvent carries the pi-ai event.
            const ame = event.assistantMessageEvent;
            if (ame?.type === 'text_delta' && ame.delta) {
              onChunk({ type: 'text', text: ame.delta });
            }
            break;
          }

          // ── Full assistant message (fallback for non-streaming) ────
          case 'message_end':
            // Text was already emitted via message_update/text_delta — skip to avoid double-emit
            break;

          // ── Tool lifecycle ────────────────────────────────────────
          case 'tool_execution_start': {
            onChunk({ type: 'tool_call', tool: event.toolName, input: event.args });
            logAction(agent.id, 'tool_call', { tool: event.toolName, input: event.args });
            break;
          }
          case 'tool_execution_end': {
            const output = event.result;
            const outputStr = typeof output === 'string' ? output : JSON.stringify(output);
            onChunk({ type: 'tool_result', tool: event.toolName, output });
            logAction(agent.id, 'tool_result', null, {
              tool: event.toolName,
              output: outputStr.slice(0, 500),
              isError: event.isError,
            });
            break;
          }

          // ── Errors ────────────────────────────────────────────────
          case 'agent_end': {
            // Check for error in the last assistant message
            const messages = event.messages;
            if (Array.isArray(messages)) {
              const last = messages[messages.length - 1];
              if (last?.role === 'assistant' && last.errorMessage) {
                onChunk({ type: 'error', message: last.errorMessage });
                logAction(agent.id, 'error', null, { message: last.errorMessage });
              }
            }
            break;
          }

          default:
            break;
        }
      } catch (err) {
        // Never let an event handler crash the session
        console.error(`[runner-pi:${agent.id}] event handler error:`, err);
      }
    });

    // ── Send prompt ─────────────────────────────────────────────────────
    await session.prompt(message);

    // ── Persist session ─────────────────────────────────────────────────
    const stats = typeof session.getSessionStats === 'function'
      ? session.getSessionStats() as {
          sessionId: string;
          sessionFile: string | undefined;
          tokens?: { input: number; output: number; total: number };
          cost?: number;
        }
      : null;

    const sessionId = stats?.sessionId ?? session.sessionId ?? '';
    const sessionFile = stats?.sessionFile ?? session.sessionFile;

    saveSession(workspaceDir, agent.id, sessionId, channelId, sessionFile);

    // Log token usage if available
    if (stats?.tokens || stats?.cost) {
      logAction(agent.id, 'system', null, {
        tokens: stats.tokens,
        cost: stats.cost,
      }, Date.now() - startedAt);
    }

    // ── Onboarding detection ────────────────────────────────────────────
    if (!soulExistedBefore && fs.existsSync(path.join(workspaceDir, 'SOUL.md'))) {
      const name = extractAgentName(workspaceDir);
      if (name) {
        console.log(`[runner-pi:${agent.id}] onboarding complete — name: "${name}"`);
        onChunk({ type: 'agent_ready', name });
      }
    }

    onChunk({ type: 'done', sessionId });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    onChunk({ type: 'error', message: msg });
    logAction(agent.id, 'error', null, { message: msg });
  } finally {
    activeSessions.delete(agent.id);
    // Restore env var only if it was injected (envKey is set only after model guard)
    if (envKey !== undefined) {
      if (prevValue === undefined) delete process.env[envKey];
      else process.env[envKey] = prevValue;
    }
  }
}
