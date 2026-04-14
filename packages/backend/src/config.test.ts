import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

describe('resolveGranclawHome', () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    delete process.env.GRANCLAW_HOME;
    delete process.env.CONFIG_PATH;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('uses GRANCLAW_HOME env var when set', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'granclaw-test-'));
    process.env.GRANCLAW_HOME = tmp;
    // Dynamic import so the module re-evaluates with the env var
    const mod = await import('./config.js?home1');
    expect(mod.GRANCLAW_HOME).toBe(tmp);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('falls back to ~/.granclaw when GRANCLAW_HOME is unset', async () => {
    const mod = await import('./config.js?home2');
    expect(mod.GRANCLAW_HOME).toBe(path.join(os.homedir(), '.granclaw'));
  });

  it('exposes REPO_ROOT as an alias of GRANCLAW_HOME for legacy consumers', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'granclaw-test-'));
    process.env.GRANCLAW_HOME = tmp;
    const mod = await import('./config.js?home3');
    expect(mod.REPO_ROOT).toBe(mod.GRANCLAW_HOME);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('reads agents.config.json from GRANCLAW_HOME', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'granclaw-test-'));
    fs.writeFileSync(
      path.join(tmp, 'agents.config.json'),
      JSON.stringify({ agents: [{ id: 'x', name: 'x', model: 'claude-sonnet-4-5', workspaceDir: './workspaces/x', allowedTools: [] }] }),
    );
    process.env.GRANCLAW_HOME = tmp;
    const mod = await import('./config.js?home4');
    expect(mod.getAgents()).toHaveLength(1);
    expect(mod.getAgents()[0].id).toBe('x');
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
