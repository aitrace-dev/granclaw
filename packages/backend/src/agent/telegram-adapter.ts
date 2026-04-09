/**
 * agent/telegram-adapter.ts
 *
 * Bridges the Telegram Bot API into the agent's internal queue.
 *
 * Flow:
 *   Telegram user sends message
 *   → adapter receives it via polling
 *   → enqueues it with channelId: 'telegram:<chatId>'
 *   → processNext runs it through Claude
 *   → response chunks broadcast to that channelId (no WS clients, just internal)
 *   → adapter sends full response back to Telegram chat
 *
 * One instance per agent process. Only started when telegram.enabled = true in config.
 */

import TelegramBot from 'node-telegram-bot-api';
import { enqueue } from '../agent-db.js';

export class TelegramAdapter {
  private bot: TelegramBot;
  private agentId: string;
  private workspaceDir: string;
  // channelId → accumulated response text for the current in-flight job
  private responseBuffers = new Map<string, string>();

  constructor(agentId: string, botToken: string, workspaceDir: string) {
    this.agentId = agentId;
    this.workspaceDir = workspaceDir;
    this.bot = new TelegramBot(botToken, { polling: true });
    this.setupHandlers();
    console.log(`[agent:${agentId}] Telegram adapter started`);
  }

  private setupHandlers() {
    this.bot.on('message', async (msg) => {
      if (!msg.text) return;
      const chatId = msg.chat.id;
      const channelId = `telegram:${chatId}`;
      console.log(`[agent:${this.agentId}] Telegram message from chat ${chatId}`);
      enqueue(this.workspaceDir, this.agentId, msg.text, channelId);
      // Let the user know their message was received while Claude processes it
      this.bot.sendMessage(chatId, '...').catch(() => {});
    });

    this.bot.on('polling_error', (err) => {
      console.error(`[agent:${this.agentId}] Telegram polling error:`, err.message);
    });
  }

  /**
   * Called by processNext for each text chunk from a telegram:<chatId> job.
   * Accumulates text and sends the complete reply when the job is done.
   */
  appendChunk(channelId: string, text: string) {
    const current = this.responseBuffers.get(channelId) ?? '';
    this.responseBuffers.set(channelId, current + text);
  }

  /**
   * Send the accumulated response for a channel and clear the buffer.
   */
  async flushReply(channelId: string): Promise<void> {
    const text = this.responseBuffers.get(channelId) ?? '';
    this.responseBuffers.delete(channelId);
    if (!text.trim()) return;
    const chatId = parseInt(channelId.split(':')[1], 10);
    if (isNaN(chatId)) return;
    await this.sendReply(chatId, text);
  }

  async sendErrorMessage(chatId: number, text: string): Promise<void> {
    await this.bot.sendMessage(chatId, text).catch(() => {});
  }

  private async sendReply(chatId: number, text: string): Promise<void> {
    const MAX = 4000;
    if (text.length <= MAX) {
      await this.bot.sendMessage(chatId, text, { parse_mode: 'Markdown' }).catch(() =>
        this.bot.sendMessage(chatId, text)
      );
      return;
    }
    // Split long responses on newlines
    let remaining = text;
    while (remaining.length > 0) {
      const chunk = remaining.slice(0, MAX);
      const splitAt = chunk.lastIndexOf('\n') > MAX / 2 ? chunk.lastIndexOf('\n') : MAX;
      await this.bot.sendMessage(chatId, remaining.slice(0, splitAt)).catch(() => {});
      remaining = remaining.slice(splitAt).trimStart();
    }
  }

  stop() {
    this.bot.stopPolling();
    console.log(`[agent:${this.agentId}] Telegram adapter stopped`);
  }
}
