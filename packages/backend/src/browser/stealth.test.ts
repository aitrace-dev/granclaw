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

  it('ships a stealth.js that patches UA, deviceMemory, and userAgentData', () => {
    const js = fs.readFileSync(path.join(STEALTH_EXTENSION_DIR as string, 'stealth.js'), 'utf8');
    expect(js).toMatch(/HeadlessChrome/);      // UA strip — must reference the token it removes
    expect(js).toMatch(/deviceMemory/);         // deviceMemory spoofing
    expect(js).toMatch(/userAgentData/);        // Client Hints brands cleanup
  });
});

describe('stealthArgv — flag composition', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    __resetStealthCacheForTests();
    delete process.env.GRANCLAW_STEALTH_DISABLED;
    delete process.env.GRANCLAW_CHROME_PATH;
    delete process.env.AGENT_BROWSER_CHROME_PATH;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    __resetStealthCacheForTests();
  });

  it('loads the stealth extension via the repeatable --extension flag', () => {
    // Regression: agent-browser --args is NOT repeatable — only the LAST --args
    // value survives. Passing --args --load-extension=<dir> silently drops the
    // stealth extension when any later --args exists, leaving navigator.webdriver
    // detectable in production (the bug this test guards against).
    const argv = stealthArgv();
    const extIdx = argv.indexOf('--extension');
    expect(extIdx).toBeGreaterThanOrEqual(0);
    expect(argv[extIdx + 1]).toBe(STEALTH_EXTENSION_DIR);
  });

  it('uses at most ONE --args flag so no chromium flags are silently dropped', () => {
    // agent-browser only applies the LAST --args value. Emitting multiple --args
    // flags means every flag except the last is silently dropped by agent-browser
    // before Chrome ever sees it.
    const argv = stealthArgv();
    const argsCount = argv.filter((x) => x === '--args').length;
    expect(argsCount).toBeLessThanOrEqual(1);
  });

  it('includes --disable-blink-features=AutomationControlled in the combined --args', () => {
    // This is the flag Chrome reads to decide whether to set navigator.webdriver=true.
    // If it does not reach Chrome, the stealth extension is our only line of defence
    // and several other automation markers stay exposed.
    const argv = stealthArgv();
    const argsIdx = argv.indexOf('--args');
    expect(argsIdx).toBeGreaterThanOrEqual(0);
    expect(argv[argsIdx + 1]).toContain('--disable-blink-features=AutomationControlled');
  });

  it('adds --headless=new to the combined --args by default', () => {
    // agent-browser does NOT auto-add --headless=new when --extension is present,
    // so without this the daemon tries to launch headed Chrome and errors out
    // with "Missing X server or $DISPLAY" inside the container.
    const argv = stealthArgv();
    const argsIdx = argv.indexOf('--args');
    expect(argsIdx).toBeGreaterThanOrEqual(0);
    expect(argv[argsIdx + 1]).toContain('--headless=new');
  });

  it('omits --headless=new when headless: false (for --headed previews)', () => {
    const argv = stealthArgv({ headless: false });
    const argsIdx = argv.indexOf('--args');
    if (argsIdx >= 0) {
      expect(argv[argsIdx + 1]).not.toContain('--headless=new');
    }
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
    // Values can legitimately start with '--' (e.g. the --args value is a
    // comma-joined list of chromium switches like "--disable-blink-features=…"),
    // so only check that each flag is followed by a defined non-flag token.
    expect(argv.length % 2).toBe(0);
    for (let i = 0; i < argv.length; i += 2) {
      expect(argv[i]).toMatch(/^--/);
      expect(argv[i + 1]).toBeDefined();
    }
  });
});
