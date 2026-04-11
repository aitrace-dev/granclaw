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
import { execFile } from 'child_process';
import { promisify } from 'util';
import { AgentConfig, REPO_ROOT } from '../config.js';
import { saveSession, getSessionFile } from '../agent-db.js';
import { logAction } from '../logs-db.js';
import { getProvider, getProviderApiKey, getSearchApiKey } from '../providers-config.js';
import { createSchedule, listSchedules } from '../schedules-db.js';
import { parseExpression } from 'cron-parser';
import {
  createSession as createBrowserSession,
  appendCommand as appendBrowserCommand,
  startRecording as startBrowserRecording,
  finalizeSession as finalizeBrowserSession,
  type BrowserSessionHandle,
} from '../browser/session-manager.js';
import { stealthArgv } from '../browser/stealth.js';

const execFileAsync = promisify(execFile);

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

  // One-time cleanup: the agent-browser skill has been replaced by the
  // inline `browser` pi tool registered in runAgent(). Remove any stale
  // copies from workspaces that were bootstrapped under the old skill path
  // so pi's <available_skills> system prompt block doesn't advertise a
  // broken bash entry point.
  const staleBrowserSkillDir = path.join(workspaceDir, '.pi', 'skills', 'agent-browser');
  if (fs.existsSync(staleBrowserSkillDir)) {
    try {
      fs.rmSync(staleBrowserSkillDir, { recursive: true, force: true });
      console.log(`[runner-pi] removed stale agent-browser skill from ${staleBrowserSkillDir}`);
    } catch { /* best effort */ }
  }

  // Skills: .pi/skills/ — CONFIG_DIR_NAME in the pi SDK is ".pi", so
  // loadSkills() scans <cwd>/.pi/skills/ for project-level skills. Using
  // .agent/skills/ (the previous path) meant the <available_skills> block
  // in the system prompt was always empty and the agent had to explore manually.
  const skillsTemplateDir = path.join(resolveTemplatesDir(), 'skills');
  if (fs.existsSync(skillsTemplateDir)) {
    const targetSkillsDir = path.join(workspaceDir, '.pi', 'skills');

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
        message: [
          'Daily vault housekeeping. Use your built-in tools only — no scripts, no bash commands.',
          '',
          'Step 1 — Calculate today\'s timestamp window',
          'Determine today\'s date (YYYY-MM-DD). Compute two epoch-ms values:',
          '  from_ms = UTC midnight of today  (e.g. 2026-04-11T00:00:00Z → 1744329600000)',
          '  to_ms   = from_ms + 86400000     (next midnight)',
          '',
          'Step 2 — Fetch today\'s messages',
          'GET /agents/{agentId}/messages?from=YYYY-MM-DD&to=YYYY-MM-DD&sortBy=asc&limit=200&offset=0',
          'If the response contains 200 items, increment offset by 200 and repeat until fewer than 200 are returned.',
          'Collect all messages from every page.',
          '',
          'Step 3 — Fetch today\'s action logs',
          'GET /logs?agentId={agentId}&from={from_ms}&to={to_ms}&limit=200&offset=0',
          'Paginate: increment offset by 200 and repeat until the response returns fewer than 200 items.',
          'This gives you every tool call, error, and system event for today only.',
          '',
          'Step 4 — Summarise with your LLM',
          'Read through the collected messages and logs. Write a compact 3–5 sentence summary: what was researched, what was found, what was decided. Discard noise, duplicate tool calls, and retries.',
          '',
          'Step 5 — Write journal entry',
          'Write to vault/journal/YYYY-MM-DD.md. Format:',
          '# YYYY-MM-DD',
          '## Summary',
          '<3–5 sentence LLM summary>',
          '## Conversations',
          '- <each user message, max 120 chars>',
          '## Actions',
          '- <tool: key detail, one per line>',
          '## Errors',
          '<errors encountered, or "None">',
          '',
          'Step 6 — Rebuild vault/journal/index.md',
          'List all .md files in vault/journal/ (excluding index.md), sorted newest first. Use each file\'s first heading as the summary column.',
          '',
          'Step 7 — Rebuild vault/index.md',
          'Top-level index: list journal, topics, knowledge, sessions, actions folders with file counts and links to their index.md. Include a "Recent Activity" section with the 7 most recent journal filenames.',
          '',
          'Keep everything concise. Goal: a compact, searchable record — not a transcript.',
        ].join('\n'),
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
  // Use agent.provider if set; otherwise fall back to the first configured provider.
  const providerCfg = getProvider(agent.provider);
  if (!providerCfg) {
    onChunk({ type: 'error', message: 'No provider configured. Go to Settings to add a provider.' });
    return;
  }

  const apiKey = getProviderApiKey(agent.provider);
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

  // Browser session state — captured by closure in the `browser` tool and
  // finalized in the finally block. Null means the agent never touched the
  // browser this turn, so there's nothing to clean up.
  const browserState: { handle: BrowserSessionHandle | null } = { handle: null };

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
    //
    // Per-channel isolation: each channel (ui, schedule, sch-<cronId>, telegram)
    // gets its own session file. Without this, every channel was colliding on
    // the most recent file via continueRecent(), causing cross-channel context
    // bloat — a UI turn would replay every cron execution and vice versa.
    const sessionsDir = path.join(workspaceDir, '.pi-sessions');
    fs.mkdirSync(sessionsDir, { recursive: true });

    const savedSessionFile = getSessionFile(workspaceDir, agent.id, channelId);
    const sessionManager = savedSessionFile && fs.existsSync(savedSessionFile)
      ? SessionManager.open(savedSessionFile, sessionsDir)
      : SessionManager.create(workspaceDir, sessionsDir);

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

    // recall_history tool: queries the GranClaw messages DB via the REST API.
    // Always registered — the messages DB is always available.
    extensionFactories.push((pi: any) => {
      pi.registerTool({
        name: 'recall_history',
        label: 'Recall History',
        description:
          'Search your conversation history in the messages database. ' +
          'Use for precise, factual recall: exact quotes, keyword search, time-range queries, and message counts. ' +
          'For long-term summaries and context, search the vault files instead.',
        promptSnippet: 'Search conversation history',
        promptGuidelines: [
          'Use when asked "what did I say about X", "how many messages today", "what happened between Xam and Yam".',
          'Use count=true for aggregate questions ("how many times did I mention X?") — returns only a number, no rows.',
          'Use format=csv for token-efficient output when you need content (timestamp|role|content per line).',
          'Use from/to with ISO dates (YYYY-MM-DD or full datetime) to scope by day or time range.',
          'Use role=user to find what the user said; role=assistant to find your own replies.',
        ],
        parameters: {
          type: 'object',
          properties: {
            contains: { type: 'string', description: 'Filter messages whose content contains this substring' },
            from:     { type: 'string', description: 'ISO date or datetime — include messages at or after this time (e.g. 2026-04-10 or 2026-04-10T09:00:00Z)' },
            to:       { type: 'string', description: 'ISO date or datetime — include messages at or before this time' },
            role:     { type: 'string', enum: ['user', 'assistant', 'tool_call'], description: 'Filter by message role' },
            sortBy:   { type: 'string', enum: ['asc', 'desc'], description: 'Sort order by time (default: asc)' },
            limit:    { type: 'number', description: 'Max messages to return — capped at 200, default 50' },
            count:    { type: 'boolean', description: 'Return only a count: {"count": N} — no message rows' },
            format:   { type: 'string', enum: ['json', 'csv'], description: 'csv returns pipe-delimited timestamp|role|content (one per line) — use for token efficiency' },
          },
        },
        async execute(_toolCallId: string, params: {
          contains?: string; from?: string; to?: string;
          role?: string; sortBy?: string; limit?: number;
          count?: boolean; format?: string;
        }) {
          const apiUrl = process.env.GRANCLAW_API_URL ?? 'http://localhost:3001';
          const url = new URL(`${apiUrl}/agents/${agent.id}/messages`);
          if (params.contains) url.searchParams.set('contains', params.contains);
          if (params.from)     url.searchParams.set('from',     params.from);
          if (params.to)       url.searchParams.set('to',       params.to);
          if (params.role)     url.searchParams.set('role',     params.role);
          if (params.sortBy)   url.searchParams.set('sortBy',   params.sortBy);
          if (params.limit != null) url.searchParams.set('limit', String(params.limit));
          if (params.count)    url.searchParams.set('count',    'true');
          if (params.format)   url.searchParams.set('format',   params.format);
          try {
            const res = await fetch(url.toString());
            if (!res.ok) {
              return { content: [{ type: 'text' as const, text: `recall_history failed: HTTP ${res.status}` }] };
            }
            const text = await res.text();
            return { content: [{ type: 'text' as const, text }] };
          } catch (err) {
            return { content: [{ type: 'text' as const, text: `recall_history error: ${err instanceof Error ? err.message : String(err)}` }] };
          }
        },
      });
    });

    // compact_context tool: lets the agent trigger context compaction on
    // demand. Useful when the agent notices the conversation is getting long
    // and wants to free up headroom without waiting for auto-compaction.
    // Compaction runs non-blockingly via ExtensionContext.compact().
    extensionFactories.push((pi: any) => {
      pi.registerTool({
        name: 'compact_context',
        label: 'Compact Context',
        description:
          'Summarize older conversation turns to free up context-window space. ' +
          'Use when you notice your context is getting long and you want to keep ' +
          'working on the same task without losing essentials. Auto-compaction ' +
          'fires at ~60% of the model context window; call this sooner if you want.',
        promptSnippet: 'Compact older turns',
        promptGuidelines: [
          'Call when you see context approaching the window limit.',
          'Pass a focus hint for what MUST survive the summary (e.g. "preserve all task IDs and file paths touched this session").',
          'After compaction, older turns are replaced with a summary — you keep the most recent turns verbatim.',
        ],
        parameters: {
          type: 'object',
          properties: {
            focus: {
              type: 'string',
              description: 'Optional custom instructions for the summariser (what to preserve)',
            },
          },
        },
        async execute(
          _toolCallId: string,
          params: { focus?: string },
          _signal: AbortSignal | undefined,
          _onUpdate: unknown,
          ctx: { getContextUsage?: () => { tokens: number | null; contextWindow: number; percent: number | null } | undefined; compact?: (opts?: { customInstructions?: string }) => void },
        ) {
          try {
            const before = ctx.getContextUsage?.();
            // ctx.compact fires without awaiting — pi schedules compaction between
            // turns. session.compact() would abort the current turn, which we don't
            // want when the tool is being called mid-agent-loop.
            ctx.compact?.({ customInstructions: params.focus });
            const pct = before?.percent != null ? `${Math.round(before.percent * 100)}%` : 'unknown';
            const tokens = before?.tokens ?? 'unknown';
            return {
              content: [{
                type: 'text' as const,
                text: `Scheduled context compaction. Current usage: ${tokens} tokens (${pct} of ${before?.contextWindow ?? 'unknown'}). Older turns will be replaced with a summary before the next LLM call.`,
              }],
            };
          } catch (err) {
            return { content: [{ type: 'text' as const, text: `compact_context error: ${err instanceof Error ? err.message : String(err)}` }] };
          }
        },
      });
    });

    // task-board tools: list, get, create, update, comment via REST API.
    // Always registered — task board is always available.
    extensionFactories.push((pi: any) => {
      const taskBase = () => {
        const apiUrl = process.env.GRANCLAW_API_URL ?? 'http://localhost:3001';
        return `${apiUrl}/agents/${agent.id}/tasks`;
      };
      const fetchJson = async (url: string, init?: RequestInit) => {
        const res = await fetch(url, init);
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
        return res.json();
      };
      const err = (tool: string, e: unknown) => ({
        content: [{ type: 'text' as const, text: `${tool} error: ${e instanceof Error ? e.message : String(e)}` }],
      });

      pi.registerTool({
        name: 'list_tasks',
        label: 'List Tasks',
        description: 'List tasks from the kanban board. Optionally filter by status.',
        promptSnippet: 'List tasks',
        promptGuidelines: ['Use to see what is in backlog, in_progress, to_review, or done.'],
        parameters: {
          type: 'object',
          properties: {
            status: { type: 'string', enum: ['backlog', 'in_progress', 'scheduled', 'to_review', 'done'], description: 'Filter by status (omit for all tasks)' },
          },
        },
        async execute(_id: string, params: { status?: string }) {
          try {
            const url = params.status ? `${taskBase()}?status=${params.status}` : taskBase();
            const data = await fetchJson(url);
            return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
          } catch (e) { return err('list_tasks', e); }
        },
      });

      pi.registerTool({
        name: 'get_task',
        label: 'Get Task',
        description: 'Get a single task by ID, including its comments.',
        promptSnippet: 'Get task details',
        promptGuidelines: ['Use when you need the full task body or to read comments.'],
        parameters: {
          type: 'object',
          properties: {
            taskId: { type: 'string', description: 'Task ID, e.g. TSK-001' },
          },
          required: ['taskId'],
        },
        async execute(_id: string, params: { taskId: string }) {
          try {
            const data = await fetchJson(`${taskBase()}/${params.taskId}`);
            return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
          } catch (e) { return err('get_task', e); }
        },
      });

      pi.registerTool({
        name: 'create_task',
        label: 'Create Task',
        description: 'Create a new task on the kanban board.',
        promptSnippet: 'Create a task',
        promptGuidelines: [
          'Use when breaking down work into subtasks or tracking a new action item.',
          'Status defaults to backlog. Use markdown in description.',
        ],
        parameters: {
          type: 'object',
          properties: {
            title:       { type: 'string', description: 'Short task title (under 80 chars)' },
            description: { type: 'string', description: 'Full description in markdown (optional)' },
            status:      { type: 'string', enum: ['backlog', 'in_progress', 'scheduled', 'to_review', 'done'], description: 'Initial status (default: backlog)' },
          },
          required: ['title'],
        },
        async execute(_id: string, params: { title: string; description?: string; status?: string }) {
          try {
            const data = await fetchJson(taskBase(), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(params),
            });
            return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
          } catch (e) { return err('create_task', e); }
        },
      });

      pi.registerTool({
        name: 'update_task',
        label: 'Update Task',
        description: 'Update a task\'s title, description, or status.',
        promptSnippet: 'Update a task',
        promptGuidelines: [
          'Only send fields you want to change.',
          'Move to in_progress when starting, to_review when done and awaiting human review.',
        ],
        parameters: {
          type: 'object',
          properties: {
            taskId:      { type: 'string', description: 'Task ID, e.g. TSK-001' },
            title:       { type: 'string', description: 'New title (optional)' },
            description: { type: 'string', description: 'New description in markdown (optional)' },
            status:      { type: 'string', enum: ['backlog', 'in_progress', 'scheduled', 'to_review', 'done'], description: 'New status (optional)' },
          },
          required: ['taskId'],
        },
        async execute(_id: string, params: { taskId: string; title?: string; description?: string; status?: string }) {
          try {
            const { taskId, ...body } = params;
            const data = await fetchJson(`${taskBase()}/${taskId}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
            });
            return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
          } catch (e) { return err('update_task', e); }
        },
      });

      pi.registerTool({
        name: 'add_task_comment',
        label: 'Add Task Comment',
        description: 'Add a comment to a task.',
        promptSnippet: 'Comment on a task',
        promptGuidelines: ['Use to log progress, blockers, or notes the human should see.'],
        parameters: {
          type: 'object',
          properties: {
            taskId: { type: 'string', description: 'Task ID, e.g. TSK-001' },
            body:   { type: 'string', description: 'Comment body in markdown' },
          },
          required: ['taskId', 'body'],
        },
        async execute(_id: string, params: { taskId: string; body: string }) {
          try {
            const data = await fetchJson(`${taskBase()}/${params.taskId}/comments`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ body: params.body }),
            });
            return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
          } catch (e) { return err('add_task_comment', e); }
        },
      });
    });

    // browser tool: per-turn browser session lifecycle + agent-browser CLI
    // wrapper. Always registered — agent-browser is a dev dependency of
    // GranClaw and the user expects the agent to be able to browse.
    //
    // Each runAgent invocation owns at most ONE browser session (one video,
    // one meta.json, one chapter list). The session is lazily created on
    // the first browser call — turns that never touch the web leave no
    // artifacts behind. Closed by the finally block whether the LLM loop
    // ends cleanly or throws.
    //
    // Privileged commands (record, close, tab close for session 0,
    // session management) are rejected — the runtime owns those.
    extensionFactories.push((pi: any) => {
      const agentBrowserBin = process.env.AGENT_BROWSER_BIN ?? 'agent-browser';
      const profileDir = path.join(workspaceDir, '.browser-profile');

      const PRIVILEGED_COMMANDS = new Set(['record', 'close', 'session']);
      const KNOWN_COMMANDS = [
        'open', 'click', 'dblclick', 'type', 'fill', 'press', 'keyboard',
        'hover', 'focus', 'check', 'uncheck', 'select', 'drag', 'upload',
        'download', 'scroll', 'scrollintoview', 'wait', 'screenshot', 'pdf',
        'snapshot', 'eval', 'connect', 'back', 'forward', 'reload', 'get',
        'is', 'find', 'mouse', 'set', 'network', 'cookies', 'storage', 'tab',
        'diff', 'trace', 'profiler', 'console', 'errors', 'highlight',
        'inspect', 'clipboard', 'auth', 'confirm', 'deny',
      ];

      pi.registerTool({
        name: 'browser',
        label: 'Browser',
        description:
          'Headless browser automation. Runs one command at a time against your dedicated Chrome daemon, ' +
          'which keeps its cookies and login state between turns. ' +
          'The session, recording, and cleanup are managed automatically — do NOT call `record`, `close`, ' +
          'or `session`, they are rejected. Every turn is recorded as a single WebM video visible in the dashboard Browser view.',
        promptSnippet: 'Control a headless browser — navigate, click, fill, snapshot, extract data',
        promptGuidelines: [
          'Core loop: open → snapshot → interact → re-snapshot. Refs from snapshot are invalidated by navigation.',
          'For visual reasoning use `snapshot --annotate -i` (annotated screenshot with numbered refs).',
          'For data extraction use `snapshot` (plain accessibility tree) or `text --ref <ref>`.',
          'Do not call `record start`, `record stop`, `close`, or `session` — the runtime manages those.',
          'You do not need to screenshot for audit — the whole session is recorded as video automatically.',
          'Saved logins persist automatically when the user has set up a profile via the dashboard Browser view.',
          'Examples: {"command":"open","args":["https://example.com"]}, {"command":"click","args":["--ref","e12"]}, {"command":"fill","args":["--ref","e5","Alice"]}',
        ],
        parameters: {
          type: 'object',
          properties: {
            command: {
              type: 'string',
              description: 'The agent-browser subcommand: open, click, fill, snapshot, scroll, wait, eval, tab, etc.',
            },
            args: {
              type: 'array',
              items: { type: 'string' },
              description: 'Positional arguments and flags for the subcommand, in order (e.g. ["--ref","e12"] or ["https://example.com"])',
            },
          },
          required: ['command'],
        },
        async execute(_toolCallId: string, params: { command?: string; args?: string[] }) {
          const command = (params.command ?? '').trim();
          const args = Array.isArray(params.args) ? params.args.map(String) : [];

          if (!command) {
            return { content: [{ type: 'text' as const, text: 'browser: `command` is required (e.g. "open", "snapshot", "click")' }] };
          }
          if (PRIVILEGED_COMMANDS.has(command)) {
            return {
              content: [{
                type: 'text' as const,
                text: `browser: "${command}" is managed by the runtime and cannot be called directly. ` +
                      `Recording, closing, and session identity are set up for you automatically.`,
              }],
            };
          }
          if (!KNOWN_COMMANDS.includes(command)) {
            // Non-fatal — still pass through so new agent-browser features work.
            // The command will error out downstream if it really is invalid.
          }

          // Lazily create the session + start recording on first use
          if (!browserState.handle) {
            browserState.handle = createBrowserSession(agent.id, workspaceDir);
          }
          if (!browserState.handle.recordingStarted) {
            await startBrowserRecording(browserState.handle);
          }

          // Build argv: --session <id> [--profile <path>] [--extension ...] [--executable-path ...] <command> <args...>
          // agent-browser only applies launch flags on the command that boots
          // the daemon — under normal operation startRecording has already
          // booted it, so these are a no-op here. They're kept as belt-and-
          // braces in case recording ever fails to start first.
          const argv: string[] = ['--session', agent.id];
          if (fs.existsSync(profileDir)) {
            argv.push('--profile', profileDir);
          }
          argv.push(...stealthArgv());
          argv.push(command, ...args);

          try {
            const { stdout, stderr } = await execFileAsync(agentBrowserBin, argv, {
              cwd: workspaceDir,
              timeout: 60_000,
              maxBuffer: 10 * 1024 * 1024,
            });
            appendBrowserCommand(browserState.handle, `${command} ${args.join(' ')}`.trim());
            const out = stdout.trim() || stderr.trim() || 'ok';
            return { content: [{ type: 'text' as const, text: out }] };
          } catch (err) {
            appendBrowserCommand(browserState.handle, `${command} ${args.join(' ')}`.trim());
            const e = err as { stdout?: string; stderr?: string; message?: string; code?: number };
            const msg = (e.stderr || e.stdout || e.message || String(err)).trim();
            return { content: [{ type: 'text' as const, text: `browser ${command} failed: ${msg}` }] };
          }
        },
      });
    });

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

    // ── Auto-compaction: trigger at 60% of the model's context window ──
    // Pi's default triggers at contextWindow - 16k (about 87% for a 128k
    // model — way too late for slow providers). We override reserveTokens
    // to 40% of the window, which means shouldCompact fires when usage
    // crosses ~60%. keepRecentTokens stays at the pi default (~15% of window
    // or 20k, whichever is smaller) so the most recent turns survive intact.
    try {
      const contextWindow =
        (model as { contextWindow?: number } | undefined)?.contextWindow ?? 128_000;
      const reserveTokens = Math.floor(contextWindow * 0.4);
      const keepRecentTokens = Math.min(20_000, Math.floor(contextWindow * 0.15));
      session.settingsManager.applyOverrides({
        compaction: { enabled: true, reserveTokens, keepRecentTokens },
      });
      session.setAutoCompactionEnabled(true);
    } catch (err) {
      console.error(`[runner-pi:${agent.id}] failed to configure auto-compaction:`, err);
    }

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
    // Finalize the browser session if the agent used it — stops the WebM
    // recording and marks status closed so the dashboard replay view can
    // serve it. No-op if the agent never called the browser tool.
    if (browserState.handle) {
      try { await finalizeBrowserSession(browserState.handle, 'closed'); } catch { /* best effort */ }
    }
    // Restore env var only if it was injected (envKey is set only after model guard)
    if (envKey !== undefined) {
      if (prevValue === undefined) delete process.env[envKey];
      else process.env[envKey] = prevValue;
    }
  }
}
