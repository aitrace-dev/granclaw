import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { resolveTemplatesDir } from './runner-pi.js';

describe('resolveTemplatesDir', () => {
  const ORIGINAL_ENV = { ...process.env };

  // Temp dir shared across tests that need one (created per-test, cleaned up after)
  let tmp: string | undefined;

  beforeEach(() => {
    delete process.env.GRANCLAW_TEMPLATES_DIR;
    delete process.env.GRANCLAW_HOME;
    tmp = undefined;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    if (tmp) {
      fs.rmSync(tmp, { recursive: true, force: true });
      tmp = undefined;
    }
  });

  it('uses GRANCLAW_TEMPLATES_DIR when set', () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-tpl-'));
    process.env.GRANCLAW_TEMPLATES_DIR = tmp;
    expect(resolveTemplatesDir()).toBe(tmp);
  });

  it('fallback equals <REPO_ROOT>/packages/cli/templates when env unset', async () => {
    // REPO_ROOT is a module-level snapshot of GRANCLAW_HOME in config.ts,
    // so we compare against the same load-time snapshot here.
    // A full cache-busted test of the fallback requires re-importing runner.js
    // itself (not just config.js), because runner.ts closes over REPO_ROOT at
    // module load — see the next test for that coverage.
    const { GRANCLAW_HOME } = await import('../config.js');
    expect(resolveTemplatesDir()).toBe(path.join(GRANCLAW_HOME, 'packages/cli/templates'));
  });

  it('fallback is stable once process starts (REPO_ROOT is a load-time snapshot)', async () => {
    // Changing GRANCLAW_HOME after runner.ts is loaded does NOT change the fallback,
    // because REPO_ROOT is captured once at module load via config.js's static init.
    // A fresh cache-busted import of runner.js still gets the cached config.js
    // (no query suffix), so REPO_ROOT remains the same snapshot value.
    // This test documents and verifies that stable-fallback behaviour.
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-runnerfallback-'));
    process.env.GRANCLAW_HOME = tmp;
    const { GRANCLAW_HOME: originalHome } = await import('../config.js');
    // Cache-bust runner to get a fresh module instance; config.js is still cached.
    const freshRunner = await import('./runner-pi.js?runnerfallback');
    // The fallback must equal the load-time snapshot, not the newly set env.
    expect(freshRunner.resolveTemplatesDir()).toBe(path.join(originalHome, 'packages/cli/templates'));
  });
});
