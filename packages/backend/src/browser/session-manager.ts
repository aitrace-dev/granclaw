/**
 * browser/session-manager.ts
 *
 * Per-turn browser session lifecycle, in TypeScript. Replaces the bash
 * wrapper + meta-helper.js combo that used to live in the `agent-browser`
 * skill template. This module is used by the inline `browser` tool in
 * runner-pi.ts and finalized from runAgent's finally block.
 *
 * One runAgent invocation owns at most one browser session. The tool
 * lazily creates the session dir + meta.json + WebM recording on the
 * first browser call, appends each subsequent command atomically, and the
 * finalize step stops the recording and marks status='closed' (or 'crashed'
 * if the finalize path errored).
 *
 * On-disk layout is identical to the old wrapper's output so the existing
 * video endpoint and frontend replay view keep working unchanged:
 *
 *   <workspace>/.browser-sessions/sess-<ts>/
 *     meta.json         (status, createdAt, closedAt, heartbeat, video, commands[])
 *     recording.webm    (optional — populated when agent-browser record start succeeds)
 */

import path from 'path';
import fs from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';

import { stealthArgv } from './stealth.js';

const execFileAsync = promisify(execFile);

// ── Types ───────────────────────────────────────────────────────────────────

type SessionStatus = 'active' | 'closed' | 'stale' | 'crashed';

interface MetaJson {
  id: string;
  name: string | null;
  status: SessionStatus;
  createdAt: number;
  closedAt: number | null;
  heartbeat: number;
  video: string | null;
  commands: Array<{ args: string; timestamp: number }>;
}

export interface BrowserSessionHandle {
  agentId: string;
  sessionId: string;          // e.g. "sess-1775903541146"
  workspaceDir: string;
  sessionDir: string;         // <workspace>/.browser-sessions/<sessionId>
  metaPath: string;           // <sessionDir>/meta.json
  recordingStarted: boolean;  // true if `record start` succeeded
}

// ── meta.json IO (atomic) ──────────────────────────────────────────────────

function readMeta(metaPath: string): MetaJson | null {
  try {
    const raw = fs.readFileSync(metaPath, 'utf-8');
    return JSON.parse(raw) as MetaJson;
  } catch {
    return null;
  }
}

function writeMeta(metaPath: string, meta: MetaJson): void {
  const tmp = `${metaPath}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(meta, null, 2), 'utf-8');
  fs.renameSync(tmp, metaPath);
}

// ── Session creation + update ──────────────────────────────────────────────

/**
 * Create a new session directory and meta.json. Called lazily on the first
 * browser tool call for a given runAgent invocation.
 */
export function createSession(agentId: string, workspaceDir: string): BrowserSessionHandle {
  const now = Date.now();
  const sessionId = `sess-${now}`;
  const sessionsDir = path.join(workspaceDir, '.browser-sessions');
  const sessionDir = path.join(sessionsDir, sessionId);
  fs.mkdirSync(sessionDir, { recursive: true });

  const metaPath = path.join(sessionDir, 'meta.json');
  const meta: MetaJson = {
    id: sessionId,
    name: null,
    status: 'active',
    createdAt: now,
    closedAt: null,
    heartbeat: now,
    video: null,
    commands: [],
  };
  writeMeta(metaPath, meta);

  // Point .active-session at this session — the backend uses this as a
  // fallback discovery path when it needs to force-close on shutdown.
  try {
    fs.writeFileSync(path.join(sessionsDir, '.active-session'), sessionId);
  } catch { /* best effort */ }

  return {
    agentId,
    sessionId,
    workspaceDir,
    sessionDir,
    metaPath,
    recordingStarted: false,
  };
}

/**
 * Append a command entry to meta.json and bump the heartbeat.
 * Uses atomic rename so concurrent wrappers would not corrupt it —
 * in practice a single runAgent invocation is the only writer.
 */
export function appendCommand(handle: BrowserSessionHandle, args: string, timestamp = Date.now()): void {
  const meta = readMeta(handle.metaPath);
  if (!meta) return;
  meta.commands.push({ args, timestamp });
  meta.heartbeat = timestamp;
  writeMeta(handle.metaPath, meta);
}

/**
 * Mark the session terminal. Called from runAgent's finally after the LLM
 * loop returns. Failures here are best-effort so we never throw out of the
 * finally path.
 */
export function closeSession(handle: BrowserSessionHandle, status: Exclude<SessionStatus, 'active'> = 'closed'): void {
  try {
    const meta = readMeta(handle.metaPath);
    if (!meta) return;
    meta.status = status;
    meta.closedAt = Date.now();
    writeMeta(handle.metaPath, meta);
  } catch { /* best effort */ }

  // Clear .active-session so the backend's stale detection doesn't consider
  // this session "open" on next scan.
  try {
    const activeFile = path.join(handle.workspaceDir, '.browser-sessions', '.active-session');
    if (fs.existsSync(activeFile)) {
      const current = fs.readFileSync(activeFile, 'utf-8').trim();
      if (current === handle.sessionId) fs.writeFileSync(activeFile, '');
    }
  } catch { /* best effort */ }
}

// ── Recording lifecycle ────────────────────────────────────────────────────

/**
 * Start a WebM recording for this session's dedicated agent-browser daemon.
 *
 * agent-browser's recording state is per-daemon, so with --session <agentId>
 * isolation each agent has its own recording independent of everyone else.
 * "Recording already active" from a previous turn that didn't clean up is
 * handled via a stop-and-retry.
 */
export async function startRecording(handle: BrowserSessionHandle): Promise<boolean> {
  const bin = process.env.AGENT_BROWSER_BIN ?? 'agent-browser';
  const recordingPath = path.join(handle.sessionDir, 'recording.webm');

  // If this invocation is the one that spawns the daemon, the daemon must
  // load the persistent profile at boot. Pass --profile here so cookies are
  // loaded before any subsequent command runs — agent-browser ignores
  // --profile on already-running daemons.
  //
  // stealthArgv() adds --extension (our MV3 stealth extension) and, if a
  // real Chrome binary is installed on the host, --executable-path. These
  // also only take effect on the boot command, so they live here alongside
  // --profile. Order matters: all launch flags must precede the subcommand.
  const profileDir = path.join(handle.workspaceDir, '.browser-profile');
  const profileArgs = fs.existsSync(profileDir) ? ['--profile', profileDir] : [];

  const launchFlags = [...profileArgs, ...stealthArgv()];

  const recordArgv = ['--session', handle.agentId, ...launchFlags, 'record', 'start', recordingPath];
  const stopArgv = ['--session', handle.agentId, 'record', 'stop'];

  const tryStart = async (): Promise<boolean> => {
    try {
      await execFileAsync(bin, recordArgv, { cwd: handle.workspaceDir, timeout: 5000 });
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('already active')) {
        // Force-stop the dangling recording and retry once
        try { await execFileAsync(bin, stopArgv, { cwd: handle.workspaceDir, timeout: 5000 }); } catch { /* ignore */ }
        try {
          await execFileAsync(bin, recordArgv, { cwd: handle.workspaceDir, timeout: 5000 });
          return true;
        } catch { return false; }
      }
      return false;
    }
  };

  const started = await tryStart();
  if (!started) return false;

  // agent-browser's `record start` spawns ffmpeg as a child and returns
  // success (exit 0, prints "✓ Recording started") even when ffmpeg is
  // missing from the host — the ffmpeg failure only surfaces later on
  // `record stop`. Without this check the session ends up with
  // `video: "recording.webm"` in meta.json but no file on disk, and the
  // replay view shows a dead "no recording" card forever.
  //
  // Poll for the WebM file to appear. ffmpeg cold-starts can take 2–3s
  // under Docker with a loaded host (e.g. right after /sync-server-image
  // recreates containers). 5s is enough headroom that a slow cold start
  // isn't misclassified as "ffmpeg missing".
  const FILE_APPEAR_TIMEOUT_MS = 5000;
  const FILE_APPEAR_POLL_MS = 100;
  const deadline = Date.now() + FILE_APPEAR_TIMEOUT_MS;
  let fileOk = false;
  while (Date.now() < deadline) {
    try {
      const st = fs.statSync(recordingPath);
      if (st.size > 0) { fileOk = true; break; }
    } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, FILE_APPEAR_POLL_MS));
  }

  if (!fileOk) {
    console.warn(
      `[browser/session-manager] record start reported success but ${recordingPath} did not materialize within ${FILE_APPEAR_TIMEOUT_MS}ms — check that ffmpeg is installed and the host is not overloaded`,
    );
    // Best-effort stop so we don't leave a zombie record-state that would
    // make the next session's tryStart hit "already active".
    try { await execFileAsync(bin, stopArgv, { cwd: handle.workspaceDir, timeout: 5000 }); } catch { /* ignore */ }
    return false;
  }

  const meta = readMeta(handle.metaPath);
  if (meta) {
    meta.video = 'recording.webm';
    writeMeta(handle.metaPath, meta);
  }
  handle.recordingStarted = true;
  return true;
}

/**
 * Stop the WebM recording so agent-browser flushes it to disk. Best effort.
 */
export async function stopRecording(handle: BrowserSessionHandle): Promise<void> {
  if (!handle.recordingStarted) return;
  const bin = process.env.AGENT_BROWSER_BIN ?? 'agent-browser';
  try {
    await execFileAsync(
      bin,
      ['--session', handle.agentId, 'record', 'stop'],
      { cwd: handle.workspaceDir, timeout: 5000 },
    );
  } catch { /* best effort — WebM is flushed on daemon close anyway */ }
}

/**
 * One-shot finalizer called from runAgent's finally. Stops the recording,
 * marks the session closed, best-effort throughout so we never throw out
 * of the finally path.
 */
export async function finalizeSession(
  handle: BrowserSessionHandle,
  status: Exclude<SessionStatus, 'active'> = 'closed',
): Promise<void> {
  await stopRecording(handle);
  closeSession(handle, status);
}
