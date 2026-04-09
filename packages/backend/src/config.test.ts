import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

describe('resolveGranclawHome', () => {
  const ORIGINAL_ENV = { ...process.env };

  // Temp dir shared across tests that need one (created per-test, cleaned up after)
  let tmp: string | undefined;

  beforeEach(() => {
    delete process.env.GRANCLAW_HOME;
    delete process.env.CONFIG_PATH;
    tmp = undefined;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    if (tmp) {
      fs.rmSync(tmp, { recursive: true, force: true });
      tmp = undefined;
    }
  });

  it('uses GRANCLAW_HOME env var when set', async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'granclaw-test-'));
    process.env.GRANCLAW_HOME = tmp;
    // Dynamic import so the module re-evaluates with the env var
    const mod = await import('./config.js?home1');
    expect(mod.GRANCLAW_HOME).toBe(tmp);
  });

  it('falls back to ~/.granclaw when GRANCLAW_HOME is unset', async () => {
    const mod = await import('./config.js?home2');
    expect(mod.GRANCLAW_HOME).toBe(path.join(os.homedir(), '.granclaw'));
  });

  it('exposes REPO_ROOT as an alias of GRANCLAW_HOME for legacy consumers', async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'granclaw-test-'));
    process.env.GRANCLAW_HOME = tmp;
    const mod = await import('./config.js?home3');
    expect(mod.REPO_ROOT).toBe(mod.GRANCLAW_HOME);
  });

  it('reads agents.config.json from GRANCLAW_HOME', async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'granclaw-test-'));
    fs.writeFileSync(
      path.join(tmp, 'agents.config.json'),
      JSON.stringify({ agents: [{ id: 'x', name: 'x', model: 'claude-sonnet-4-5', workspaceDir: './workspaces/x', allowedTools: [] }] }),
    );
    process.env.GRANCLAW_HOME = tmp;
    const mod = await import('./config.js?home4');
    expect(mod.getAgents()).toHaveLength(1);
    expect(mod.getAgents()[0].id).toBe('x');
  });

  it('honors CONFIG_PATH env var, overriding the GRANCLAW_HOME-derived default', async () => {
    // altDir holds agents.config.json at a non-standard path
    const altDir = fs.mkdtempSync(path.join(os.tmpdir(), 'granclaw-altcfg-'));
    const altConfigPath = path.join(altDir, 'custom-agents.json');
    fs.writeFileSync(
      altConfigPath,
      JSON.stringify({
        agents: [{ id: 'alt', name: 'alt', model: 'claude-sonnet-4-5', workspaceDir: './workspaces/alt', allowedTools: [] }],
      }),
    );

    // otherHome does NOT contain agents.config.json — ensures CONFIG_PATH wins
    const otherHome = fs.mkdtempSync(path.join(os.tmpdir(), 'granclaw-home-'));
    process.env.GRANCLAW_HOME = otherHome;
    process.env.CONFIG_PATH = altConfigPath;

    try {
      const mod = await import('./config.js?cfgpath');
      expect(mod.getAgents()).toHaveLength(1);
      expect(mod.getAgents()[0].id).toBe('alt');
    } finally {
      fs.rmSync(altDir, { recursive: true, force: true });
      fs.rmSync(otherHome, { recursive: true, force: true });
    }
  });

  it('falls back to ~/.granclaw when GRANCLAW_HOME is whitespace-only', async () => {
    process.env.GRANCLAW_HOME = '   ';
    const mod = await import('./config.js?home5');
    expect(mod.GRANCLAW_HOME).toBe(path.join(os.homedir(), '.granclaw'));
  });
});
