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
import { getProvider, getProviderApiKey, getSearchApiKey } from '../providers-config.js';
import { createSchedule, listSchedules } from '../schedules-db.js';
import { parseExpression } from 'cron-parser';

/**
 * Resolve the templates directory.
 *
 * Priority:
 *   1. GRANCLAW_TEMPLATES_DIR env var — set by the CLI entrypoint to the
 *      templates dir bundled inside the published package.
 *   2. <GRANCLAW_HOME>/packages/cli/templates — dev-mode fallback when the
 *      root dev script does not set the env var.
 *
 * Note: the env var is read on every call (not captured at module load)
 * so the CLI entrypoint can set it just before requiring the backend.
 * The fallback path closes over REPO_ROOT, which is a load-time snapshot
 * of GRANCLAW_HOME — once the process has started, the fallback is stable.
 */
export function resolveTemplatesDir(): string {
  const envDir = process.env.GRANCLAW_TEMPLATES_DIR?.trim();
  if (envDir) return path.resolve(envDir);
  return path.resolve(REPO_ROOT, 'packages/cli/templates');
}

// ── syncSearchMcpConfig ──────────────────────────────────────────────────────
// Called from process.ts before each turn (before the mtime snapshot).
// Injects the Brave Search MCP server when an API key is configured, removes
// it when not. Only writes the file when the content actually changes so the
// mtime-based session-clear logic in process.ts is not triggered spuriously.

export function syncSearchMcpConfig(workspaceDir: string): void {
  const mcpPath = path.join(workspaceDir, 'tools.mcp.json');
  let config: { mcpServers: Record<string, unknown> } = { mcpServers: {} };
  if (fs.existsSync(mcpPath)) {
    try { config = JSON.parse(fs.readFileSync(mcpPath, 'utf8')); } catch { /* use empty */ }
  }
  if (!config.mcpServers) config.mcpServers = {};

  const apiKey = getSearchApiKey();
  if (apiKey) {
    config.mcpServers['brave-search'] = {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-brave-search'],
      env: { BRAVE_API_KEY: apiKey },
    };
  } else {
    delete config.mcpServers['brave-search'];
  }

  const newContent = JSON.stringify(config, null, 2);
  const oldContent = fs.existsSync(mcpPath) ? fs.readFileSync(mcpPath, 'utf8') : '';
  if (newContent !== oldContent) fs.writeFileSync(mcpPath, newContent);
}

// ── bootstrapWorkspace ───────────────────────────────────────────────────────
// Pi-specific workspace bootstrap: uses AGENT.md and .agent/skills/ instead of
// the Claude-specific CLAUDE.md and .claude/skills/ paths.

export function bootstrapWorkspace(workspaceDir: string): void {
  fs.mkdirSync(workspaceDir, { recursive: true });

  // AGENT.md — prefer AGENT.md, fall back to CLAUDE.md for existing workspaces
  const agentMd = path.join(workspaceDir, 'AGENT.md');
  const claudeMd = path.join(workspaceDir, 'CLAUDE.md');
  if (!fs.existsSync(agentMd) && !fs.existsSync(claudeMd)) {
    const template = path.join(resolveTemplatesDir(), 'AGENT.onboarding.md');
    if (fs.existsSync(template)) {
      // Stamp agent ID and system timezone so the agent never needs to ask
      const agentId = path.basename(workspaceDir);
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const content = fs.readFileSync(template, 'utf8')
        .replace(/YOUR_AGENT_ID/g, agentId)
        .replace(/GRANCLAW_TIMEZONE/g, timezone);
      fs.writeFileSync(agentMd, content);
      console.log(`[runner-pi] wrote AGENT.md to ${workspaceDir} (agentId=${agentId})`);
    }
  }

  // .mcp.json — prevent inheriting host MCP servers
  const mcpJson = path.join(workspaceDir, '.mcp.json');
  if (!fs.existsSync(mcpJson)) {
    fs.writeFileSync(mcpJson, JSON.stringify({ mcpServers: {} }, null, 2));
  }

  // Vault directory structure (second brain)
  const vaultDir = path.join(workspaceDir, 'vault');
  if (!fs.existsSync(vaultDir)) {
    for (const sub of ['journal', 'sessions', 'actions', 'topics', 'knowledge']) {
      fs.mkdirSync(path.join(vaultDir, sub), { recursive: true });
    }
  }

  // Skills: .agent/skills/ (pi standard path)
  const skillsTemplateDir = path.join(resolveTemplatesDir(), 'skills');
  if (fs.existsSync(skillsTemplateDir)) {
    const targetSkillsDir = path.join(workspaceDir, '.agent', 'skills');
    for (const skillName of fs.readdirSync(skillsTemplateDir)) {
      const srcDir = path.join(skillsTemplateDir, skillName);
      const destDir = path.join(targetSkillsDir, skillName);
      if (!fs.statSync(srcDir).isDirectory()) continue;
      if (fs.existsSync(destDir)) continue;
      fs.mkdirSync(destDir, { recursive: true });
      for (const file of fs.readdirSync(srcDir)) {
        fs.copyFileSync(path.join(srcDir, file), path.join(destDir, file));
      }
      for (const file of fs.readdirSync(destDir)) {
        if (file.endsWith('.sh')) fs.chmodSync(path.join(destDir, file), 0o755);
      }
      console.log(`[runner-pi] bootstrapped skill "${skillName}" to ${destDir}`);
    }
  }

  // Pi extensions: .pi/extensions/ (project-local, loaded by pi on every session)
  const piExtTemplateDir = path.join(resolveTemplatesDir(), 'pi-extensions');
  if (fs.existsSync(piExtTemplateDir)) {
    const targetExtDir = path.join(workspaceDir, '.pi', 'extensions');
    fs.mkdirSync(targetExtDir, { recursive: true });
    for (const file of fs.readdirSync(piExtTemplateDir)) {
      const dest = path.join(targetExtDir, file);
      // Always overwrite extensions so fixes are picked up on restart
      fs.copyFileSync(path.join(piExtTemplateDir, file), dest);
    }
  }

  // Sessions directory for pi JSONL session files
  fs.mkdirSync(path.join(workspaceDir, '.pi-sessions'), { recursive: true });

  // Default vault housekeeping schedule
  const agentId = path.basename(workspaceDir);
  try {
    const existing = listSchedules(agentId);
    if (!existing.some(s => s.name === 'Vault housekeeping')) {
      const cron = '30 23 * * *';
      const nextRun = parseExpression(cron, { tz: 'Asia/Singapore' }).next().getTime();
      createSchedule(agentId, {
        name: 'Vault housekeeping',
        message: 'Run vault housekeeping: scan all vault folders, rebuild every index.md with one-line summaries for each file, update vault/index.md with folder counts and recent activity. Check for orphaned wikilinks and entities that need topic notes. Never delete files.',
        cron,
        timezone: 'Asia/Singapore',
        nextRun,
      });
      console.log(`[runner-pi] created default vault housekeeping schedule for ${agentId}`);
    }
  } catch { /* schedules DB may not be ready yet */ }
}

// ── Pi packages are ESM-only — loaded via dynamic import() inside runAgent ───
// Static top-level imports fail in a CommonJS backend because Node resolves
// the "exports" map using the CJS condition, which these packages don't expose.
// Dynamic import() uses the "import" condition and works correctly at runtime.

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

  // logAction writes to the shared logs.db. Non-fatal: WAL/locking issues
  // can prevent new processes from opening it, but should never crash the agent.
  try { logAction(agent.id, 'message', { text: message }); } catch { /* ignore */ }

  // Declare outside try so finally can restore the env var.
  // undefined means injection hasn't happened yet (e.g. model-not-found early return).
  let envKey: string | undefined;
  let prevValue: string | undefined;

  try {
    // ── Load pi packages (ESM-only, must use dynamic import) ───────────
    const { getModel } = await import('@mariozechner/pi-ai');
    const { createAgentSession, SessionManager, DefaultResourceLoader } = await import('@mariozechner/pi-coding-agent');

    // ── Resolve model ───────────────────────────────────────────────────
    // getModel() expects KnownProvider literals at the type level, but our
    // provider string comes from runtime config. The cast is safe — getModel()
    // returns undefined for unknown provider/model combos, which we handle below.
    const model = (getModel as (p: string, m: string) => unknown)(
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

    // ── Load SYSTEM.md as appended system prompt ────────────────────────
    // The old Claude runner used --append-system-prompt-file to inject
    // SYSTEM.md (formerly DO_NOT_DELETE.md). Pi doesn't have that flag, so
    // we pass it via DefaultResourceLoader's appendSystemPrompt option.
    // Missing gracefully: the file may not exist yet (renamed from
    // DO_NOT_DELETE.md in a separate task).
    let appendSystemPrompt: string | undefined;
    const systemMdPath = path.join(resolveTemplatesDir(), 'SYSTEM.md');
    if (fs.existsSync(systemMdPath)) {
      appendSystemPrompt = fs.readFileSync(systemMdPath, 'utf8');
    }

    // ── Register GranClaw built-in extensions ──────────────────────────────
    // We use extensionFactories (inline factories) instead of file-based loading.
    // DefaultResourceLoader.reload() gets extensions from pi's PackageManager
    // (settings-configured sources) — it does NOT auto-discover cwd/.pi/extensions/
    // the way pi's interactive TUI does via discoverAndLoadExtensions(). File-based
    // loading via additionalExtensionPaths also requires jiti to transpile TypeScript
    // which may fail silently. Inline factories bypass all of that.

    const searchApiKey = getSearchApiKey();
    const extensionFactories: ((pi: any) => void)[] = [];

    // web_search tool: proxies to GranClaw's /search endpoint (Brave Search).
    // Only registered when a search API key is configured.
    if (searchApiKey) {
      extensionFactories.push((pi: any) => {
        // Register directly in the factory (not in session_start) so the tool
        // is in extension.tools when the session builds its initial system prompt.
        // session_start is for UI/widget setup only — tool registration there
        // happens after the first turn's system prompt is already composed.
        pi.registerTool({
          name: 'web_search',
          label: 'Web Search',
          description:
            'Search the web for current information, news, facts, or documentation. ' +
            'Use whenever the user asks to search, look something up, or when you need up-to-date information.',
          promptSnippet: 'Search the web for current information',
          promptGuidelines: [
            'Use for any question about recent events, current prices, live data, or information past your training cutoff.',
            'Prefer specific, focused queries over vague ones.',
            'You can call this tool multiple times to refine results.',
          ],
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'The search query' },
            },
            required: ['query'],
          },
          async execute(_toolCallId: string, params: { query: string }) {
            const apiUrl = process.env.GRANCLAW_API_URL ?? 'http://localhost:3001';
            const url = `${apiUrl}/search?q=${encodeURIComponent(params.query)}`;
            try {
              const res = await fetch(url);
              if (!res.ok) {
                return { content: [{ type: 'text' as const, text: `Search failed: HTTP ${res.status}` }] };
              }
              const data = await res.json() as { results?: { title: string; url: string; description: string }[] };
              const results = (data.results ?? []).slice(0, 6);
              if (results.length === 0) {
                return { content: [{ type: 'text' as const, text: 'No results found. Try a different query.' }] };
              }
              const text = results
                .map((r, i) => `${i + 1}. **${r.title}**\n   ${r.url}\n   ${r.description}`)
                .join('\n\n');
              return {
                content: [{ type: 'text' as const, text }],
                details: { query: params.query, resultCount: results.length },
              };
            } catch (err) {
              return { content: [{ type: 'text' as const, text: `Search error: ${err instanceof Error ? err.message : String(err)}` }] };
            }
          },
        });
      });
    }

    // Build resource loader. Must call reload() before passing to createAgentSession —
    // when the sdk receives a pre-built resourceLoader it skips reload().
    const resourceLoader = new (DefaultResourceLoader as new (opts: Record<string, unknown>) => unknown)({
      cwd: workspaceDir,
      extensionFactories,
      ...(appendSystemPrompt !== undefined ? { appendSystemPrompt } : {}),
    });
    await (resourceLoader as any).reload();

    // ── Create agent session ────────────────────────────────────────────
    // Note: agentDir omitted — pi resolves it from cwd and ~/.pi/agent by default.
    const { session } = await (createAgentSession as Function)({
      cwd: workspaceDir,
      model,
      sessionManager,
      resourceLoader,
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
        model: modelId,
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
    try { logAction(agent.id, 'error', null, { message: msg }); } catch { /* ignore */ }
  } finally {
    activeSessions.delete(agent.id);
    // Restore env var only if it was injected (envKey is set only after model guard)
    if (envKey !== undefined) {
      if (prevValue === undefined) delete process.env[envKey];
      else process.env[envKey] = prevValue;
    }
  }
}
