import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  createSession,
  appendCommand,
  closeSession,
} from './browser/session-manager.js';

/**
 * Integration tests for the browser session lifecycle.
 *
 * Covers:
 *   - browser/session-manager.ts — the atomic session-dir + meta.json helpers
 *     used by the inline `browser` pi tool registered in runner-pi.ts
 *   - browser-sessions.ts — the backend read/reconcile layer used by the
 *     /browser-sessions REST routes and the replay view
 *
 * No network, no Chromium — the `startRecording` / `stopRecording` helpers
 * that actually shell out to agent-browser are tested separately in the
 * end-to-end probes (they need a real daemon). These tests exercise only
 * the on-disk state machine.
 */

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

describe('browser/session-manager', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'session-manager-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('createSession initializes meta.json, session dir, and .active-session', () => {
    const handle = createSession('test-agent', tmp);
    expect(handle.agentId).toBe('test-agent');
    expect(handle.sessionId).toMatch(/^sess-\d+$/);
    expect(fs.existsSync(handle.metaPath)).toBe(true);
    const meta = JSON.parse(fs.readFileSync(handle.metaPath, 'utf-8'));
    expect(meta.status).toBe('active');
    expect(meta.commands).toEqual([]);
    expect(meta.video).toBeNull();
    expect(meta.heartbeat).toBeGreaterThan(0);
    expect(meta.heartbeat).toBe(meta.createdAt);
    // .active-session points at this handle
    const active = fs.readFileSync(path.join(tmp, '.browser-sessions', '.active-session'), 'utf-8');
    expect(active).toBe(handle.sessionId);
  });

  it('appendCommand pushes onto commands and bumps heartbeat atomically', () => {
    const handle = createSession('test-agent', tmp);
    appendCommand(handle, 'open https://example.com', 1_000_000);
    appendCommand(handle, 'click --ref e12', 1_001_000);
    appendCommand(handle, 'fill --ref e5 Alice', 1_002_000);
    const meta = JSON.parse(fs.readFileSync(handle.metaPath, 'utf-8'));
    expect(meta.commands).toHaveLength(3);
    expect(meta.commands[0].args).toBe('open https://example.com');
    expect(meta.commands[2].timestamp).toBe(1_002_000);
    expect(meta.heartbeat).toBe(1_002_000);
  });

  it('appendCommand preserves JSON-hostile characters verbatim', () => {
    const handle = createSession('test-agent', tmp);
    const tricky = 'eval document.querySelectorAll("a[href^=\\"/wiki/\\"]").length';
    appendCommand(handle, tricky);
    const meta = JSON.parse(fs.readFileSync(handle.metaPath, 'utf-8'));
    expect(meta.commands[0].args).toBe(tricky);
  });

  it('closeSession flips status and clears .active-session', () => {
    const handle = createSession('test-agent', tmp);
    appendCommand(handle, 'open https://x.com');
    closeSession(handle, 'closed');
    const meta = JSON.parse(fs.readFileSync(handle.metaPath, 'utf-8'));
    expect(meta.status).toBe('closed');
    expect(meta.closedAt).toBeGreaterThan(0);
    expect(fs.readFileSync(path.join(tmp, '.browser-sessions', '.active-session'), 'utf-8')).toBe('');
  });

  it('closeSession accepts non-closed terminal statuses (stale, crashed)', () => {
    const handle = createSession('test-agent', tmp);
    closeSession(handle, 'crashed');
    const meta = JSON.parse(fs.readFileSync(handle.metaPath, 'utf-8'));
    expect(meta.status).toBe('crashed');
  });

  it('serial hammer: 100 appendCommand calls produce valid JSON with all entries', () => {
    const handle = createSession('test-agent', tmp);
    for (let i = 0; i < 100; i++) {
      appendCommand(handle, `cmd-${i}`, 1_000_000 + i);
    }
    const meta = JSON.parse(fs.readFileSync(handle.metaPath, 'utf-8'));
    expect(meta.commands).toHaveLength(100);
    expect(meta.commands[99].args).toBe('cmd-99');
    expect(meta.heartbeat).toBe(1_000_000 + 99);
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
      agents: [{ id: 'tester', name: 'tester', model: 'claude-sonnet-4-5', workspaceDir: tmp, bigBrother: { enabled: false } }],
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
