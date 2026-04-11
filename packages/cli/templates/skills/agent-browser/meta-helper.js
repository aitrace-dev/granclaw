#!/usr/bin/env node
/**
 * meta-helper.js — atomic meta.json operations for browser-wrapper.sh
 *
 * The shell wrapper cannot safely edit JSON (sed is not atomic, escaping is
 * fragile, and concurrent invocations race). This helper does it correctly.
 *
 * All writes use a temp file + rename for atomicity. All reads tolerate
 * missing/corrupt files by returning a fresh default.
 *
 * Commands:
 *   create <session-dir>           Initialize meta.json for a new session
 *   append-command <session-dir> <args> <timestamp>
 *   close <session-dir> <timestamp> [status]
 *   set-video <session-dir> <filename>
 *   heartbeat <session-dir> <timestamp>
 *   get-status <session-dir>       Print current status
 *   get-heartbeat <session-dir>    Print heartbeat timestamp (or 0)
 *   get-recording <session-dir>    Print recording filename (or empty)
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_META = () => ({
  id: '',
  name: null,
  status: 'active',
  createdAt: 0,
  closedAt: null,
  heartbeat: 0,
  video: null,
  commands: [],
});

function metaPath(sessionDir) {
  return path.join(sessionDir, 'meta.json');
}

function readMeta(sessionDir) {
  const p = metaPath(sessionDir);
  if (!fs.existsSync(p)) return null;
  try {
    const raw = fs.readFileSync(p, 'utf-8');
    return { ...DEFAULT_META(), ...JSON.parse(raw) };
  } catch {
    return null;
  }
}

function writeMeta(sessionDir, meta) {
  const p = metaPath(sessionDir);
  const tmp = `${p}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(meta, null, 2), 'utf-8');
  fs.renameSync(tmp, p);
}

const [, , cmd, sessionDir, ...rest] = process.argv;

if (!cmd || !sessionDir) {
  console.error('usage: meta-helper.js <command> <session-dir> [args...]');
  process.exit(2);
}

switch (cmd) {
  case 'create': {
    const id = path.basename(sessionDir);
    const now = Number(rest[0] ?? Date.now());
    const meta = {
      ...DEFAULT_META(),
      id,
      status: 'active',
      createdAt: now,
      heartbeat: now,
    };
    fs.mkdirSync(sessionDir, { recursive: true });
    writeMeta(sessionDir, meta);
    process.stdout.write(id);
    break;
  }

  case 'append-command': {
    const meta = readMeta(sessionDir);
    if (!meta) process.exit(1);
    const [args, ts] = rest;
    meta.commands.push({
      args: String(args ?? ''),
      timestamp: Number(ts ?? Date.now()),
    });
    meta.heartbeat = Number(ts ?? Date.now());
    writeMeta(sessionDir, meta);
    break;
  }

  case 'close': {
    const meta = readMeta(sessionDir);
    if (!meta) process.exit(1);
    const [ts, status] = rest;
    meta.status = status || 'closed';
    meta.closedAt = Number(ts ?? Date.now());
    writeMeta(sessionDir, meta);
    break;
  }

  case 'set-video': {
    const meta = readMeta(sessionDir);
    if (!meta) process.exit(1);
    meta.video = rest[0] || null;
    writeMeta(sessionDir, meta);
    break;
  }

  case 'heartbeat': {
    const meta = readMeta(sessionDir);
    if (!meta) process.exit(1);
    meta.heartbeat = Number(rest[0] ?? Date.now());
    writeMeta(sessionDir, meta);
    break;
  }

  case 'get-status': {
    const meta = readMeta(sessionDir);
    process.stdout.write(meta?.status ?? '');
    break;
  }

  case 'get-heartbeat': {
    const meta = readMeta(sessionDir);
    process.stdout.write(String(meta?.heartbeat ?? 0));
    break;
  }

  case 'get-recording': {
    const meta = readMeta(sessionDir);
    process.stdout.write(meta?.video ?? '');
    break;
  }

  case 'set-name': {
    const meta = readMeta(sessionDir);
    if (!meta) process.exit(1);
    meta.name = rest[0] || null;
    writeMeta(sessionDir, meta);
    break;
  }

  default:
    console.error(`meta-helper.js: unknown command "${cmd}"`);
    process.exit(2);
}
