/**
 * agent/telegram-chats.ts
 *
 * Small persistence helper for the set of Telegram chat_ids this agent has
 * received messages from. Two writers/readers:
 *
 *   - TelegramAdapter calls recordInboundChat() on every inbound message, so
 *     we always have an up-to-date set of "chats the user has spoken from".
 *   - The telegram_send tool reads the set to validate explicit chat_id args
 *     and to default to the most-recent chat when the agent doesn't pass one.
 *
 * Persistence: one JSON file at <workspaceDir>/.telegram-chats.json so the
 * set survives agent-subprocess restarts. No locking — concurrent writes
 * from the single-process adapter are serialized by the event loop.
 *
 * Policy: we only allow outbound sends to chats that have already messaged
 * the agent. This prevents a hallucinating agent from spamming arbitrary
 * chat_ids (which Telegram wouldn't deliver to anyway, but the refusal
 * gives the agent a clear error instead of a silent no-op).
 */

import fs from 'fs';
import path from 'path';

interface KnownChat {
  chatId: number;
  lastSeenAt: number;
}

interface ChatsFile {
  chats: KnownChat[];
}

function filePath(workspaceDir: string): string {
  return path.join(workspaceDir, '.telegram-chats.json');
}

function readFile(workspaceDir: string): ChatsFile {
  try {
    const raw = fs.readFileSync(filePath(workspaceDir), 'utf8');
    const parsed = JSON.parse(raw) as Partial<ChatsFile>;
    return { chats: Array.isArray(parsed.chats) ? parsed.chats : [] };
  } catch {
    return { chats: [] };
  }
}

function writeFile(workspaceDir: string, data: ChatsFile): void {
  const tmp = filePath(workspaceDir) + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, filePath(workspaceDir));
}

/** Called by the adapter whenever the user messages in. Updates lastSeenAt. */
export function recordInboundChat(workspaceDir: string, chatId: number): void {
  const data = readFile(workspaceDir);
  const existing = data.chats.find(c => c.chatId === chatId);
  if (existing) {
    existing.lastSeenAt = Date.now();
  } else {
    data.chats.push({ chatId, lastSeenAt: Date.now() });
  }
  try {
    writeFile(workspaceDir, data);
  } catch (err) {
    console.error(`[telegram-chats] write failed:`, err);
  }
}

/** Return all chat_ids the user has messaged from, most-recent first. */
export function listKnownChats(workspaceDir: string): number[] {
  const data = readFile(workspaceDir);
  return [...data.chats].sort((a, b) => b.lastSeenAt - a.lastSeenAt).map(c => c.chatId);
}

/** Default chat for outbound — the most recent inbound chat, or null if none. */
export function defaultChatId(workspaceDir: string): number | null {
  const known = listKnownChats(workspaceDir);
  return known[0] ?? null;
}

/** Policy check: only allow outbound to chats we've seen inbound. */
export function isKnownChat(workspaceDir: string, chatId: number): boolean {
  return listKnownChats(workspaceDir).includes(chatId);
}
