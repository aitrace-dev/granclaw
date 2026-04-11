/**
 * stealth.test.ts — unit coverage for the launch-flag builder.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';

import { stealthArgv, STEALTH_EXTENSION_DIR, __resetStealthCacheForTests } from './stealth.js';

describe('stealthArgv — packaged stealth extension', () => {
  it('resolves to an on-disk directory with a real manifest', () => {
    expect(STEALTH_EXTENSION_DIR).not.toBeNull();
    expect(STEALTH_EXTENSION_DIR).toBeTypeOf('string');
    const manifestPath = path.join(STEALTH_EXTENSION_DIR as string, 'manifest.json');
    expect(fs.existsSync(manifestPath)).toBe(true);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.content_scripts[0].run_at).toBe('document_start');
    expect(manifest.content_scripts[0].world).toBe('MAIN');
  });

  it('ships a stealth.js that patches navigator.webdriver', () => {
    const js = fs.readFileSync(path.join(STEALTH_EXTENSION_DIR as string, 'stealth.js'), 'utf8');
    // The whole point — if this regression test fails, the page will see
    // navigator.webdriver === true and every detector will flag us.
    expect(js).toMatch(/navigator.*webdriver/);
    expect(js).toMatch(/navigator.*languages/);
    expect(js).toMatch(/navigator.*plugins/);
    expect(js).toMatch(/chrome\.runtime/);
    expect(js).toMatch(/WebGLRenderingContext/);
  });
});

describe('stealthArgv — flag composition', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    __resetStealthCacheForTests();
    delete process.env.GRANCLAW_STEALTH_DISABLED;
    delete process.env.GRANCLAW_CHROME_PATH;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    __resetStealthCacheForTests();
  });

  it('returns --extension <path> when the extension is present', () => {
    const argv = stealthArgv();
    const extIdx = argv.indexOf('--extension');
    expect(extIdx).toBeGreaterThanOrEqual(0);
    expect(argv[extIdx + 1]).toBe(STEALTH_EXTENSION_DIR);
  });

  it('honours GRANCLAW_CHROME_PATH when the override points at a real file', () => {
    // Use the current node binary as a guaranteed-to-exist file — we only
    // care that the helper picks it up and emits --executable-path.
    process.env.GRANCLAW_CHROME_PATH = process.execPath;
    __resetStealthCacheForTests();

    const argv = stealthArgv();
    const execIdx = argv.indexOf('--executable-path');
    expect(execIdx).toBeGreaterThanOrEqual(0);
    expect(argv[execIdx + 1]).toBe(process.execPath);
  });

  it('ignores a GRANCLAW_CHROME_PATH that does not exist on disk', () => {
    process.env.GRANCLAW_CHROME_PATH = '/no/such/chrome';
    __resetStealthCacheForTests();

    const argv = stealthArgv();
    // Depending on host, a real Chrome may still be detected — but the
    // invalid override must never leak through.
    expect(argv).not.toContain('/no/such/chrome');
  });

  it('returns an empty argv when GRANCLAW_STEALTH_DISABLED=1', () => {
    process.env.GRANCLAW_STEALTH_DISABLED = '1';
    expect(stealthArgv()).toEqual([]);
  });

  it('emits flags in pairs so spreading into argv keeps them adjacent', () => {
    process.env.GRANCLAW_CHROME_PATH = process.execPath;
    __resetStealthCacheForTests();

    const argv = stealthArgv();
    // Every flag should be followed by its value — no stray tokens.
    expect(argv.length % 2).toBe(0);
    for (let i = 0; i < argv.length; i += 2) {
      expect(argv[i]).toMatch(/^--/);
      expect(argv[i + 1]).not.toMatch(/^--/);
    }
  });
});
