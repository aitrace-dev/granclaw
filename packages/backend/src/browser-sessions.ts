/**
 * browser-sessions.ts
 *
 * Reads browser session data from the agent's workspace filesystem.
 * Sessions are stored in `.browser-sessions/sess-{timestamp}/` directories,
 * each containing a `meta.json` and PNG screenshots.
 * Can generate session names via Claude Haiku.
 */

import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import Anthropic from '@anthropic-ai/sdk';
import { REPO_ROOT, getAgent } from './config.js';
import { claudeBin, spawnEnv } from './agent/runner.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SessionCommand {
  args: string;
  timestamp: number;
  screenshot: string | null;
}

export interface BrowserSession {
  id: string;
  name: string | null;
  status: 'active' | 'closed';
  createdAt: number;
  closedAt: number | null;
  screenshotCount: number;
  commands: SessionCommand[];
}

interface MetaJson {
  id: string;
  name?: string | null;
  status: 'active' | 'closed';
  createdAt: number;
  closedAt?: number | null;
  commands?: Array<{ args: string; timestamp: number; screenshot?: string | null }>;
}

// ── Haiku — direct API if key available, CLI fallback ────────────────────────

const anthropic = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;

async function callHaiku(prompt: string): Promise<string> {
  if (anthropic) {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      messages: [{ role: 'user', content: prompt }],
    });
    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    return text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
  }

  return new Promise((resolve, reject) => {
    const args = ['-p', prompt, '--output-format', 'json', '--permission-mode', 'bypassPermissions', '--model', 'claude-haiku-4-5-20251001'];
    const proc = spawn(claudeBin, args, { env: spawnEnv, stdio: ['pipe', 'pipe', 'pipe'] });
    proc.stdin?.end();
    let output = '';
    proc.stdout.on('data', (raw: Buffer) => { output += raw.toString(); });
    proc.on('close', () => {
      try {
        const wrapper = JSON.parse(output.trim()) as { result?: string };
        const inner = wrapper.result ?? output;
        resolve(inner.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim());
      } catch { resolve(output.trim()); }
    });
    proc.on('error', reject);
  });
}

// ── Path helpers ──────────────────────────────────────────────────────────────

function getSessionsDir(agentId: string): string {
  const agent = getAgent(agentId);
  if (!agent) throw new Error(`Agent "${agentId}" not found in config`);
  const workspaceDir = path.resolve(REPO_ROOT, agent.workspaceDir);
  return path.join(workspaceDir, '.browser-sessions');
}

function getSessionDir(sessionsDir: string, sessionId: string): string {
  return path.join(sessionsDir, sessionId);
}

function countPngs(dir: string): number {
  if (!fs.existsSync(dir)) return 0;
  return fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.png')).length;
}

function readMeta(metaPath: string): MetaJson | null {
  try {
    const raw = fs.readFileSync(metaPath, 'utf-8');
    return JSON.parse(raw) as MetaJson;
  } catch {
    return null;
  }
}

function metaToSession(meta: MetaJson, sessionDir: string): BrowserSession {
  return {
    id: meta.id,
    name: meta.name ?? null,
    status: meta.status,
    createdAt: meta.createdAt,
    closedAt: meta.closedAt ?? null,
    screenshotCount: countPngs(sessionDir),
    commands: (meta.commands ?? []).map((c) => ({
      args: c.args,
      timestamp: c.timestamp,
      screenshot: c.screenshot ?? null,
    })),
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * List all sessions for an agent, sorted by createdAt descending.
 */
export function listSessions(agentId: string): BrowserSession[] {
  const sessionsDir = getSessionsDir(agentId);
  if (!fs.existsSync(sessionsDir)) return [];

  const entries = fs.readdirSync(sessionsDir, { withFileTypes: true });
  const sessions: BrowserSession[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith('sess-')) continue;
    const sessionDir = path.join(sessionsDir, entry.name);
    const metaPath = path.join(sessionDir, 'meta.json');
    const meta = readMeta(metaPath);
    if (!meta) continue;
    sessions.push(metaToSession(meta, sessionDir));
  }

  return sessions.sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * Get a single session by ID. Guards against path traversal.
 */
export function getSession(agentId: string, sessionId: string): BrowserSession | null {
  const sessionsDir = getSessionsDir(agentId);
  const sessionDir = path.resolve(sessionsDir, sessionId);

  // Block path traversal
  if (!sessionDir.startsWith(sessionsDir + path.sep)) return null;

  const metaPath = path.join(sessionDir, 'meta.json');
  if (!fs.existsSync(metaPath)) return null;

  const meta = readMeta(metaPath);
  if (!meta) return null;

  return metaToSession(meta, sessionDir);
}

/**
 * List PNG filenames in a session directory, sorted chronologically (by name).
 */
export function getSessionScreenshots(agentId: string, sessionId: string): string[] {
  const sessionsDir = getSessionsDir(agentId);
  const sessionDir = path.resolve(sessionsDir, sessionId);

  // Block path traversal
  if (!sessionDir.startsWith(sessionsDir + path.sep)) return [];
  if (!fs.existsSync(sessionDir)) return [];

  return fs.readdirSync(sessionDir)
    .filter((f) => f.toLowerCase().endsWith('.png'))
    .sort();
}

/**
 * Resolve the full filesystem path for a screenshot.
 * Returns null if not found, path traversal detected, or not a PNG.
 */
export function getScreenshotPath(agentId: string, sessionId: string, filename: string): string | null {
  if (!filename.toLowerCase().endsWith('.png')) return null;

  const sessionsDir = getSessionsDir(agentId);
  const sessionDir = path.resolve(sessionsDir, sessionId);

  // Block path traversal on session dir
  if (!sessionDir.startsWith(sessionsDir + path.sep)) return null;

  const filePath = path.resolve(sessionDir, filename);

  // Block path traversal on filename
  if (!filePath.startsWith(sessionDir + path.sep)) return null;

  if (!fs.existsSync(filePath)) return null;

  return filePath;
}

/**
 * Generate a short name for the session using Haiku and write it back to meta.json.
 */
export async function generateSessionName(agentId: string, sessionId: string): Promise<string | null> {
  const sessionsDir = getSessionsDir(agentId);
  const sessionDir = path.resolve(sessionsDir, sessionId);

  // Block path traversal
  if (!sessionDir.startsWith(sessionsDir + path.sep)) return null;

  const metaPath = path.join(sessionDir, 'meta.json');
  if (!fs.existsSync(metaPath)) return null;

  const meta = readMeta(metaPath);
  if (!meta) return null;

  const commandList = (meta.commands ?? [])
    .map((c, i) => `${i + 1}. ${c.args}`)
    .join('\n');

  const prompt = commandList.trim()
    ? `You are naming a browser automation session. Below is the list of commands that were run:\n\n${commandList}\n\nGive this session a short, descriptive name in under 10 words. Output only the name, no punctuation, no quotes.`
    : 'Give this empty browser session a short generic name in under 10 words. Output only the name, no punctuation, no quotes.';

  const name = await callHaiku(prompt);
  const trimmedName = name.slice(0, 100); // safety cap

  // Write name back to meta.json
  const updated: MetaJson = { ...meta, name: trimmedName };
  fs.writeFileSync(metaPath, JSON.stringify(updated, null, 2), 'utf-8');

  return trimmedName;
}
