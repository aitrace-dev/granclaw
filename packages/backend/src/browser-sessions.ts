/**
 * browser-sessions.ts
 *
 * Reads browser session data from the agent's workspace filesystem.
 * Sessions are stored in `.browser-sessions/sess-{timestamp}/` directories,
 * each containing a `meta.json` and a `recording.webm` video.
 *
 * Sessions may be in one of four statuses:
 *   - active   — recording in progress
 *   - closed   — finished normally via the wrapper's `close` path
 *   - stale    — wrapper detected an abandoned "active" session (heartbeat
 *                older than STALE_TIMEOUT_MS) and force-closed it
 *   - crashed  — backend reconciled an active session with no heartbeat for
 *                longer than STALE_TIMEOUT_MS (belt-and-suspenders in case
 *                no wrapper invocation ever re-enters the dir)
 */

import path from 'path';
import fs from 'fs';
import { REPO_ROOT, getAgent } from './config.js';

const STALE_TIMEOUT_MS = 15 * 60 * 1000;
const WEBM_MAGIC = Buffer.from([0x1a, 0x45, 0xdf, 0xa3]);

// ── Types ─────────────────────────────────────────────────────────────────────

export type SessionStatus = 'active' | 'closed' | 'stale' | 'crashed';

export interface SessionCommand {
  args: string;
  timestamp: number;
}

export interface BrowserSession {
  id: string;
  name: string | null;
  status: SessionStatus;
  createdAt: number;
  closedAt: number | null;
  heartbeat: number;
  video: string | null;
  videoValid: boolean;
  durationMs: number | null;
  commands: SessionCommand[];
}

interface MetaJson {
  id: string;
  name?: string | null;
  status: SessionStatus;
  createdAt: number;
  closedAt?: number | null;
  heartbeat?: number;
  video?: string | null;
  commands?: Array<{ args: string; timestamp: number }>;
}

// ── Path helpers ──────────────────────────────────────────────────────────────

function getSessionsDir(agentId: string): string {
  const agent = getAgent(agentId);
  if (!agent) throw new Error(`Agent "${agentId}" not found in config`);
  const workspaceDir = path.resolve(REPO_ROOT, agent.workspaceDir);
  return path.join(workspaceDir, '.browser-sessions');
}

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

/**
 * Verify a file starts with the WebM EBML magic bytes. Cheap, no ffprobe dep.
 */
function isWebmValid(filePath: string): boolean {
  try {
    const fd = fs.openSync(filePath, 'r');
    const header = Buffer.alloc(4);
    const bytes = fs.readSync(fd, header, 0, 4, 0);
    fs.closeSync(fd);
    return bytes === 4 && header.equals(WEBM_MAGIC);
  } catch {
    return false;
  }
}

/**
 * Named volumes survive container recreation, so a recording.webm from a
 * previous instance's session can sit next to a fresh meta.json. If the
 * file's mtime predates the session's createdAt, it's an orphan — treat
 * as invalid so the replay view doesn't serve the wrong video.
 */
function isFileFromThisSession(filePath: string, createdAt: number): boolean {
  try {
    const st = fs.statSync(filePath);
    return st.mtimeMs >= createdAt;
  } catch {
    return false;
  }
}

/**
 * Reconcile an "active" session that looks abandoned. Mutates meta.json in
 * place and returns the updated value. No-op for non-active statuses.
 *
 * Two triggers: heartbeat too old (15 min), or the caller-supplied
 * probeAlive says the underlying browser is dead. The probe lets enterprise
 * flip sessions immediately when Orbita is killed, instead of waiting out
 * the heartbeat timeout.
 */
function reconcile(
  metaPath: string,
  meta: MetaJson,
  probeAlive?: (sessionId: string) => boolean,
): MetaJson {
  if (meta.status !== 'active') return meta;

  const hb = meta.heartbeat ?? 0;
  const age = hb > 0 ? Date.now() - hb : 0;
  const heartbeatExpired = hb > 0 && age > STALE_TIMEOUT_MS;
  const probeDead = probeAlive ? probeAlive(meta.id) === false : false;

  if (!heartbeatExpired && !probeDead) return meta;

  const updated: MetaJson = {
    ...meta,
    status: 'crashed',
    closedAt: Date.now(),
  };
  try { writeMeta(metaPath, updated); } catch { /* best effort */ }
  return updated;
}

function metaToSession(meta: MetaJson, sessionDir: string): BrowserSession {
  const video = meta.video ?? null;
  const videoPath = video ? path.join(sessionDir, video) : null;
  const videoValid =
    videoPath != null &&
    fs.existsSync(videoPath) &&
    isWebmValid(videoPath) &&
    isFileFromThisSession(videoPath, meta.createdAt);
  const durationMs = meta.closedAt != null ? meta.closedAt - meta.createdAt : null;

  return {
    id: meta.id,
    name: meta.name ?? null,
    status: meta.status,
    createdAt: meta.createdAt,
    closedAt: meta.closedAt ?? null,
    heartbeat: meta.heartbeat ?? 0,
    video,
    videoValid,
    durationMs,
    commands: (meta.commands ?? []).map((c) => ({
      args: c.args,
      timestamp: c.timestamp,
    })),
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface ListSessionsOptions {
  /**
   * Callback the reconciler uses to verify liveness when meta.json says
   * 'active'. Returns true for alive, false for dead. Enterprise wires this
   * to a CDP `/json/version` probe so a killed Orbita flips to 'crashed'
   * immediately instead of waiting out the 15-min heartbeat.
   */
  probeAlive?: (sessionId: string) => boolean;
}

export function listSessions(agentId: string, opts?: ListSessionsOptions): BrowserSession[] {
  const sessionsDir = getSessionsDir(agentId);
  if (!fs.existsSync(sessionsDir)) return [];

  const entries = fs.readdirSync(sessionsDir, { withFileTypes: true });
  const sessions: BrowserSession[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith('sess-')) continue;
    const sessionDir = path.join(sessionsDir, entry.name);
    const metaPath = path.join(sessionDir, 'meta.json');
    const raw = readMeta(metaPath);
    if (!raw) continue;
    const meta = reconcile(metaPath, raw, opts?.probeAlive);
    sessions.push(metaToSession(meta, sessionDir));
  }

  return sessions.sort((a, b) => b.createdAt - a.createdAt);
}

export function getSession(
  agentId: string,
  sessionId: string,
  opts?: ListSessionsOptions,
): BrowserSession | null {
  const sessionsDir = getSessionsDir(agentId);
  const sessionDir = path.resolve(sessionsDir, sessionId);
  if (!sessionDir.startsWith(sessionsDir + path.sep)) return null;

  const metaPath = path.join(sessionDir, 'meta.json');
  if (!fs.existsSync(metaPath)) return null;

  const raw = readMeta(metaPath);
  if (!raw) return null;

  const meta = reconcile(metaPath, raw, opts?.probeAlive);
  return metaToSession(meta, sessionDir);
}

/**
 * Resolve the absolute path of a session's recording, or null if missing
 * or corrupt. Blocks path traversal.
 */
export function getVideoPath(agentId: string, sessionId: string): string | null {
  const sessionsDir = getSessionsDir(agentId);
  const sessionDir = path.resolve(sessionsDir, sessionId);
  if (!sessionDir.startsWith(sessionsDir + path.sep)) return null;

  const metaPath = path.join(sessionDir, 'meta.json');
  const meta = readMeta(metaPath);
  if (!meta || !meta.video) return null;

  const filePath = path.resolve(sessionDir, meta.video);
  if (!filePath.startsWith(sessionDir + path.sep)) return null;
  if (!fs.existsSync(filePath)) return null;
  if (!isWebmValid(filePath)) return null;

  return filePath;
}

/**
 * Flip every 'active' session for this agent to 'crashed' with a fresh
 * closedAt. Called once at backend boot so sessions that were in-flight
 * when the container died (sync-server-image does `docker rm -f` without
 * graceful shutdown) don't advertise status:"active" forever.
 *
 * Returns the number of sessions flipped. Best-effort — errors on
 * individual meta.json files are swallowed so one corrupt session doesn't
 * block the boot finalizer.
 */
export function finalizeAllActiveSessions(agentId: string): number {
  const sessionsDir = getSessionsDir(agentId);
  if (!fs.existsSync(sessionsDir)) return 0;

  let flipped = 0;
  const now = Date.now();
  const entries = fs.readdirSync(sessionsDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith('sess-')) continue;
    const metaPath = path.join(sessionsDir, entry.name, 'meta.json');
    const meta = readMeta(metaPath);
    if (!meta || meta.status !== 'active') continue;
    try {
      writeMeta(metaPath, { ...meta, status: 'crashed', closedAt: now });
      flipped += 1;
    } catch { /* best effort */ }
  }

  try {
    const activeFile = path.join(sessionsDir, '.active-session');
    if (fs.existsSync(activeFile)) fs.writeFileSync(activeFile, '');
  } catch { /* best effort */ }

  return flipped;
}

/**
 * Force-close any active session for this agent. Called when a task run
 * ends so the wrapper never leaves orphans. Best-effort; never throws.
 */
export function forceCloseActiveSession(agentId: string): void {
  try {
    const sessionsDir = getSessionsDir(agentId);
    if (!fs.existsSync(sessionsDir)) return;
    const activeFile = path.join(sessionsDir, '.active-session');
    if (!fs.existsSync(activeFile)) return;
    const sid = fs.readFileSync(activeFile, 'utf-8').trim();
    if (!sid) return;
    const metaPath = path.join(sessionsDir, sid, 'meta.json');
    const meta = readMeta(metaPath);
    if (!meta || meta.status !== 'active') return;
    writeMeta(metaPath, { ...meta, status: 'closed', closedAt: Date.now() });
    try { fs.writeFileSync(activeFile, ''); } catch {}
  } catch {
    // best effort
  }
}
