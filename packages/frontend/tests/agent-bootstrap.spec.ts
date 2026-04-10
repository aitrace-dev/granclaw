/**
 * Agent Bootstrap Test
 *
 * Verifies that when an agent is created and receives its first message,
 * bootstrapWorkspace() sets up all required files and creates the default
 * "Vault housekeeping" schedule in the DB.
 *
 * Bootstrap creates:
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

const wsConnected = (page: import('@playwright/test').Page) =>
  page.locator('[title="WS connected"]');

test.describe('Agent Bootstrap', () => {
  test.beforeAll(async ({ browser }) => {
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

    // Register agent with the empty workspace
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

    // bootstrapWorkspace() runs at the start of runAgent(), before any LLM call.
    // Send a message via the chat UI to trigger it.
    const page = await browser.newPage();
    await page.goto(`http://localhost:5173/agents/${AGENT_ID}/chat`);
    await expect(wsConnected(page)).toBeVisible({ timeout: 10_000 });

    await page.getByPlaceholder(/message/i).fill('hi');
    await page.getByPlaceholder(/message/i).press('Enter');

    // Wait until the agent starts processing — bootstrap is synchronous and
    // completes before the LLM is ever called, so it's done by this point.
    await expect(page.locator('div.animate-pulse').first()).toBeVisible({ timeout: 20_000 });

    await page.close();
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
