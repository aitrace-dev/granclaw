/**
 * agent/telegram-adapter.ts
 *
 * Bridges the Telegram Bot API into the agent's internal queue with a live
 * status UX modeled on the dashboard:
 *
 *   1. User sends a message
 *   2. We immediately enqueue the job, fire a typing indicator, and post a
 *      localized acknowledgment message in their language (en/es/zh)
 *   3. As the agent runs and emits tool_call events, we EDIT the same
 *      acknowledgment message to append a step list:
 *        "Got it…
 *         🔍 Searching the web
 *         🌐 Browsing
 *         ✍️ Writing"
 *   4. When the agent finishes, we edit the live message one last time to
 *      "✓ Done in 47s · 5 steps" so the user has a breadcrumb, then send
 *      the actual response as a brand new message
 *
 * Throttling: edits are coalesced into one call every 1.5 s per chat to
 * stay under Telegram's per-chat rate limit. Periodic typing indicators are
 * re-sent every 4 s while the job is running.
 */

import telegramifyMarkdown from 'telegramify-markdown';
import { flattenMarkdownTables } from '../lib/flatten-markdown-tables.js';
import { TelegramHttpClient } from './telegram-http-client.js';
import { enqueue } from '../agent-db.js';
import {
  detectLanguage,
  ackText,
  doneText,
  toolLabel,
  moreStepsSuffix,
  type Lang,
} from '../lib/i18n-telegram.js';

const EDIT_THROTTLE_MS = 1500;
const TYPING_REFRESH_MS = 4000;
const MAX_VISIBLE_STEPS = 6;

interface ChatState {
  chatId: number;
  lang: Lang;
  liveMessageId: number | null;
  ackPosted: Promise<void>;
  toolSteps: string[];
  startedAt: number;
  lastEditAt: number;
  pendingEdit: ReturnType<typeof setTimeout> | null;
  typingTimer: ReturnType<typeof setInterval> | null;
  responseBuffer: string;
}

export class TelegramAdapter {
  private bot: TelegramHttpClient;
  private agentId: string;
  private workspaceDir: string;
  // channelId ('telegram:<chatId>') → mutable state for the in-flight turn
  private chats = new Map<string, ChatState>();

  constructor(agentId: string, botToken: string, workspaceDir: string) {
    this.agentId = agentId;
    this.workspaceDir = workspaceDir;
    this.bot = new TelegramHttpClient(botToken, { polling: true });
    this.setupHandlers();
    console.log(`[agent:${agentId}] Telegram adapter started`);
  }

  private setupHandlers() {
    this.bot.on('message', async (msg) => {
      if (!msg.text) return;
      const chatId = msg.chat.id;
      const channelId = `telegram:${chatId}`;
      console.log(`[agent:${this.agentId}] Telegram message from chat ${chatId}`);

      // Tear down any leftover state from a prior turn (shouldn't happen
      // because the queue is per-channel, but defensive)
      this.teardownState(channelId);

      // 1. Enqueue immediately so the worker can start as soon as possible
      enqueue(this.workspaceDir, this.agentId, msg.text, channelId);

      // 2. Detect language + start typing indicator immediately
      const lang = detectLanguage(msg.text);
      this.startTypingLoop(chatId);

      // 3. Post the localized acknowledgment as the live status message.
      //    Tracked via ackPosted so subsequent appendToolStep calls can
      //    await it before trying to edit a non-existent message_id.
      const state: ChatState = {
        chatId,
        lang,
        liveMessageId: null,
        ackPosted: Promise.resolve(),
        toolSteps: [],
        startedAt: Date.now(),
        lastEditAt: 0,
        pendingEdit: null,
        typingTimer: null,
        responseBuffer: '',
      };
      this.chats.set(channelId, state);

      state.ackPosted = this.bot.sendMessage(chatId, ackText(lang))
        .then((m) => { state.liveMessageId = m.message_id; })
        .catch((err) => {
          console.warn(`[agent:${this.agentId}] Telegram ack failed:`, err.message);
        });
    });

    this.bot.on('polling_error', (err) => {
      console.error(`[agent:${this.agentId}] Telegram polling error:`, err.message);
    });
  }

  // ── Typing indicator loop ────────────────────────────────────────────────

  private startTypingLoop(chatId: number) {
    // Initial fire — instant feedback
    this.bot.sendChatAction(chatId, 'typing').catch(() => {});

    // Find the chat state if it exists, attach the timer there
    for (const state of this.chats.values()) {
      if (state.chatId === chatId && !state.typingTimer) {
        state.typingTimer = setInterval(() => {
          this.bot.sendChatAction(chatId, 'typing').catch(() => {});
        }, TYPING_REFRESH_MS);
        return;
      }
    }
    // No state yet — set up a self-clearing timer that the next state
    // creation will adopt. Simpler: just ensure the bot keeps typing for
    // the first few seconds; chat state setup happens immediately after.
    setTimeout(() => {
      const state = Array.from(this.chats.values()).find((s) => s.chatId === chatId);
      if (state && !state.typingTimer) {
        state.typingTimer = setInterval(() => {
          this.bot.sendChatAction(chatId, 'typing').catch(() => {});
        }, TYPING_REFRESH_MS);
      }
    }, 50);
  }

  private stopTypingLoop(state: ChatState) {
    if (state.typingTimer) {
      clearInterval(state.typingTimer);
      state.typingTimer = null;
    }
  }

  // ── Live message edits ───────────────────────────────────────────────────

  /** Append a tool-call step to the live status message. */
  async appendToolStep(channelId: string, toolName: string): Promise<void> {
    const state = this.chats.get(channelId);
    if (!state) return;
    state.toolSteps.push(toolLabel(state.lang, toolName));
    await state.ackPosted; // Don't edit before the live message exists
    this.scheduleEdit(state);
  }

  /** Compose the current live message body. */
  private composeLiveBody(state: ChatState): string {
    const lines = [ackText(state.lang)];
    const steps = state.toolSteps;
    if (steps.length === 0) return lines.join('\n');

    if (steps.length <= MAX_VISIBLE_STEPS) {
      lines.push('', ...steps);
    } else {
      // Show first 1, hidden middle, last 4 — keep the message under control
      const tail = steps.slice(-(MAX_VISIBLE_STEPS - 1));
      const hiddenCount = steps.length - tail.length - 1;
      lines.push('', steps[0], moreStepsSuffix(state.lang, hiddenCount), ...tail);
    }
    return lines.join('\n');
  }

  private scheduleEdit(state: ChatState) {
    if (state.pendingEdit) return; // already queued
    const now = Date.now();
    const elapsed = now - state.lastEditAt;
    const wait = elapsed >= EDIT_THROTTLE_MS ? 0 : EDIT_THROTTLE_MS - elapsed;
    state.pendingEdit = setTimeout(() => {
      state.pendingEdit = null;
      void this.flushEdit(state);
    }, wait);
  }

  private async flushEdit(state: ChatState): Promise<void> {
    if (state.liveMessageId == null) return;
    const body = this.composeLiveBody(state);
    state.lastEditAt = Date.now();
    try {
      await this.bot.editMessageText(body, {
        chat_id: state.chatId,
        message_id: state.liveMessageId,
      });
    } catch (err) {
      // Common: 400 "message is not modified" if the body didn't change.
      // Also possible: chat deleted, message too old. Best-effort.
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes('message is not modified')) {
        console.warn(`[agent:${this.agentId}] Telegram edit failed:`, msg);
      }
    }
  }

  // ── Buffered text from runAgent ──────────────────────────────────────────

  /** Called from process.ts for each text chunk. */
  appendChunk(channelId: string, text: string) {
    const state = this.chats.get(channelId);
    if (!state) return;
    state.responseBuffer += text;
  }

  /** Called from process.ts when the agent emits a takeover_requested chunk. */
  notifyTakeover(channelId: string, takeoverUrl: string) {
    const state = this.chats.get(channelId);
    if (!state) return;
    this.bot
      .sendMessage(state.chatId, `Takeover link: ${takeoverUrl}`)
      .catch((err: Error) => {
        console.warn(`[agent:${this.agentId}] Telegram takeover notify failed:`, err.message);
      });
  }

  // ── Finalize + flush ─────────────────────────────────────────────────────

  /**
   * Edit the live status message one last time with a "Done" footer, then
   * send the actual agent response as a new message. Called from process.ts
   * just before / as part of the post-runAgent cleanup.
   */
  async flushReply(channelId: string): Promise<void> {
    const state = this.chats.get(channelId);
    if (!state) return;

    this.stopTypingLoop(state);

    // Cancel any pending edit and force a final flush so the latest tool
    // steps are visible before we add the Done footer.
    if (state.pendingEdit) {
      clearTimeout(state.pendingEdit);
      state.pendingEdit = null;
    }
    await state.ackPosted;

    if (state.liveMessageId != null) {
      const elapsed = (Date.now() - state.startedAt) / 1000;
      const footer = doneText(state.lang, elapsed, state.toolSteps.length);
      const body = this.composeLiveBody(state) + '\n\n' + footer;
      try {
        await this.bot.editMessageText(body, {
          chat_id: state.chatId,
          message_id: state.liveMessageId,
        });
      } catch { /* best effort */ }
    }

    // Send the actual response as a new message
    const text = state.responseBuffer;
    if (text.trim()) {
      await this.sendReply(state.chatId, text);
    }

    this.chats.delete(channelId);
  }

  async sendErrorMessage(chatId: number, text: string): Promise<void> {
    // Tear down state for this chat (errors come from the same channel)
    this.teardownState(`telegram:${chatId}`);
    await this.bot.sendMessage(chatId, text).catch(() => {});
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private teardownState(channelId: string) {
    const state = this.chats.get(channelId);
    if (!state) return;
    this.stopTypingLoop(state);
    if (state.pendingEdit) clearTimeout(state.pendingEdit);
    this.chats.delete(channelId);
  }

  private async sendReply(chatId: number, text: string): Promise<void> {
    const MAX = 4000;

    // Pre-process: flatten markdown tables into "key: value" lines. Telegram
    // MarkdownV2 has no table support — telegramify-markdown treats tables as
    // plain-text unknowns and escapes every special character inside the
    // cells, including link brackets/parens, and the pipe escape sequence
    // `\|` is actually NOT a valid MarkdownV2 escape, so Telegram rejects
    // the whole message, the .catch() fallback re-sends the escape-soup as
    // plain text, and users see a wall of backslashes. Strip tables first.
    const flattened = flattenMarkdownTables(text);

    // Chunk the ORIGINAL (flattened) text at newline boundaries BEFORE
    // escaping. We then try to send each chunk as MarkdownV2 and, on any
    // Telegram API error, fall back to sending that chunk's original
    // unescaped form — never the escaped body. Previously the fallback
    // used the escaped chunk, which is why users saw `\!` / `\.` / `\|`
    // characters in their messages when MarkdownV2 parsing failed.
    const chunks: string[] = [];
    let remaining = flattened;
    while (remaining.length > MAX) {
      const slice = remaining.slice(0, MAX);
      const splitAt = slice.lastIndexOf('\n') > MAX / 2 ? slice.lastIndexOf('\n') : MAX;
      chunks.push(remaining.slice(0, splitAt));
      remaining = remaining.slice(splitAt).trimStart();
    }
    if (remaining.length > 0) chunks.push(remaining);
    if (chunks.length === 0) return;

    for (const chunk of chunks) {
      await this.sendChunkWithFallback(chatId, chunk);
    }
  }

  /**
   * Send one chunk as MarkdownV2, falling back to the ORIGINAL unescaped
   * chunk as plain text on any Telegram error. Logs the failure reason so
   * operators can diagnose why MarkdownV2 rendering was rejected.
   */
  private async sendChunkWithFallback(chatId: number, original: string): Promise<void> {
    let escaped: string;
    try {
      escaped = telegramifyMarkdown(original, 'escape');
    } catch (err) {
      // telegramify-markdown itself crashed — go straight to plain text.
      console.warn(
        `[telegram-adapter] telegramify-markdown threw, sending plain text: ${(err as Error).message}`,
      );
      await this.bot.sendMessage(chatId, original).catch(() => { /* give up */ });
      return;
    }
    try {
      await this.bot.sendMessage(chatId, escaped, { parse_mode: 'MarkdownV2' });
    } catch (err) {
      // Typical causes: unsupported escape sequence (e.g. `\|` which is not
      // a valid MarkdownV2 escape), nesting limits, or link URLs with an
      // unescaped `)`. Log the reason and send the unescaped ORIGINAL so
      // the user sees a clean message instead of backslash-soup.
      const msg = (err as Error).message ?? String(err);
      console.warn(
        `[telegram-adapter] MarkdownV2 send failed, falling back to plain text: ${msg}`,
      );
      await this.bot.sendMessage(chatId, original).catch(() => { /* give up */ });
    }
  }

  stop() {
    for (const state of this.chats.values()) {
      this.stopTypingLoop(state);
      if (state.pendingEdit) clearTimeout(state.pendingEdit);
    }
    this.chats.clear();
    this.bot.stopPolling();
    console.log(`[agent:${this.agentId}] Telegram adapter stopped`);
  }
}
