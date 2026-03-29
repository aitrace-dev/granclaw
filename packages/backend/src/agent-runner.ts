/**
 * agent-runner.ts
 *
 * Spawns the Claude Code CLI as a child process for a given agent.
 * Streams output back via a callback. Persists session IDs so conversations
 * continue across messages.
 *
 * Claude CLI invocation:
 *   claude -p "<message>" --output-format stream-json --verbose [--resume <sessionId>]
 */

import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { AgentConfig } from './config.js';
import { getSession, saveSession, logAction } from './db.js';

export type StreamChunk =
  | { type: 'text'; text: string }
  | { type: 'tool_call'; tool: string; input: unknown }
  | { type: 'tool_result'; tool: string; output: unknown }
  | { type: 'done'; sessionId: string }
  | { type: 'error'; message: string };

export async function runAgent(
  agent: AgentConfig,
  message: string,
  onChunk: (chunk: StreamChunk) => void
): Promise<void> {
  const sessionId = await getSession(agent.id);
  const workspaceDir = path.resolve(process.cwd(), '../../', agent.workspaceDir);

  // Ensure workspace exists
  fs.mkdirSync(workspaceDir, { recursive: true });

  const args = [
    '-p', message,
    '--output-format', 'stream-json',
    '--verbose',
  ];

  if (sessionId) {
    args.push('--resume', sessionId);
  }

  const startedAt = Date.now();

  await logAction(agent.id, 'message', { text: message });

  return new Promise((resolve, reject) => {
    const proc = spawn('claude', args, {
      cwd: workspaceDir,
      env: { ...process.env },
    });

    let buffer = '';
    let newSessionId = sessionId ?? '';

    proc.stdout.on('data', (raw: Buffer) => {
      buffer += raw.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? ''; // keep incomplete last line

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        let parsed: Record<string, unknown>;
        try {
          parsed = JSON.parse(trimmed);
        } catch {
          // non-JSON line (e.g. tool output prose) — emit as text
          onChunk({ type: 'text', text: trimmed });
          continue;
        }

        handleClaudeEvent(parsed, onChunk, (id) => { newSessionId = id; });
      }
    });

    proc.stderr.on('data', (raw: Buffer) => {
      const msg = raw.toString().trim();
      if (msg) console.error(`[agent:${agent.id}] stderr:`, msg);
    });

    proc.on('close', async (code) => {
      if (newSessionId) {
        await saveSession(agent.id, newSessionId);
        onChunk({ type: 'done', sessionId: newSessionId });
      }
      await logAction(agent.id, 'system', null, { exitCode: code }, Date.now() - startedAt);

      if (code === 0 || code === null) {
        resolve();
      } else {
        const err = `claude process exited with code ${code}`;
        onChunk({ type: 'error', message: err });
        reject(new Error(err));
      }
    });
  });
}

// ── Parse a single stream-json event from Claude CLI ──────────────────────

function handleClaudeEvent(
  event: Record<string, unknown>,
  onChunk: (chunk: StreamChunk) => void,
  onSessionId: (id: string) => void
): void {
  const type = event.type as string;

  if (type === 'assistant') {
    // Assistant text content
    const msg = event.message as { content?: Array<{ type: string; text?: string }> };
    if (msg?.content) {
      for (const block of msg.content) {
        if (block.type === 'text' && block.text) {
          onChunk({ type: 'text', text: block.text });
        } else if (block.type === 'tool_use') {
          const b = block as { name?: string; input?: unknown };
          onChunk({ type: 'tool_call', tool: b.name ?? 'unknown', input: b.input });
        }
      }
    }
  } else if (type === 'tool_result') {
    const content = event.content as Array<{ type: string; text?: string }> | undefined;
    const text = content?.find((c) => c.type === 'text')?.text ?? '';
    onChunk({ type: 'tool_result', tool: '', output: text });
  } else if (type === 'result') {
    // Final result with session_id
    const sid = event.session_id as string | undefined;
    if (sid) onSessionId(sid);
  }
}
