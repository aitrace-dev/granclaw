/**
 * Agent Bootstrap Test
 *
 * Verifies that POST /agents calls bootstrapWorkspace() immediately,
 * setting up all required files and the default "Vault housekeeping"
 * schedule before the agent ever receives a message.
 *
 * Bootstrap creates on registration:
 *   AGENT.md            — onboarding instructions
 *   .mcp.json           — empty MCP config (prevents inheriting host servers)
 *   .pi-sessions/       — pi JSONL session storage
 *   vault/{journal,sessions,actions,topics,knowledge}/
 *   .pi/skills/{agent-browser,schedules,task-board,vault,web-search,workflows}/
 *   .pi/extensions/     — pi built-in extensions (web-search.ts, etc.)
 *   DB: "Vault housekeeping" schedule (cron 30 23 * * *)
 */

import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { teardownAgent } from './helpers/agent.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REPO_ROOT = path.resolve(__dirname, '../../../');
const AGENT_ID = 'test-bootstrap-e2e';
const API = 'http://localhost:3001';
const WORKSPACE_DIR = path.resolve(REPO_ROOT, '.test', 'workspaces', AGENT_ID);

test.describe('Agent Bootstrap', () => {
  test.beforeAll(async () => {
    // Start from a clean workspace so bootstrap runs from scratch
    if (fs.existsSync(WORKSPACE_DIR)) fs.rmSync(WORKSPACE_DIR, { recursive: true });
    fs.mkdirSync(WORKSPACE_DIR, { recursive: true });

    // Remove any leftover registration
    await fetch(`${API}/agents/${AGENT_ID}`, { method: 'DELETE' }).catch(() => {});

    // Use the same model the server has configured
    let model: string | undefined;
    try {
      const s = await fetch(`${API}/settings/provider`);
      if (s.ok) { const cfg = await s.json() as { model?: string }; model = cfg.model; }
    } catch { /* fall back to server default */ }

    // POST /agents calls bootstrapWorkspace() synchronously before returning.
    // No message needs to be sent — all files and the schedule are ready immediately.
    const res = await fetch(`${API}/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: AGENT_ID,
        name: AGENT_ID,
        model,
        workspaceDir: `.test/workspaces/${AGENT_ID}`,
      }),
    });
    if (!res.ok) throw new Error(`Failed to register agent: ${await res.text()}`);
  });

  test.afterAll(async () => {
    await teardownAgent(AGENT_ID);
  });

  test('workspace contains AGENT.md and core config files', () => {
    expect(fs.existsSync(path.join(WORKSPACE_DIR, 'AGENT.md')), 'AGENT.md').toBe(true);
    expect(fs.existsSync(path.join(WORKSPACE_DIR, '.mcp.json')), '.mcp.json').toBe(true);
    expect(fs.existsSync(path.join(WORKSPACE_DIR, '.pi-sessions')), '.pi-sessions/').toBe(true);
  });

  test('vault directory has all required subdirectories', () => {
    for (const sub of ['journal', 'sessions', 'actions', 'topics', 'knowledge']) {
      expect(
        fs.existsSync(path.join(WORKSPACE_DIR, 'vault', sub)),
        `vault/${sub}/`
      ).toBe(true);
    }
  });

  test('all skills are bootstrapped into .pi/skills/', () => {
    const skillsDir = path.join(WORKSPACE_DIR, '.pi', 'skills');
    expect(fs.existsSync(skillsDir), '.pi/skills/').toBe(true);

    const expected = ['agent-browser', 'schedules', 'task-board', 'vault', 'web-search', 'workflows'];
    const present = fs.readdirSync(skillsDir);
    for (const skill of expected) {
      expect(present, `skill "${skill}"`).toContain(skill);
      expect(
        fs.existsSync(path.join(skillsDir, skill, 'SKILL.md')),
        `.pi/skills/${skill}/SKILL.md`
      ).toBe(true);
    }
  });

  test('pi extensions are bootstrapped into .pi/extensions/', () => {
    const extDir = path.join(WORKSPACE_DIR, '.pi', 'extensions');
    expect(fs.existsSync(extDir), '.pi/extensions/').toBe(true);
    expect(fs.readdirSync(extDir).length, 'at least one extension file').toBeGreaterThan(0);
  });

  test('default vault housekeeping schedule is created in the DB', async () => {
    const res = await fetch(`${API}/agents/${AGENT_ID}/schedules`);
    const schedules = await res.json() as Array<{
      name: string;
      cron: string;
      status: string;
      timezone: string;
    }>;

    const vault = schedules.find((s) => s.name === 'Vault housekeeping');
    expect(vault, 'Vault housekeeping schedule').toBeTruthy();
    expect(vault?.status).toBe('active');
    expect(vault?.cron).toBe('30 23 * * *');
    expect(vault?.timezone).toBe('Asia/Singapore');
  });
});
