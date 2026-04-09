/**
 * agent/runner.ts
 *
 * Spawns the Claude Code CLI as a child process for a given agent.
 * Streams output back via a callback. Persists session IDs so conversations
 * continue across messages.
 *
 * Onboarding: if CLAUDE.md is missing from the workspace, the runner copies
 * templates/CLAUDE.onboarding.md there. Claude reads it, decides to onboard
 * (or not), and replaces the file itself when done. The host never checks
 * onboarding state — Claude controls it entirely.
 *
 * Claude CLI invocation:
 *   claude -p "<message>" --output-format stream-json --verbose [--resume <sessionId>]
 */

import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { AgentConfig, REPO_ROOT } from '../config.js';
import { getSession, saveSession } from '../agent-db.js';
import { logAction } from '../logs-db.js';
import { getAllRecentMessages } from '../messages-db.js';
import { getSecrets } from '../secrets-vault.js';
import { createSchedule, listSchedules } from '../schedules-db.js';
import { parseExpression } from 'cron-parser';

// ── Claude binary resolution ──────────────────────────────────────────────────
// Ensure ~/.local/bin is in PATH for child processes (where the claude CLI lives).
export const claudeBin: string = process.env.CLAUDE_BIN ?? 'claude';
export const spawnEnv: NodeJS.ProcessEnv = {
  ...process.env,
  PATH: [
    path.join(process.env.HOME ?? '', '.local', 'bin'),
    path.join(process.env.HOME ?? '', '.nvm', 'versions', 'node', process.version, 'bin'),
    process.env.PATH ?? '',
  ].filter(Boolean).join(':'),
};

/**
 * Resolve the templates directory.
 *
 * Priority:
 *   1. GRANCLAW_TEMPLATES_DIR env var — set by the CLI entrypoint to the
 *      templates dir bundled inside the published package.
 *   2. <GRANCLAW_HOME>/templates — dev-mode fallback when the root dev
 *      script does not set the env var.
 *
 * Note: the env var is read on every call (not captured at module load)
 * so the CLI entrypoint can set it just before requiring the backend.
 */
export function resolveTemplatesDir(): string {
  const envDir = process.env.GRANCLAW_TEMPLATES_DIR?.trim();
  if (envDir) {
    return path.resolve(envDir);
  }
  return path.resolve(REPO_ROOT, 'templates');
}

// Track active Claude processes so they can be killed on stop
const activeProcesses = new Map<string, import('child_process').ChildProcess>();

export function stopAgent(agentId: string): boolean {
  const proc = activeProcesses.get(agentId);
  if (proc) {
    try { proc.kill('SIGTERM'); } catch { /* already dead */ }
    activeProcesses.delete(agentId);
    return true;
  }
  return false;
}

export type StreamChunk =
  | { type: 'text'; text: string }
  | { type: 'tool_call'; tool: string; input: unknown }
  | { type: 'tool_result'; tool: string; output: unknown }
  | { type: 'agent_ready'; name: string }
  | { type: 'done'; sessionId: string }
  | { type: 'error'; message: string };

// ── Workspace bootstrap ───────────────────────────────────────────────────────

export function bootstrapWorkspace(workspaceDir: string): void {
  fs.mkdirSync(workspaceDir, { recursive: true });
  const claudeMd = path.join(workspaceDir, 'CLAUDE.md');
  if (!fs.existsSync(claudeMd)) {
    const template = path.join(resolveTemplatesDir(), 'CLAUDE.onboarding.md');
    fs.copyFileSync(template, claudeMd);
    console.log(`[runner] copied onboarding CLAUDE.md to ${workspaceDir}`);
  }

  // Ensure agent has its own .mcp.json to prevent inheriting project-root MCP servers.
  // Claude CLI walks up the directory tree to discover .mcp.json — without this,
  // agents inherit whatever MCP servers the host developer has configured.
  const mcpJson = path.join(workspaceDir, '.mcp.json');
  if (!fs.existsSync(mcpJson)) {
    fs.writeFileSync(mcpJson, JSON.stringify({ mcpServers: {} }, null, 2));
    console.log(`[runner] created empty .mcp.json in ${workspaceDir}`);
  }

  // Bootstrap vault directory structure (second brain)
  const vaultDir = path.join(workspaceDir, 'vault');
  if (!fs.existsSync(vaultDir)) {
    for (const sub of ['journal', 'sessions', 'actions', 'topics', 'knowledge']) {
      fs.mkdirSync(path.join(vaultDir, sub), { recursive: true });
    }
    console.log(`[runner] created vault structure in ${vaultDir}`);
  }

  // Bootstrap skills from templates
  const skillsTemplateDir = path.join(resolveTemplatesDir(), 'skills');
  if (fs.existsSync(skillsTemplateDir)) {
    const targetSkillsDir = path.join(workspaceDir, '.claude', 'skills');
    for (const skillName of fs.readdirSync(skillsTemplateDir)) {
      const srcDir = path.join(skillsTemplateDir, skillName);
      const destDir = path.join(targetSkillsDir, skillName);
      if (!fs.statSync(srcDir).isDirectory()) continue;
      if (fs.existsSync(destDir)) continue; // don't overwrite existing
      fs.mkdirSync(destDir, { recursive: true });
      for (const file of fs.readdirSync(srcDir)) {
        fs.copyFileSync(path.join(srcDir, file), path.join(destDir, file));
      }
      // Make shell scripts executable
      for (const file of fs.readdirSync(destDir)) {
        if (file.endsWith('.sh')) {
          fs.chmodSync(path.join(destDir, file), 0o755);
        }
      }
      console.log(`[runner] bootstrapped skill "${skillName}" to ${destDir}`);
    }
  }

  // Bootstrap default vault housekeeping schedule
  const agentId = path.basename(workspaceDir);
  try {
    const existing = listSchedules(agentId);
    const hasHousekeeping = existing.some(s => s.name === 'Vault housekeeping');
    if (!hasHousekeeping) {
      const cron = '30 23 * * *';
      const nextRun = parseExpression(cron, { tz: 'Asia/Singapore' }).next().getTime();
      createSchedule(agentId, {
        name: 'Vault housekeeping',
        message: 'Run vault housekeeping: scan all vault folders, rebuild every index.md with one-line summaries for each file, update vault/index.md with folder counts and recent activity. Check for orphaned wikilinks and entities that need topic notes. Never delete files.',
        cron,
        timezone: 'Asia/Singapore',
        nextRun,
      });
      console.log(`[runner] created default vault housekeeping schedule for ${agentId}`);
    }
  } catch { /* schedules DB may not be ready yet for this agent */ }
}

function extractAgentName(workspaceDir: string): string | null {
  // After onboarding, Claude writes a real CLAUDE.md with the agent name as H1
  const claudeMd = path.join(workspaceDir, 'CLAUDE.md');
  if (!fs.existsSync(claudeMd)) return null;
  const content = fs.readFileSync(claudeMd, 'utf8');
  const match = content.match(/^#\s+(.+)/m);
  return match ? match[1].trim() : null;
}

// ── Runner ────────────────────────────────────────────────────────────────────

export async function runAgent(
  agent: AgentConfig,
  message: string,
  onChunk: (chunk: StreamChunk) => void,
  options?: { channelId?: string }
): Promise<void> {
  const workspaceDir = path.resolve(REPO_ROOT, agent.workspaceDir);
  const channelId = options?.channelId ?? 'ui';
  bootstrapWorkspace(workspaceDir);

  // Track soul state before this turn so we know if onboarding just completed
  const soulExistedBefore = fs.existsSync(path.join(workspaceDir, 'SOUL.md'));

  // If SOUL.md doesn't exist, this is a fresh agent — prepend onboarding nudge
  // so Claude doesn't give a generic reply and actually follows CLAUDE.md
  let finalMessage = message;
  if (!soulExistedBefore) {
    finalMessage = `[SYSTEM: You are a brand new agent with no identity yet. SOUL.md does not exist. You MUST follow the onboarding instructions in your CLAUDE.md before doing anything else. Do NOT give a generic greeting. Start the onboarding process immediately.]\n\nUser message: ${message}`;
  }

  const sessionId = getSession(workspaceDir, agent.id, channelId);

  // Always inject recent history from ALL channels so the agent has full context
  // (UI chat, workflow results — everything the agent said or received)
  if (soulExistedBefore && !finalMessage.includes('--- Recent History ---')) {
    const recentMessages = getAllRecentMessages(agent.id, 50)
      .filter(m => m.role !== 'tool_call')
      .slice(-20);
    if (recentMessages.length > 0) {
      const history = recentMessages
        .map(m => {
          const ch = m.channelId !== 'ui' ? ` [${m.channelId}]` : '';
          return `[${m.role}${ch}]: ${m.content.slice(0, 500)}`;
        })
        .join('\n\n');
      finalMessage = `[SYSTEM: Here is recent activity across all channels for context.]\n\n--- Recent History ---\n${history}\n--- End History ---\n\nUser: ${message}`;
    }
  }
  const startedAt = Date.now();
  logAction(agent.id, 'message', { text: message });

  const attempt = (resume: string | null) =>
    new Promise<void>((resolve, reject) => {
      const args = ['-p', finalMessage, '--output-format', 'stream-json', '--verbose', '--permission-mode', 'bypassPermissions'];
      if (resume) args.push('--resume', resume);

      // Inject core system instructions that every agent must follow (vault, security, skills)
      const systemMd = path.join(resolveTemplatesDir(), 'DO_NOT_DELETE.md');
      if (fs.existsSync(systemMd)) {
        args.push('--append-system-prompt-file', systemMd);
      }

      // Use --strict-mcp-config to prevent Claude CLI from inheriting MCP servers
      // from parent directories (e.g., project-root .mcp.json with Playwright).
      // Only MCP servers explicitly in --mcp-config are loaded.
      const agentMcpConfig = path.join(workspaceDir, 'tools.mcp.json');
      const workspaceMcpConfig = path.join(workspaceDir, '.mcp.json');
      if (fs.existsSync(agentMcpConfig)) {
        args.push('--mcp-config', agentMcpConfig, '--strict-mcp-config');
        console.log(`[agent:${agent.id}] loading MCP tools from ${agentMcpConfig} (strict)`);
      } else if (fs.existsSync(workspaceMcpConfig)) {
        args.push('--mcp-config', workspaceMcpConfig, '--strict-mcp-config');
      }

      // Inject secrets so they're available regardless of calling process
      // (agent process has them in env, but orchestrator/workflow runner does not)
      const agentSecrets = getSecrets(agent.id);
      const agentEnv = { ...spawnEnv, ...agentSecrets };

      // CRITICAL: never pass Anthropic auth env vars to the Claude CLI.
      // Claude Code must use the user's subscription (OAuth), not API mode.
      // If these are set, the CLI switches to API mode and fails auth.
      delete agentEnv.ANTHROPIC_API_KEY;
      delete agentEnv.ANTHROPIC_AUTH_TOKEN;
      delete agentEnv.ANTHROPIC_BASE_URL;
      delete agentEnv.CLAUDE_API_KEY;
      // Browser: session directory + persistent profile (so agent-browser always uses saved logins)
      agentEnv.AGENT_BROWSER_SESSIONS_DIR = path.join(workspaceDir, '.browser-sessions');
      const profileDir = path.join(workspaceDir, '.browser-profile');
      if (fs.existsSync(profileDir)) {
        agentEnv.AGENT_BROWSER_PROFILE = profileDir;
      }
      const proc = spawn(claudeBin, args, { cwd: workspaceDir, env: agentEnv, stdio: ['pipe', 'pipe', 'pipe'] });
      proc.stdin?.end();
      activeProcesses.set(agent.id, proc);
      proc.on('exit', () => { activeProcesses.delete(agent.id); });

      let buffer = '';
      let newSessionId = resume ?? '';

      proc.stdout.on('data', (raw: Buffer) => {
        buffer += raw.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          let parsed: Record<string, unknown>;
          try { parsed = JSON.parse(trimmed); }
          catch { onChunk({ type: 'text', text: trimmed }); continue; }
          handleClaudeEvent(parsed, onChunk, (id) => { newSessionId = id; }, agent.id);
        }
      });

      proc.stderr.on('data', (raw: Buffer) => {
        const msg = raw.toString().trim();
        if (msg) console.error(`[agent:${agent.id}] stderr:`, msg);
      });

      proc.on('close', async (code) => {
        if (code === 0 || code === null) {
          if (newSessionId) {
            saveSession(workspaceDir, agent.id, newSessionId, channelId);
          }

          // If SOUL.md was created this turn, Claude finished onboarding — announce name
          if (!soulExistedBefore && fs.existsSync(path.join(workspaceDir, 'SOUL.md'))) {
            const name = extractAgentName(workspaceDir);
            if (name) {
              console.log(`[agent:${agent.id}] onboarding complete — name: "${name}"`);
              onChunk({ type: 'agent_ready', name });
            }
          }

          onChunk({ type: 'done', sessionId: newSessionId });
          logAction(agent.id, 'system', null, { exitCode: code }, Date.now() - startedAt);
          resolve();
        } else {
          logAction(agent.id, 'system', null, { exitCode: code }, Date.now() - startedAt);
          reject(new Error(`claude exited with code ${code}`));
        }
      });
    });

  try {
    await attempt(sessionId);
  } catch (err) {
    if (sessionId) {
      console.warn(`[agent:${agent.id}] session ${sessionId} rejected, retrying fresh`);
      saveSession(workspaceDir, agent.id, '', channelId);
      try {
        await attempt(null);
      } catch (retryErr) {
        onChunk({ type: 'error', message: retryErr instanceof Error ? retryErr.message : String(retryErr) });
        logAction(agent.id, 'error', null, { message: retryErr instanceof Error ? retryErr.message : String(retryErr) });
      }
    } else {
      onChunk({ type: 'error', message: err instanceof Error ? err.message : String(err) });
      logAction(agent.id, 'error', null, { message: err instanceof Error ? err.message : String(err) });
    }
  }
}

function handleClaudeEvent(
  event: Record<string, unknown>,
  onChunk: (chunk: StreamChunk) => void,
  onSessionId: (id: string) => void,
  agentId?: string
): void {
  const type = event.type as string;

  if (type === 'assistant') {
    const msg = event.message as { content?: Array<{ type: string; text?: string }> };
    if (msg?.content) {
      for (const block of msg.content) {
        if (block.type === 'text' && block.text) {
          onChunk({ type: 'text', text: block.text });
        } else if (block.type === 'tool_use') {
          const b = block as { name?: string; input?: unknown };
          onChunk({ type: 'tool_call', tool: b.name ?? 'unknown', input: b.input });
          if (agentId) logAction(agentId, 'tool_call', { tool: b.name, input: b.input });
        }
      }
    }
  } else if (type === 'tool_result') {
    const content = event.content as Array<{ type: string; text?: string }> | undefined;
    const text = content?.find((c) => c.type === 'text')?.text ?? '';
    onChunk({ type: 'tool_result', tool: '', output: text });
    if (agentId) logAction(agentId, 'tool_result', null, { text: text.slice(0, 500) });
  } else if (type === 'result') {
    const sid = event.session_id as string | undefined;
    if (sid) onSessionId(sid);
  }
}
