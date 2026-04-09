import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { resolveTemplatesDir } from './runner.js';

describe('resolveTemplatesDir', () => {
  const ORIGINAL_ENV = { ...process.env };

  // Temp dir shared across tests that need one (created per-test, cleaned up after)
  let tmp: string | undefined;

  beforeEach(() => {
    delete process.env.GRANCLAW_TEMPLATES_DIR;
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

  it('falls back to <GRANCLAW_HOME>/templates when env is unset', async () => {
    const { GRANCLAW_HOME } = await import('../config.js');
    expect(resolveTemplatesDir()).toBe(path.join(GRANCLAW_HOME, 'templates'));
  });
});
