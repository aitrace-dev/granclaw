/**
 * orchestrator/server.ts
 *
 * The orchestrator's HTTP server: REST API, WebSocket proxy to agents,
 * and (optionally) static hosting of the built frontend so everything
 * ships on a single port.
 *
 * Routes:
 *   GET  /health
 *   GET  /agents                   — list agents
 *   GET  /agents/:id               — single agent detail
 *   GET  /logs                     — action log with filters
 *   WS   /ws/agents/:id            — WebSocket proxy → internal agent process
 *   GET  /*                        — built frontend (if packages/frontend/dist exists)
 *   GET  /settings/provider         — read active provider (no apiKey)
 *   PUT  /settings/provider         — save provider + apiKey
 *   DELETE /settings/provider       — clear provider config
 *   GET  /settings/search           — read active search provider
 *   PUT  /settings/search           — save search provider + apiKey
 *   DELETE /settings/search         — clear search config (reset to duckduckgo)
 *   GET  /search                    — proxy search query to configured provider
 */

import express from 'express';
import cors from 'cors';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { WebSocket, WebSocketServer } from 'ws';
import { randomUUID } from 'crypto';
import logsRouter from '../routes/logs.js';
import { getManagedAgents, getManagedAgent, restartAgent, startNewAgent, stopAndRemoveAgent } from './agent-manager.js';
import { listSecretNames, setSecret, deleteSecret } from '../secrets-vault.js';
import { getSession, closeAgentDb, enqueue, getActiveJobs, markFailed } from '../agent-db.js';
import { saveMessage, getMessages, deleteMessages, queryMessages, Message } from '../messages-db.js';
import { listTasks, getTask, createTask, updateTask, deleteTask, listComments, createComment, closeTasksDb } from '../tasks-db.js';
import {
  listWorkflows, getWorkflow, createWorkflow, updateWorkflow, deleteWorkflow,
  addStep, updateStep, removeStep,
  listRuns, getRun,
  getRunningRuns,
  closeWorkflowsDb,
} from '../workflows-db.js';
import { executeWorkflow } from '../workflows/runner.js';
import { bootstrapWorkspace } from '../agent/runner-pi.js';
import { listSchedules, getSchedule, createSchedule, updateSchedule as updateScheduleDb, deleteSchedule, closeSchedulesDb } from '../schedules-db.js';
import { startScheduler } from '../scheduler.js';
import { scanUsage } from '../usage-scanner.js';
import { parseExpression } from 'cron-parser';
import { listSessions, getSession as getBrowserSession, getSessionScreenshots, getScreenshotPath, generateSessionName } from '../browser-sessions.js';
import { REPO_ROOT, getAgents, saveAgents, type AgentConfig } from '../config.js';
import { getProvider, saveProvider, clearProvider, getSearchApiKey, saveSearch, clearSearch } from '../providers-config.js';

// ── Workspace file readers ──────────────────────────────────────────────────

function readAgentName(workspaceDir: string): string | null {
  const soulPath = path.join(workspaceDir, 'SOUL.md');
  if (!fs.existsSync(soulPath)) return null;
  const content = fs.readFileSync(soulPath, 'utf8');
  const match = content.match(/^#\s+(.+)/m);
  return match ? match[1].trim() : null;
}

function readInstalledTools(workspaceDir: string): Record<string, unknown> | null {
  const mcpPath = path.join(workspaceDir, 'tools.mcp.json');
  if (!fs.existsSync(mcpPath)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(mcpPath, 'utf8'));
    return data.mcpServers ?? null;
  } catch { return null; }
}

export function createServer() {
  const app = express();
  app.use(cors());
  app.use(express.json());

  // Track headed browser processes (one per agent)
  const headedBrowsers = new Map<string, { url: string }>();

  app.get('/health', (_req, res) => res.json({ ok: true }));

  // ── Provider settings ─────────────────────────────────────────────────────────

  app.get('/settings/provider', (_req, res) => {
    const p = getProvider();
    res.json({ provider: p?.provider ?? null, model: p?.model ?? null, configured: p !== null });
  });

  app.put('/settings/provider', (req, res) => {
    const { provider, model, apiKey } = req.body as { provider?: string; model?: string; apiKey?: string };
    if (!provider || !model || !apiKey) {
      res.status(400).json({ error: 'provider, model, and apiKey are required' });
      return;
    }
    saveProvider(provider, model, apiKey);
    res.status(200).json({ ok: true });
  });

  app.delete('/settings/provider', (_req, res) => {
    clearProvider();
    res.status(204).end();
  });

  // ── Search settings ───────────────────────────────────────────────────────────
  app.get('/settings/search', (_req, res) => {
    const apiKey = getSearchApiKey();
    res.json({ provider: 'brave', configured: !!apiKey });
  });

  app.put('/settings/search', (req, res) => {
    const { apiKey } = req.body as { apiKey?: string };
    if (!apiKey?.trim()) {
      res.status(400).json({ error: 'apiKey required' });
      return;
    }
    saveSearch(apiKey.trim());
    res.sendStatus(200);
  });

  app.delete('/settings/search', (_req, res) => {
    clearSearch();
    res.sendStatus(204);
  });

  // ── Search proxy ──────────────────────────────────────────────────────────────
  app.get('/search', async (req, res) => {
    const q = (req.query.q as string | undefined)?.trim();
    if (!q) { res.status(400).json({ error: 'q parameter required' }); return; }

    const apiKey = getSearchApiKey();
    if (!apiKey) { res.status(503).json({ error: 'Brave Search API key not configured. Add it in Settings.' }); return; }

    try {
      const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(q)}&count=10`;
      const upstream = await fetch(url, {
        headers: { 'X-Subscription-Token': apiKey, 'Accept': 'application/json' },
      });
      if (!upstream.ok) {
        res.status(upstream.status).json({ error: `Brave API error: ${upstream.status}` });
        return;
      }
      const data = await upstream.json() as { web?: { results?: Array<{ title: string; url: string; description: string }> } };
      const results = (data.web?.results ?? []).map(r => ({ title: r.title, url: r.url, description: r.description }));
      res.json({ provider: 'brave', results });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: `Search failed: ${msg}` });
    }
  });

  // ── Agents ─────────────────────────────────────────────────────────────────

  app.get('/agents', (_req, res) => {
    const managed = getManagedAgents();

    const result = managed.map((m) => {
      const workspaceDir = path.resolve(REPO_ROOT, m.config.workspaceDir);
      const agentName = readAgentName(workspaceDir);
      const sessionId = getSession(workspaceDir, m.config.id);
      return {
        id: m.config.id,
        name: agentName ?? m.config.name,
        model: m.config.model,
        allowedTools: m.config.allowedTools,
        wsPort: m.wsPort,
        bbPort: null,
        pid: m.pid,
        sessionId,
        status: sessionId ? 'active' : 'idle',
        installedTools: readInstalledTools(workspaceDir) ?? {},
        guardrails: null,
      };
    });

    res.json(result);
  });

  app.get('/agents/:id', (req, res) => {
    const managed = getManagedAgent(req.params.id);
    if (!managed) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }

    const workspaceDir = path.resolve(REPO_ROOT, managed.config.workspaceDir);
    const sessionId = getSession(workspaceDir, managed.config.id);
    // Read live state from workspace files
    const agentName = readAgentName(workspaceDir);
    const installedTools = readInstalledTools(workspaceDir);

    const { bigBrother: _bb, ...restConfig } = managed.config;
    res.json({
      ...restConfig,
      ...(agentName ? { name: agentName } : {}),
      wsPort: managed.wsPort,
      bbPort: null,
      pid: managed.pid,
      sessionId,
      status: sessionId ? 'active' : 'idle',
      installedTools: installedTools ?? {},
      guardrails: null,
    });
  });

  // ── Create / Delete agents ─────────────────────────────────────────────────

  app.post('/agents', (req, res) => {
    const { id, name, model, workspaceDir } = req.body as { id?: string; name?: string; model?: string; workspaceDir?: string };
    if (!id || !name) { res.status(400).json({ error: 'id and name required' }); return; }
    if (getManagedAgent(id)) { res.status(409).json({ error: `Agent "${id}" already exists` }); return; }

    const agentConfig: AgentConfig = {
      id,
      name,
      model: model ?? 'claude-sonnet-4-5',
      workspaceDir: workspaceDir?.trim() || `./workspaces/${id}`,
      allowedTools: ['filesystem', 'browser', 'task-manager'],
    };

    // Save to config file
    const agents = getAgents();
    agents.push(agentConfig);
    saveAgents(agents);

    // Bootstrap workspace (copies AGENT.md, skills, .mcp.json, vault structure)
    // so the agent is fully usable before its first message.
    const absWorkspaceDir = path.resolve(REPO_ROOT, agentConfig.workspaceDir);
    bootstrapWorkspace(absWorkspaceDir);

    // Start the agent
    const managed = startNewAgent(agentConfig);
    res.status(201).json({ id: agentConfig.id, wsPort: managed.wsPort });
  });

  app.delete('/agents/:id', (req, res) => {
    const managed = getManagedAgent(req.params.id);
    if (!managed) { res.status(404).json({ error: 'Agent not found' }); return; }

    const workspaceDir = path.resolve(REPO_ROOT, managed.config.workspaceDir);

    // Stop processes
    stopAndRemoveAgent(req.params.id);

    // Close all cached SQLite handles for this agent BEFORE deleting files.
    // Otherwise the orchestrator holds open handles to unlinked inodes,
    // and a recreated agent with the same id reads/writes the ghost DB.
    closeTasksDb(req.params.id);
    closeWorkflowsDb(req.params.id);
    closeSchedulesDb(req.params.id);
    closeAgentDb(workspaceDir);

    // Remove from config file
    const agents = getAgents().filter(a => a.id !== req.params.id);
    saveAgents(agents);

    // Delete workspace directory
    let workspaceDeleted = false;
    if (fs.existsSync(workspaceDir)) {
      fs.rmSync(workspaceDir, { recursive: true, force: true });
      workspaceDeleted = true;
      console.log(`[server] deleted workspace ${workspaceDir}`);
    }

    // Delete host-side message history for this agent
    deleteMessages(req.params.id);

    res.json({ ok: true, workspaceDeleted });
  });

  // ── Messages ───────────────────────────────────────────────────────────────

  app.get('/agents/:id/messages', (req, res) => {
    const { id } = req.params;
    const q = req.query;

    // Require at least one query param — bare requests with no filter are not allowed
    if (Object.keys(q).length === 0) {
      res.status(400).json({ error: 'At least one query param required (limit, role, contains, from, to, sortBy, count, format, channelId)' });
      return;
    }

    const result = queryMessages(id, {
      channelId: q.channelId as string | undefined,
      contains:  q.contains  as string | undefined,
      from:      q.from      as string | undefined,
      to:        q.to        as string | undefined,
      role:      q.role      as 'user' | 'assistant' | 'tool_call' | undefined,
      sortBy:    q.sortBy    as 'asc' | 'desc' | undefined,
      limit:     q.limit     ? Number(q.limit) : undefined,
      count:     q.count === 'true',
    });

    // count=true → {count: N}
    if ('count' in result) { res.json(result); return; }

    // format=csv → pipe-delimited timestamp|role|content (newlines escaped)
    if (q.format === 'csv') {
      const lines = (result as Message[]).map(
        (m) => `${m.createdAt}|${m.role}|${m.content.replace(/\n/g, '\\n')}`,
      );
      res.type('text/plain').send(lines.join('\n'));
      return;
    }

    res.json(result);
  });

  // Clear only the conversation session — workspace, vault, and skills are preserved.
  app.delete('/agents/:id/session', (req, res) => {
    const managed = getManagedAgent(req.params.id);
    if (!managed) { res.status(404).json({ error: 'Agent not found' }); return; }
    const workspaceDir = path.resolve(REPO_ROOT, managed.config.workspaceDir);
    const sessionsDir = path.join(workspaceDir, '.pi-sessions');
    if (fs.existsSync(sessionsDir)) {
      for (const f of fs.readdirSync(sessionsDir)) {
        fs.rmSync(path.join(sessionsDir, f), { force: true });
      }
    }
    // Clear host message history so chat UI starts clean
    deleteMessages(req.params.id);
    console.log(`[orchestrator] agent "${req.params.id}" session cleared (workspace preserved)`);
    res.json({ ok: true });
  });

  app.delete('/agents/:id/reset', async (req, res) => {
    const managed = getManagedAgent(req.params.id);
    if (!managed) { res.status(404).json({ error: 'Agent not found' }); return; }

    // 1. Clear host message history
    deleteMessages(req.params.id);

    // 2. Wipe workspace directory — every file the agent has created or stored
    //    Close DB handles first so files can be deleted cleanly on all platforms
    closeTasksDb(req.params.id);
    closeWorkflowsDb(req.params.id);
    closeSchedulesDb(req.params.id);
    const workspaceDir = path.resolve(REPO_ROOT, managed.config.workspaceDir);
    closeAgentDb(workspaceDir);
    if (fs.existsSync(workspaceDir)) {
      fs.rmSync(workspaceDir, { recursive: true, force: true });
    }

    // 3. Wipe Claude's session history for this workspace
    //    Claude stores .jsonl conversation files at:
    //    ~/.claude/projects/<absolute-workspace-path-with-slashes-as-dashes>/
    const encodedPath = workspaceDir.replace(/^\//, '').replace(/\//g, '-');
    const claudeProjectDir = path.join(process.env.HOME ?? '', '.claude', 'projects', encodedPath);
    if (fs.existsSync(claudeProjectDir)) {
      fs.rmSync(claudeProjectDir, { recursive: true, force: true });
      console.log(`[orchestrator] cleared Claude session history at ${claudeProjectDir}`);
    }

    console.log(`[orchestrator] agent "${req.params.id}" wiped`);
    res.json({ ok: true });
  });

  app.post('/agents/:id/messages', (req, res) => {
    const { id } = req.params;
    const { role, content, channelId = 'ui', createdAt } = req.body as {
      role: 'user' | 'assistant'; content: string; channelId?: string; createdAt?: number;
    };
    if (!role || !content) { res.status(400).json({ error: 'role and content required' }); return; }
    const msg = saveMessage({ id: randomUUID(), agentId: id, channelId, role, content, createdAt });
    res.status(201).json(msg);
  });

  // ── Agent .env ─────────────────────────────────────────────────────────────

  app.get('/agents/:id/env', (req, res) => {
    const managed = getManagedAgent(req.params.id);
    if (!managed) { res.status(404).json({ error: 'Agent not found' }); return; }
    const envPath = path.join(path.resolve(REPO_ROOT, managed.config.workspaceDir), '.env');
    if (!fs.existsSync(envPath)) { res.json({ entries: [] }); return; }
    const content = fs.readFileSync(envPath, 'utf8');
    const entries = content.split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'))
      .map((l) => {
        const eq = l.indexOf('=');
        if (eq === -1) return null;
        return { key: l.slice(0, eq).trim(), value: l.slice(eq + 1).trim() };
      })
      .filter(Boolean);
    res.json({ entries });
  });

  app.put('/agents/:id/env', (req, res) => {
    const managed = getManagedAgent(req.params.id);
    if (!managed) { res.status(404).json({ error: 'Agent not found' }); return; }
    const { entries } = req.body as { entries?: { key: string; value: string }[] };
    if (!entries || !Array.isArray(entries)) { res.status(400).json({ error: 'entries array required' }); return; }
    const workspaceDir = path.resolve(REPO_ROOT, managed.config.workspaceDir);
    if (!fs.existsSync(workspaceDir)) fs.mkdirSync(workspaceDir, { recursive: true });
    const content = entries.map((e) => `${e.key}=${e.value}`).join('\n') + '\n';
    fs.writeFileSync(path.join(workspaceDir, '.env'), content);
    res.json({ ok: true });
  });

  // ── Workspace filesystem ────────────────────────────────────────────────────

  // Whitelist of file extensions that are safe to display/read as text
  const READABLE_EXTENSIONS = new Set([
    '.md', '.txt', '.json', '.yaml', '.yml', '.toml',
    '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
    '.py', '.rb', '.go', '.rs', '.java', '.c', '.cpp', '.h',
    '.html', '.css', '.scss', '.less', '.svg',
    '.sh', '.bash', '.zsh', '.fish',
    '.env', '.gitignore', '.dockerignore',
    '.xml', '.csv', '.log', '.ini', '.cfg',
    '.sql', '.graphql', '.proto',
    '.lock', // package-lock, yarn.lock, etc.
    '',      // files with no extension (Makefile, Dockerfile, etc.)
  ]);

  function isReadableFile(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase();
    // No-extension files: check if name looks like a known text file
    if (ext === '') {
      const name = path.basename(filePath);
      const textFileNames = ['Makefile', 'Dockerfile', 'Procfile', 'Gemfile', 'Rakefile', 'LICENSE', 'CLAUDE', 'SOUL', 'GUARDRAILS', 'README'];
      return textFileNames.some((n) => name.startsWith(n));
    }
    return READABLE_EXTENSIONS.has(ext);
  }

  function resolveWorkspacePath(managed: { config: AgentConfig }, reqPath: string): string | null {
    const workspaceDir = path.resolve(REPO_ROOT, managed.config.workspaceDir);
    const resolved = path.resolve(workspaceDir, reqPath || '.');
    // Block traversal above workspace root
    if (!resolved.startsWith(workspaceDir)) return null;
    return resolved;
  }

  app.get('/agents/:id/files', (req, res) => {
    const managed = getManagedAgent(req.params.id);
    if (!managed) { res.status(404).json({ error: 'Agent not found' }); return; }
    const dirPath = resolveWorkspacePath(managed, (req.query.path as string) ?? '');
    if (!dirPath) { res.status(403).json({ error: 'Path outside workspace' }); return; }
    if (!fs.existsSync(dirPath)) { res.json({ entries: [] }); return; }

    const stat = fs.statSync(dirPath);
    if (!stat.isDirectory()) { res.status(400).json({ error: 'Not a directory' }); return; }

    const entries = fs.readdirSync(dirPath, { withFileTypes: true })
      .filter((d) => !d.name.startsWith('.'))
      .filter((d) => d.isDirectory() || isReadableFile(path.join(dirPath, d.name)))
      .map((d) => ({
        name: d.name,
        type: d.isDirectory() ? 'directory' as const : 'file' as const,
        size: d.isFile() ? fs.statSync(path.join(dirPath, d.name)).size : undefined,
      }))
      .sort((a, b) => {
        if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

    res.json({ entries });
  });

  app.get('/agents/:id/files/read', (req, res) => {
    const managed = getManagedAgent(req.params.id);
    if (!managed) { res.status(404).json({ error: 'Agent not found' }); return; }
    const filePath = resolveWorkspacePath(managed, (req.query.path as string) ?? '');
    if (!filePath) { res.status(403).json({ error: 'Path outside workspace' }); return; }
    if (!fs.existsSync(filePath)) { res.status(404).json({ error: 'File not found' }); return; }
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) { res.status(400).json({ error: 'Is a directory' }); return; }
    if (!isReadableFile(filePath)) {
      res.status(400).json({ error: 'Binary or unsupported file type' });
      return;
    }
    // Skip large or binary files
    if (stat.size > 512_000) { res.status(400).json({ error: 'File too large (max 512KB)' }); return; }
    const content = fs.readFileSync(filePath, 'utf8');
    res.json({ content, size: stat.size });
  });

  app.put('/agents/:id/files/write', (req, res) => {
    const managed = getManagedAgent(req.params.id);
    if (!managed) { res.status(404).json({ error: 'Agent not found' }); return; }
    const filePath = resolveWorkspacePath(managed, (req.query.path as string) ?? '');
    if (!filePath) { res.status(403).json({ error: 'Path outside workspace' }); return; }
    const { content } = req.body as { content?: string };
    if (content === undefined) { res.status(400).json({ error: 'content required' }); return; }
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, content);
    res.json({ ok: true });
  });

  // ── Secrets ────────────────────────────────────────────────────────────────

  app.get('/agents/:id/secrets', (req, res) => {
    res.json({ names: listSecretNames(req.params.id) });
  });

  app.post('/agents/:id/secrets', (req, res) => {
    const { id } = req.params;
    const { name, value } = req.body as { name?: string; value?: string };
    if (!name || !value) { res.status(400).json({ error: 'name and value required' }); return; }
    setSecret(id, name, value);
    restartAgent(req.params.id);
    res.status(201).json({ ok: true });
  });

  app.put('/agents/:id/secrets/:name', (req, res) => {
    const { id, name } = req.params;
    const { value } = req.body as { value?: string };
    if (!value) { res.status(400).json({ error: 'value required' }); return; }
    setSecret(id, name, value);
    restartAgent(req.params.id);
    res.json({ ok: true });
  });

  app.delete('/agents/:id/secrets/:name', (req, res) => {
    deleteSecret(req.params.id, req.params.name);
    restartAgent(req.params.id);
    res.json({ ok: true });
  });

  // ── Skills ──────────────────────────────────────────────────────────────

  app.get('/agents/:id/skills', (req, res) => {
    const managed = getManagedAgent(req.params.id);
    if (!managed) { res.status(404).json({ error: 'Agent not found' }); return; }
    const workspaceDir = path.resolve(REPO_ROOT, managed.config.workspaceDir);
    // pi runner bootstraps .agent/skills/; legacy workspaces used .claude/skills/
    const agentSkillsDir = path.join(workspaceDir, '.agent', 'skills');
    const skillsDir = fs.existsSync(agentSkillsDir)
      ? agentSkillsDir
      : path.join(workspaceDir, '.claude', 'skills');
    if (!fs.existsSync(skillsDir)) { res.json({ skills: [] }); return; }

    const skills: { name: string; description: string }[] = [];
    for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const skillMd = path.join(skillsDir, entry.name, 'SKILL.md');
      if (!fs.existsSync(skillMd)) continue;
      const content = fs.readFileSync(skillMd, 'utf8');
      const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
      if (!fmMatch) continue;
      const nameMatch = fmMatch[1].match(/^name:\s*(.+)/m);
      const descMatch = fmMatch[1].match(/^description:\s*(.+)/m);
      skills.push({
        name: nameMatch?.[1]?.trim() ?? entry.name,
        description: descMatch?.[1]?.trim() ?? '',
      });
    }
    res.json({ skills });
  });

  // ── Tasks ───────────────────────────────────────────────────────────────

  app.get('/agents/:id/tasks', (req, res) => {
    const managed = getManagedAgent(req.params.id);
    if (!managed) { res.status(404).json({ error: 'Agent not found' }); return; }
    const status = req.query.status as string | undefined;
    res.json(listTasks(req.params.id, status));
  });

  app.post('/agents/:id/tasks', (req, res) => {
    const managed = getManagedAgent(req.params.id);
    if (!managed) { res.status(404).json({ error: 'Agent not found' }); return; }
    const { title, description, status } = req.body as { title?: string; description?: string; status?: string };
    if (!title) { res.status(400).json({ error: 'title required' }); return; }
    const task = createTask(req.params.id, { title, description, status: status as any });
    res.status(201).json(task);
  });

  app.get('/agents/:id/tasks/:taskId', (req, res) => {
    const managed = getManagedAgent(req.params.id);
    if (!managed) { res.status(404).json({ error: 'Agent not found' }); return; }
    const task = getTask(req.params.id, req.params.taskId);
    if (!task) { res.status(404).json({ error: 'Task not found' }); return; }
    const comments = listComments(req.params.id, req.params.taskId);
    res.json({ ...task, comments });
  });

  app.put('/agents/:id/tasks/:taskId', (req, res) => {
    const managed = getManagedAgent(req.params.id);
    if (!managed) { res.status(404).json({ error: 'Agent not found' }); return; }
    const { title, description, status } = req.body as { title?: string; description?: string; status?: string };
    const task = updateTask(req.params.id, req.params.taskId, { title, description, status: status as any });
    if (!task) { res.status(404).json({ error: 'Task not found' }); return; }
    res.json(task);
  });

  app.delete('/agents/:id/tasks/:taskId', (req, res) => {
    const managed = getManagedAgent(req.params.id);
    if (!managed) { res.status(404).json({ error: 'Agent not found' }); return; }
    const deleted = deleteTask(req.params.id, req.params.taskId);
    if (!deleted) { res.status(404).json({ error: 'Task not found' }); return; }
    res.json({ ok: true });
  });

  app.get('/agents/:id/tasks/:taskId/comments', (req, res) => {
    const managed = getManagedAgent(req.params.id);
    if (!managed) { res.status(404).json({ error: 'Agent not found' }); return; }
    res.json(listComments(req.params.id, req.params.taskId));
  });

  app.post('/agents/:id/tasks/:taskId/comments', (req, res) => {
    const managed = getManagedAgent(req.params.id);
    if (!managed) { res.status(404).json({ error: 'Agent not found' }); return; }
    const { body } = req.body as { body?: string };
    if (!body) { res.status(400).json({ error: 'body required' }); return; }
    const comment = createComment(req.params.id, req.params.taskId, body);
    res.status(201).json(comment);
  });

  // ── Browser Sessions ────────────────────────────────────────────────────

  app.get('/agents/:id/browser-sessions', (req, res) => {
    const managed = getManagedAgent(req.params.id);
    if (!managed) { res.status(404).json({ error: 'Agent not found' }); return; }
    try {
      const sessions = listSessions(req.params.id);
      res.json(sessions.map((s) => ({
        id: s.id,
        name: s.name,
        status: s.status,
        createdAt: s.createdAt,
        closedAt: s.closedAt,
        screenshotCount: s.screenshotCount,
      })));
    } catch {
      res.json([]);
    }
  });

  app.get('/agents/:id/browser-sessions/:sessionId', (req, res) => {
    const managed = getManagedAgent(req.params.id);
    if (!managed) { res.status(404).json({ error: 'Agent not found' }); return; }
    const session = getBrowserSession(req.params.id, req.params.sessionId);
    if (!session) { res.status(404).json({ error: 'Session not found' }); return; }
    const screenshots = getSessionScreenshots(req.params.id, req.params.sessionId);
    res.json({ ...session, screenshots });
  });

  app.get('/agents/:id/browser-sessions/:sessionId/screenshots/:filename', (req, res) => {
    const managed = getManagedAgent(req.params.id);
    if (!managed) { res.status(404).json({ error: 'Agent not found' }); return; }
    const filePath = getScreenshotPath(req.params.id, req.params.sessionId, req.params.filename);
    if (!filePath) { res.status(404).json({ error: 'Screenshot not found' }); return; }
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    fs.createReadStream(filePath).pipe(res);
  });

  app.post('/agents/:id/browser-sessions/:sessionId/name', async (req, res) => {
    const managed = getManagedAgent(req.params.id);
    if (!managed) { res.status(404).json({ error: 'Agent not found' }); return; }
    try {
      const name = await generateSessionName(req.params.id, req.params.sessionId);
      res.json({ name });
    } catch {
      res.status(500).json({ error: 'Failed to generate name' });
    }
  });

  // ── Vault ───────────────────────────────────────────────────────────────

  app.get('/agents/:id/vault/export', (req, res) => {
    const managed = getManagedAgent(req.params.id);
    if (!managed) { res.status(404).json({ error: 'Agent not found' }); return; }
    const workspaceDir = path.resolve(REPO_ROOT, managed.config.workspaceDir);
    const vaultDir = path.join(workspaceDir, 'vault');
    if (!fs.existsSync(vaultDir)) { res.status(404).json({ error: 'Vault not found' }); return; }

    const date = new Date().toISOString().slice(0, 10);
    const filename = `vault-${req.params.id}-${date}.zip`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    const { execSync } = require('child_process');
    const zipPath = path.join(workspaceDir, '.vault-export.zip');
    try {
      execSync(`cd "${workspaceDir}" && zip -r "${zipPath}" vault/`, { stdio: 'ignore' });
      const stream = fs.createReadStream(zipPath);
      stream.pipe(res);
      stream.on('end', () => { try { fs.unlinkSync(zipPath); } catch {} });
    } catch {
      res.status(500).json({ error: 'Failed to create zip' });
    }
  });

  // ── Workflows ──────────────────────────────────────────────────────────

  app.get('/agents/:id/workflows', (req, res) => {
    const managed = getManagedAgent(req.params.id);
    if (!managed) { res.status(404).json({ error: 'Agent not found' }); return; }
    res.json(listWorkflows(req.params.id));
  });

  app.post('/agents/:id/workflows', (req, res) => {
    const managed = getManagedAgent(req.params.id);
    if (!managed) { res.status(404).json({ error: 'Agent not found' }); return; }
    const { name, description } = req.body as { name?: string; description?: string };
    if (!name) { res.status(400).json({ error: 'name required' }); return; }
    const workflow = createWorkflow(req.params.id, { name, description });
    res.status(201).json(workflow);
  });

  app.get('/agents/:id/workflows/:wfId', (req, res) => {
    const managed = getManagedAgent(req.params.id);
    if (!managed) { res.status(404).json({ error: 'Agent not found' }); return; }
    const workflow = getWorkflow(req.params.id, req.params.wfId);
    if (!workflow) { res.status(404).json({ error: 'Workflow not found' }); return; }
    res.json(workflow);
  });

  app.put('/agents/:id/workflows/:wfId', (req, res) => {
    const managed = getManagedAgent(req.params.id);
    if (!managed) { res.status(404).json({ error: 'Agent not found' }); return; }
    const { name, description, status } = req.body as { name?: string; description?: string; status?: string };
    const workflow = updateWorkflow(req.params.id, req.params.wfId, { name, description, status: status as any });
    if (!workflow) { res.status(404).json({ error: 'Workflow not found' }); return; }
    res.json(workflow);
  });

  app.delete('/agents/:id/workflows/:wfId', (req, res) => {
    const managed = getManagedAgent(req.params.id);
    if (!managed) { res.status(404).json({ error: 'Agent not found' }); return; }
    const deleted = deleteWorkflow(req.params.id, req.params.wfId);
    if (!deleted) { res.status(404).json({ error: 'Workflow not found' }); return; }
    res.json({ ok: true });
  });

  // ── Workflow Steps ─────────────────────────────────────────────────────

  app.post('/agents/:id/workflows/:wfId/steps', (req, res) => {
    const managed = getManagedAgent(req.params.id);
    if (!managed) { res.status(404).json({ error: 'Agent not found' }); return; }
    const { name, type, config, transitions, position } = req.body;
    if (!name || !type || !config) { res.status(400).json({ error: 'name, type, and config required' }); return; }
    const step = addStep(req.params.id, req.params.wfId, { name, type, config, transitions, position });
    res.status(201).json(step);
  });

  app.put('/agents/:id/workflows/:wfId/steps/:stepId', (req, res) => {
    const managed = getManagedAgent(req.params.id);
    if (!managed) { res.status(404).json({ error: 'Agent not found' }); return; }
    const { name, type, config, transitions, position } = req.body;
    const step = updateStep(req.params.id, req.params.stepId, { name, type, config, transitions, position });
    if (!step) { res.status(404).json({ error: 'Step not found' }); return; }
    res.json(step);
  });

  app.delete('/agents/:id/workflows/:wfId/steps/:stepId', (req, res) => {
    const managed = getManagedAgent(req.params.id);
    if (!managed) { res.status(404).json({ error: 'Agent not found' }); return; }
    const deleted = removeStep(req.params.id, req.params.stepId);
    if (!deleted) { res.status(404).json({ error: 'Step not found' }); return; }
    res.json({ ok: true });
  });

  // ── Workflow Runs ──────────────────────────────────────────────────────

  app.post('/agents/:id/workflows/:wfId/run', async (req, res) => {
    const managed = getManagedAgent(req.params.id);
    if (!managed) { res.status(404).json({ error: 'Agent not found' }); return; }
    try {
      const runId = await executeWorkflow(req.params.id, req.params.wfId, 'manual');
      res.status(201).json({ runId });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(400).json({ error: message });
    }
  });

  app.get('/agents/:id/workflows/:wfId/runs', (req, res) => {
    const managed = getManagedAgent(req.params.id);
    if (!managed) { res.status(404).json({ error: 'Agent not found' }); return; }
    res.json(listRuns(req.params.id, req.params.wfId));
  });

  app.get('/agents/:id/workflows/:wfId/runs/:runId', (req, res) => {
    const managed = getManagedAgent(req.params.id);
    if (!managed) { res.status(404).json({ error: 'Agent not found' }); return; }
    const run = getRun(req.params.id, req.params.runId);
    if (!run) { res.status(404).json({ error: 'Run not found' }); return; }
    res.json(run);
  });

  // ── Schedules ─────────────────────────────────────────────────────────────

  app.get('/agents/:id/schedules', (req, res) => {
    const managed = getManagedAgent(req.params.id);
    if (!managed) { res.status(404).json({ error: 'Agent not found' }); return; }
    res.json(listSchedules(req.params.id));
  });

  app.post('/agents/:id/schedules', (req, res) => {
    const managed = getManagedAgent(req.params.id);
    if (!managed) { res.status(404).json({ error: 'Agent not found' }); return; }
    const { name, message, cron, timezone } = req.body as { name?: string; message?: string; cron?: string; timezone?: string };
    if (!name || !message || !cron) { res.status(400).json({ error: 'name, message, and cron required' }); return; }

    let nextRun: number;
    try {
      const interval = parseExpression(cron, { tz: timezone ?? 'Asia/Singapore' });
      nextRun = interval.next().getTime();
    } catch (err) {
      res.status(400).json({ error: `Invalid cron expression: ${cron}` }); return;
    }

    const schedule = createSchedule(req.params.id, { name, message, cron, timezone, nextRun });
    res.status(201).json(schedule);
  });

  app.get('/agents/:id/schedules/:sid', (req, res) => {
    const managed = getManagedAgent(req.params.id);
    if (!managed) { res.status(404).json({ error: 'Agent not found' }); return; }
    const schedule = getSchedule(req.params.id, req.params.sid);
    if (!schedule) { res.status(404).json({ error: 'Schedule not found' }); return; }
    res.json(schedule);
  });

  app.put('/agents/:id/schedules/:sid', (req, res) => {
    const managed = getManagedAgent(req.params.id);
    if (!managed) { res.status(404).json({ error: 'Agent not found' }); return; }
    const { name, message, cron, timezone, status } = req.body as {
      name?: string; message?: string; cron?: string; timezone?: string; status?: string;
    };

    let nextRun: number | undefined;
    if (cron || timezone) {
      const existing = getSchedule(req.params.id, req.params.sid);
      if (!existing) { res.status(404).json({ error: 'Schedule not found' }); return; }
      const cronExpr = cron ?? existing.cron;
      const tz = timezone ?? existing.timezone;
      try {
        const interval = parseExpression(cronExpr, { tz });
        nextRun = interval.next().getTime();
      } catch {
        res.status(400).json({ error: `Invalid cron expression: ${cronExpr}` }); return;
      }
    }

    const schedule = updateScheduleDb(req.params.id, req.params.sid, {
      name, message, cron, timezone,
      status: status as 'active' | 'paused' | undefined,
      nextRun,
    });
    if (!schedule) { res.status(404).json({ error: 'Schedule not found' }); return; }
    res.json(schedule);
  });

  app.delete('/agents/:id/schedules/:sid', (req, res) => {
    const managed = getManagedAgent(req.params.id);
    if (!managed) { res.status(404).json({ error: 'Agent not found' }); return; }
    const deleted = deleteSchedule(req.params.id, req.params.sid);
    if (!deleted) { res.status(404).json({ error: 'Schedule not found' }); return; }
    res.json({ ok: true });
  });

  app.post('/agents/:id/schedules/:sid/trigger', (req, res) => {
    const managed = getManagedAgent(req.params.id);
    if (!managed) { res.status(404).json({ error: 'Agent not found' }); return; }
    const schedule = getSchedule(req.params.id, req.params.sid);
    if (!schedule) { res.status(404).json({ error: 'Schedule not found' }); return; }

    const workspaceDir = path.resolve(REPO_ROOT, managed.config.workspaceDir);
    enqueue(workspaceDir, req.params.id, schedule.message, 'schedule');

    let nextRun: number | undefined;
    try {
      const interval = parseExpression(schedule.cron, { tz: schedule.timezone });
      nextRun = interval.next().getTime();
    } catch { /* keep existing nextRun */ }

    updateScheduleDb(req.params.id, req.params.sid, { lastRun: Date.now(), nextRun });
    res.status(201).json({ ok: true });
  });

  // ── Browser Auth States ───────────────────────────────────────────────

  app.post('/agents/:id/browser-launch', async (req, res) => {
    const managed = getManagedAgent(req.params.id);
    if (!managed) { res.status(404).json({ error: 'Agent not found' }); return; }
    if (headedBrowsers.has(req.params.id)) {
      res.status(409).json({ error: 'Browser already open for this agent' }); return;
    }

    const { url } = req.body as { url?: string };
    if (!url) { res.status(400).json({ error: 'url required' }); return; }

    const workspaceDir = path.resolve(REPO_ROOT, managed.config.workspaceDir);
    const profileDir = path.join(workspaceDir, '.browser-profile');

    // Use persistent Chrome profile — keeps cookies, IndexedDB, localStorage, everything
    try {
      const { execSync } = await import('child_process');
      execSync(`agent-browser --headed --profile "${profileDir}" open "${url}"`, {
        cwd: workspaceDir,
        timeout: 30000,
        stdio: 'pipe',
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: `Failed to launch browser: ${message}` }); return;
    }

    headedBrowsers.set(req.params.id, { url });
    console.log(`[browser] launched headed browser for "${req.params.id}" with profile → ${url}`);
    res.status(201).json({ url, profileDir });
  });

  app.post('/agents/:id/browser-close', async (req, res) => {
    const managed = getManagedAgent(req.params.id);
    if (!managed) { res.status(404).json({ error: 'Agent not found' }); return; }

    if (!headedBrowsers.has(req.params.id)) {
      res.status(404).json({ error: 'No browser open' }); return;
    }

    try {
      const { execSync } = await import('child_process');
      execSync(`agent-browser close`, {
        cwd: path.resolve(REPO_ROOT, managed.config.workspaceDir),
        timeout: 10000,
        stdio: 'pipe',
      });
    } catch { /* browser might already be closed */ }

    headedBrowsers.delete(req.params.id);
    console.log(`[browser] closed browser for "${req.params.id}" — profile saved automatically`);
    res.json({ ok: true });
  });

  app.get('/agents/:id/browser-profile', (req, res) => {
    const managed = getManagedAgent(req.params.id);
    if (!managed) { res.status(404).json({ error: 'Agent not found' }); return; }

    const workspaceDir = path.resolve(REPO_ROOT, managed.config.workspaceDir);
    const profileDir = path.join(workspaceDir, '.browser-profile');
    const exists = fs.existsSync(profileDir);

    const active = headedBrowsers.get(req.params.id);
    res.json({
      hasProfile: exists,
      activeBrowser: active ? { url: active.url } : null,
    });
  });

  app.delete('/agents/:id/browser-profile', (req, res) => {
    const managed = getManagedAgent(req.params.id);
    if (!managed) { res.status(404).json({ error: 'Agent not found' }); return; }

    const workspaceDir = path.resolve(REPO_ROOT, managed.config.workspaceDir);
    const profileDir = path.join(workspaceDir, '.browser-profile');
    if (!fs.existsSync(profileDir)) { res.status(404).json({ error: 'No profile' }); return; }

    fs.rmSync(profileDir, { recursive: true, force: true });
    res.json({ ok: true });
  });

  // ── Monitor ────────────────────────────────────────────────────────────────

  app.get('/agents/:id/monitor', async (req, res) => {
    const managed = getManagedAgent(req.params.id);
    if (!managed) { res.status(404).json({ error: 'Agent not found' }); return; }

    const workspaceDir = path.resolve(REPO_ROOT, managed.config.workspaceDir);
    const jobs = getActiveJobs(workspaceDir, req.params.id);
    const runningWorkflows = getRunningRuns(req.params.id);

    // Get real process info (CPU, memory, uptime) for agent and child processes
    const { execSync } = await import('child_process');
    function getProcessInfo(pid: number | undefined | null): { pid: number; cpu: string; mem: string; rss: string; elapsed: string; command: string } | null {
      if (!pid) return null;
      try {
        const out = execSync(`ps -o pid=,pcpu=,pmem=,rss=,etime=,command= -p ${pid}`, { timeout: 3000, stdio: 'pipe' }).toString().trim();
        if (!out) return null;
        const parts = out.match(/^\s*(\d+)\s+([\d.]+)\s+([\d.]+)\s+(\d+)\s+([\d:-]+)\s+(.+)$/);
        if (!parts) return null;
        return { pid: Number(parts[1]), cpu: parts[2] + '%', mem: parts[3] + '%', rss: (Number(parts[4]) / 1024).toFixed(0) + 'MB', elapsed: parts[5].trim(), command: parts[6].slice(0, 120) };
      } catch { return null; }
    }

    // Find Claude child processes spawned by the agent
    let claudeProcesses: { pid: number; cpu: string; mem: string; rss: string; elapsed: string; command: string }[] = [];
    try {
      const psOut = execSync(`ps -o pid=,ppid=,pcpu=,pmem=,rss=,etime=,command= -e`, { timeout: 5000, stdio: 'pipe' }).toString();
      const agentPid = managed.pid;
      claudeProcesses = psOut.split('\n').filter(line => {
        const m = line.match(/^\s*(\d+)\s+(\d+)/);
        return m && Number(m[2]) === agentPid && line.includes('claude');
      }).map(line => {
        const m = line.match(/^\s*(\d+)\s+\d+\s+([\d.]+)\s+([\d.]+)\s+(\d+)\s+([\d:-]+)\s+(.+)$/);
        if (!m) return null;
        return { pid: Number(m[1]), cpu: m[2] + '%', mem: m[3] + '%', rss: (Number(m[4]) / 1024).toFixed(0) + 'MB', elapsed: m[5].trim(), command: m[6].slice(0, 120) };
      }).filter(Boolean) as typeof claudeProcesses;
    } catch { /* ignore */ }

    // Check browser daemon
    let browserProcess: { pid: number; cpu: string; mem: string; rss: string } | null = null;
    try {
      const psOut = execSync(`pgrep -f "agent-browser-darwin"`, { timeout: 2000, stdio: 'pipe' }).toString().trim();
      if (psOut) {
        const bPid = Number(psOut.split('\n')[0]);
        const info = getProcessInfo(bPid);
        if (info) browserProcess = { pid: info.pid, cpu: info.cpu, mem: info.mem, rss: info.rss };
      }
    } catch { /* no browser running */ }

    res.json({
      agent: {
        ...getProcessInfo(managed.pid),
        role: 'agent',
        wsPort: managed.wsPort,
      },
      guardian: null,
      claudeProcesses,
      browserProcess,
      jobs: {
        processing: jobs.filter(j => j.status === 'processing'),
        pending: jobs.filter(j => j.status === 'pending'),
      },
      workflows: runningWorkflows,
      headedBrowser: headedBrowsers.get(req.params.id) ?? null,
    });
  });

  // ── Usage ──────────────────────────────────────────────────────────────────

  app.get('/agents/:id/usage', async (req, res) => {
    const managed = getManagedAgent(req.params.id);
    if (!managed) { res.status(404).json({ error: 'Agent not found' }); return; }
    const days = Number(req.query.days ?? 30);
    const usage = await scanUsage(req.params.id, days);
    res.json(usage);
  });

  app.delete('/agents/:id/monitor/jobs/:jobId', (req, res) => {
    const managed = getManagedAgent(req.params.id);
    if (!managed) { res.status(404).json({ error: 'Agent not found' }); return; }
    const workspaceDir = path.resolve(REPO_ROOT, managed.config.workspaceDir);
    markFailed(workspaceDir, req.params.jobId);
    res.json({ ok: true });
  });

  // ── Logs ───────────────────────────────────────────────────────────────────

  app.use('/logs', logsRouter);

  // ── Static frontend (production / Docker) ─────────────────────────────────
  // In dev the frontend is served by vite on :5173 and proxies REST/WS here.
  // In prod / Docker the frontend is built once into packages/frontend/dist
  // and we serve it from this same port so the whole app ships as a single
  // service on a single port. This block is a no-op in dev because dist
  // does not exist.
  // In published mode, the CLI entrypoint sets GRANCLAW_STATIC_DIR to the
  // bundled frontend dir inside the package. In dev / Docker, fall back to
  // the existing in-repo path.
  const staticDirEnv = process.env.GRANCLAW_STATIC_DIR?.trim();
  const frontendDist = staticDirEnv
    ? path.resolve(staticDirEnv)
    : path.resolve(REPO_ROOT, 'packages/frontend/dist');
  if (fs.existsSync(frontendDist)) {
    console.log(`[orchestrator] serving built frontend from ${frontendDist}`);
    app.use(express.static(frontendDist));
    // SPA fallback: anything that wasn't matched by a REST route above and
    // asks for HTML gets index.html so client-side routing takes over. API
    // clients that send Accept: application/json fall through to 404.
    app.get(/.*/, (req, res, next) => {
      if (req.accepts('html')) {
        res.sendFile(path.join(frontendDist, 'index.html'));
      } else {
        next();
      }
    });
  }

  // ── WebSocket proxy to internal agent processes ───────────────────────────
  // The browser speaks ws:// to /ws/agents/:id on this server. We open an
  // internal ws:// connection to the agent's private port (3100+index) and
  // pipe messages in both directions. This keeps agent ports internal to
  // the host/container and means only this server's port needs to be
  // exposed externally.
  const httpServer = http.createServer(app);
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://internal');
    const match = url.pathname.match(/^\/ws\/agents\/([^/]+)$/);
    if (!match) {
      socket.destroy();
      return;
    }
    const agentId = decodeURIComponent(match[1]);
    const managed = getManagedAgent(agentId);
    if (!managed) {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, async (clientWs) => {
      const upstreamUrl = `ws://127.0.0.1:${managed.wsPort}`;
      type Queued = { data: Buffer | string; isBinary: boolean };
      const clientQueue: Queued[] = [];
      let clientClosed = false;

      // Buffer client messages until upstream is ready
      clientWs.on('message', (data, isBinary) => {
        clientQueue.push({ data: data as Buffer, isBinary });
      });
      clientWs.on('close', () => { clientClosed = true; });
      clientWs.on('error', () => { clientClosed = true; });

      // Retry upstream connection — agent process may not be listening yet
      // (startup race: orchestrator spawns the process, it takes ~100-500 ms to bind)
      let upstream: WebSocket | null = null;
      const maxAttempts = 20;
      const retryDelayMs = 300;

      for (let attempt = 0; attempt < maxAttempts && !clientClosed; attempt++) {
        const ws = new WebSocket(upstreamUrl);
        const connected = await new Promise<boolean>((resolve) => {
          ws.once('open', () => resolve(true));
          ws.once('error', () => resolve(false));
        });
        if (connected) { upstream = ws; break; }
        ws.terminate();
        if (attempt < maxAttempts - 1 && !clientClosed) {
          await new Promise(r => setTimeout(r, retryDelayMs));
        }
      }

      if (!upstream || clientClosed) {
        console.warn(`[ws-proxy] could not reach ${agentId} after ${maxAttempts} attempts`);
        try { clientWs.close(); } catch { /* ignore */ }
        upstream?.terminate();
        return;
      }

      const closeBoth = () => {
        try { clientWs.close(); } catch { /* ignore */ }
        try { upstream!.close(); } catch { /* ignore */ }
      };

      // Flush buffered client messages
      for (const q of clientQueue) upstream.send(q.data, { binary: q.isBinary });
      clientQueue.length = 0;

      // Preserve the frame type (text vs binary) both ways. The agent
      // emits JSON as text frames; forwarding them as binary would give
      // the browser a Blob, which JSON.parse swallows silently and the
      // UI never sees the response.
      upstream.on('message', (data, isBinary) => {
        if (clientWs.readyState === WebSocket.OPEN) {
          clientWs.send(data, { binary: isBinary });
        }
      });
      upstream.on('close', closeBoth);
      upstream.on('error', (err) => {
        console.warn(`[ws-proxy] upstream error for ${agentId}:`, err.message);
        closeBoth();
      });

      // Replace buffering listener with live forwarding
      clientWs.removeAllListeners('message');
      clientWs.on('message', (data, isBinary) => {
        if (upstream!.readyState === WebSocket.OPEN) upstream!.send(data as Buffer, { binary: isBinary });
      });
      clientWs.removeAllListeners('close');
      clientWs.removeAllListeners('error');
      clientWs.on('close', closeBoth);
      clientWs.on('error', closeBoth);
    });
  });

  return httpServer;
}
