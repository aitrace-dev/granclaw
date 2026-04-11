import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';

/**
 * Integration tests for the browser session lifecycle.
 *
 * These exercise both:
 *   - meta-helper.js + browser-wrapper.sh (the agent-facing layer)
 *   - listSessions / getSession / getVideoPath / forceCloseActiveSession
 *     (the backend reconciliation layer)
 *
 * The wrapper calls the real agent-browser binary for its guard tests (record
 * blocked) but never spawns a browser — we never issue a navigation command.
 * No network, no Chromium — tests run in < 2 seconds.
 */

const REPO_ROOT = path.resolve(__dirname, '../../..');
const WRAPPER = path.join(REPO_ROOT, 'packages/cli/templates/skills/agent-browser/browser-wrapper.sh');
const META_HELPER = path.join(REPO_ROOT, 'packages/cli/templates/skills/agent-browser/meta-helper.js');
const FIFTEEN_MIN_MS = 15 * 60 * 1000;

function fakeMeta(dir: string, overrides: Record<string, unknown> = {}) {
  const now = Date.now();
  const meta = {
    id: path.basename(dir),
    name: null,
    status: 'active',
    createdAt: now,
    closedAt: null,
    heartbeat: now,
    video: 'recording.webm',
    commands: [],
    ...overrides,
  };
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2));
  return meta;
}

function writeWebm(dir: string, filename = 'recording.webm') {
  // Minimal valid WebM: just the EBML magic bytes — enough to pass the
  // header check in isWebmValid(). The backend only peeks the first 4 bytes.
  fs.writeFileSync(path.join(dir, filename), Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x00, 0x00]));
}

describe('meta-helper.js', () => {
  let tmp: string;
  let sessionDir: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-helper-test-'));
    sessionDir = path.join(tmp, 'sess-1234');
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('create initializes meta.json with active status and heartbeat', () => {
    execFileSync('node', [META_HELPER, 'create', sessionDir, '1000000']);
    const meta = JSON.parse(fs.readFileSync(path.join(sessionDir, 'meta.json'), 'utf-8'));
    expect(meta.status).toBe('active');
    expect(meta.createdAt).toBe(1000000);
    expect(meta.heartbeat).toBe(1000000);
    expect(meta.commands).toEqual([]);
    expect(meta.video).toBeNull();
  });

  it('append-command pushes onto commands array and updates heartbeat', () => {
    execFileSync('node', [META_HELPER, 'create', sessionDir, '1000000']);
    execFileSync('node', [META_HELPER, 'append-command', sessionDir, 'open https://x.com', '1001000']);
    execFileSync('node', [META_HELPER, 'append-command', sessionDir, 'click --ref e1', '1002000']);
    const meta = JSON.parse(fs.readFileSync(path.join(sessionDir, 'meta.json'), 'utf-8'));
    expect(meta.commands).toHaveLength(2);
    expect(meta.commands[0].args).toBe('open https://x.com');
    expect(meta.commands[1].timestamp).toBe(1002000);
    expect(meta.heartbeat).toBe(1002000);
  });

  it('append-command handles args with special JSON chars (quotes, brackets)', () => {
    execFileSync('node', [META_HELPER, 'create', sessionDir, '1000000']);
    const tricky = 'fill --value "{\\"key\\": [1,2]}"';
    execFileSync('node', [META_HELPER, 'append-command', sessionDir, tricky, '1001000']);
    const meta = JSON.parse(fs.readFileSync(path.join(sessionDir, 'meta.json'), 'utf-8'));
    expect(meta.commands[0].args).toBe(tricky);
  });

  it('close sets status and closedAt', () => {
    execFileSync('node', [META_HELPER, 'create', sessionDir, '1000000']);
    execFileSync('node', [META_HELPER, 'close', sessionDir, '1005000', 'stale']);
    const meta = JSON.parse(fs.readFileSync(path.join(sessionDir, 'meta.json'), 'utf-8'));
    expect(meta.status).toBe('stale');
    expect(meta.closedAt).toBe(1005000);
  });

  it('set-video updates the video filename', () => {
    execFileSync('node', [META_HELPER, 'create', sessionDir, '1000000']);
    execFileSync('node', [META_HELPER, 'set-video', sessionDir, 'recording.webm']);
    const meta = JSON.parse(fs.readFileSync(path.join(sessionDir, 'meta.json'), 'utf-8'));
    expect(meta.video).toBe('recording.webm');
  });

  it('tolerates concurrent appends — no lost writes under serial execution', () => {
    // The lock lives in the wrapper, not the helper, but the helper must at
    // least produce valid JSON for every atomic call it receives.
    execFileSync('node', [META_HELPER, 'create', sessionDir, '1000000']);
    for (let i = 0; i < 50; i++) {
      execFileSync('node', [META_HELPER, 'append-command', sessionDir, `cmd ${i}`, String(1000000 + i)]);
    }
    const meta = JSON.parse(fs.readFileSync(path.join(sessionDir, 'meta.json'), 'utf-8'));
    expect(meta.commands).toHaveLength(50);
    expect(meta.commands[49].args).toBe('cmd 49');
  });
});

describe('browser-wrapper.sh guards', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wrapper-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('rejects "record start" directly from the agent', () => {
    let code = 0;
    let stderr = '';
    try {
      execFileSync(WRAPPER, ['record', 'start', 'foo.webm'], { cwd: tmp });
    } catch (e) {
      const err = e as { status?: number; stderr?: Buffer };
      code = err.status ?? -1;
      stderr = err.stderr?.toString() ?? '';
    }
    expect(code).toBe(2);
    expect(stderr).toContain('managed automatically');
  });

  it('rejects "record stop" directly from the agent', () => {
    let code = 0;
    try {
      execFileSync(WRAPPER, ['record', 'stop'], { cwd: tmp });
    } catch (e) {
      code = (e as { status?: number }).status ?? -1;
    }
    expect(code).toBe(2);
  });
});

describe('backend reconciliation', () => {
  // Shared tmp dir across every test in this block so the config module —
  // whose REPO_ROOT / agents.config.json lookup is resolved on first call —
  // keeps pointing at the same workspace. Each test uses a different sess-*
  // subdir, and beforeEach wipes .browser-sessions to reset session state.
  let tmp: string;
  let sessionsDir: string;
  let origHome: string | undefined;
  let mod: typeof import('./browser-sessions.js');

  beforeAll(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'reconcile-test-'));

    origHome = process.env.GRANCLAW_HOME;
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'granclaw-home-'));
    process.env.GRANCLAW_HOME = home;
    fs.writeFileSync(path.join(home, 'agents.config.json'), JSON.stringify({
      agents: [{ id: 'tester', name: 'tester', model: 'claude-sonnet-4-5', workspaceDir: tmp, allowedTools: [], bigBrother: { enabled: false } }],
    }));

    mod = await import('./browser-sessions.js');
  });

  afterAll(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
    if (origHome) process.env.GRANCLAW_HOME = origHome;
    else delete process.env.GRANCLAW_HOME;
  });

  beforeEach(() => {
    sessionsDir = path.join(tmp, '.browser-sessions');
    fs.rmSync(sessionsDir, { recursive: true, force: true });
    fs.mkdirSync(sessionsDir);
  });

  it('marks abandoned active sessions as crashed', async () => {
    const dir = path.join(sessionsDir, 'sess-old');
    fakeMeta(dir, {
      status: 'active',
      heartbeat: Date.now() - FIFTEEN_MIN_MS - 60_000, // 16 min ago
      createdAt: Date.now() - FIFTEEN_MIN_MS - 120_000,
    });

    const sessions = mod.listSessions('tester');
    expect(sessions).toHaveLength(1);
    expect(sessions[0].status).toBe('crashed');
    // And the meta.json on disk was updated
    const onDisk = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf-8'));
    expect(onDisk.status).toBe('crashed');
    expect(onDisk.closedAt).not.toBeNull();
  });

  it('leaves fresh active sessions alone', async () => {
    const dir = path.join(sessionsDir, 'sess-fresh');
    fakeMeta(dir, { status: 'active', heartbeat: Date.now() - 5000 });

    const sessions = mod.listSessions('tester');
    expect(sessions[0].status).toBe('active');
  });

  it('videoValid=false when the webm file is missing', async () => {
    const dir = path.join(sessionsDir, 'sess-no-vid');
    fakeMeta(dir, { status: 'closed', closedAt: Date.now() });

    const sessions = mod.listSessions('tester');
    expect(sessions[0].videoValid).toBe(false);
  });

  it('videoValid=false when the file is not a real webm', async () => {
    const dir = path.join(sessionsDir, 'sess-bad-vid');
    fakeMeta(dir, { status: 'closed', closedAt: Date.now() });
    fs.writeFileSync(path.join(dir, 'recording.webm'), 'not a webm');

    const sessions = mod.listSessions('tester');
    expect(sessions[0].videoValid).toBe(false);
  });

  it('videoValid=true when the file has the EBML magic', async () => {
    const dir = path.join(sessionsDir, 'sess-good-vid');
    fakeMeta(dir, { status: 'closed', closedAt: Date.now() });
    writeWebm(dir);

    const sessions = mod.listSessions('tester');
    expect(sessions[0].videoValid).toBe(true);
  });

  it('getVideoPath returns null for corrupt webm', async () => {
    const dir = path.join(sessionsDir, 'sess-bad');
    fakeMeta(dir, { status: 'closed', closedAt: Date.now() });
    fs.writeFileSync(path.join(dir, 'recording.webm'), 'corrupted');

    expect(mod.getVideoPath('tester', 'sess-bad')).toBeNull();
  });

  it('getVideoPath returns the path for a valid webm', async () => {
    const dir = path.join(sessionsDir, 'sess-good');
    fakeMeta(dir, { status: 'closed', closedAt: Date.now() });
    writeWebm(dir);

    const result = mod.getVideoPath('tester', 'sess-good');
    expect(result).toBe(path.join(dir, 'recording.webm'));
  });

  it('getVideoPath blocks path traversal', async () => {
    fakeMeta(path.join(sessionsDir, 'sess-trav'), { status: 'closed', closedAt: Date.now() });
    expect(mod.getVideoPath('tester', '../../../etc')).toBeNull();
  });

  it('forceCloseActiveSession finalizes the active session pointed to by .active-session', async () => {
    const dir = path.join(sessionsDir, 'sess-open');
    fakeMeta(dir, { status: 'active', heartbeat: Date.now() });
    fs.writeFileSync(path.join(sessionsDir, '.active-session'), 'sess-open');

    mod.forceCloseActiveSession('tester');

    const onDisk = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf-8'));
    expect(onDisk.status).toBe('closed');
    expect(onDisk.closedAt).not.toBeNull();
    expect(fs.readFileSync(path.join(sessionsDir, '.active-session'), 'utf-8')).toBe('');
  });

  it('forceCloseActiveSession is a no-op when no active session exists', async () => {
    expect(() => mod.forceCloseActiveSession('tester')).not.toThrow();
  });
});
