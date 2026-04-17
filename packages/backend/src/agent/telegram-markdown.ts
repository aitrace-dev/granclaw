/**
 * agent/telegram-markdown.ts
 *
 * Shared formatter for outbound Telegram messages. Both paths — the
 * TelegramAdapter's reply-to-inbound flow and the telegram_send agent tool
 * — go through sendFormattedTelegramMessage so users see the same nicely
 * formatted output regardless of how the message was initiated.
 *
 * Pipeline:
 *  1. flattenMarkdownTables — Telegram MarkdownV2 has no table support, and
 *     telegramify-markdown escapes table internals in ways Telegram rejects.
 *     Flatten them into "key: value" lines before any escaping.
 *  2. Chunk at newline boundaries to fit Telegram's 4096-char limit.
 *  3. telegramifyMarkdown(chunk, 'escape') — convert standard markdown into
 *     MarkdownV2 with proper escapes.
 *  4. Send with parse_mode: 'MarkdownV2'. On any API error (unsupported
 *     escape, link issue, etc.) fall back to the ORIGINAL unescaped chunk
 *     as plain text so users never see backslash-soup.
 */

import telegramifyMarkdown from 'telegramify-markdown';
import { flattenMarkdownTables } from '../lib/flatten-markdown-tables.js';
import type { TelegramHttpClient } from './telegram-http-client.js';

const MAX_CHARS = 4000;

export async function sendFormattedTelegramMessage(
  bot: TelegramHttpClient,
  chatId: number,
  text: string,
): Promise<void> {
  const flattened = flattenMarkdownTables(text);

  // Chunk the ORIGINAL (flattened) text at newline boundaries BEFORE
  // escaping. Each chunk is sent individually so one bad MarkdownV2 run
  // doesn't take down the whole message.
  const chunks: string[] = [];
  let remaining = flattened;
  while (remaining.length > MAX_CHARS) {
    const slice = remaining.slice(0, MAX_CHARS);
    const splitAt = slice.lastIndexOf('\n') > MAX_CHARS / 2 ? slice.lastIndexOf('\n') : MAX_CHARS;
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }
  if (remaining.length > 0) chunks.push(remaining);
  if (chunks.length === 0) return;

  for (const chunk of chunks) {
    await sendChunkWithFallback(bot, chatId, chunk);
  }
}

async function sendChunkWithFallback(
  bot: TelegramHttpClient,
  chatId: number,
  original: string,
): Promise<void> {
  let escaped: string;
  try {
    escaped = telegramifyMarkdown(original, 'escape');
  } catch (err) {
    // telegramify-markdown itself crashed — go straight to plain text.
    console.warn(
      `[telegram-markdown] telegramify-markdown threw, sending plain text: ${(err as Error).message}`,
    );
    await bot.sendMessage(chatId, original).catch(() => { /* give up */ });
    return;
  }
  try {
    await bot.sendMessage(chatId, escaped, { parse_mode: 'MarkdownV2' });
  } catch (err) {
    // Typical causes: unsupported escape sequence (e.g. `\|` which is not
    // a valid MarkdownV2 escape), nesting limits, or link URLs with an
    // unescaped `)`. Log the reason and send the unescaped ORIGINAL so
    // the user sees a clean message instead of backslash-soup.
    const msg = (err as Error).message ?? String(err);
    console.warn(
      `[telegram-markdown] MarkdownV2 send failed, falling back to plain text: ${msg}`,
    );
    await bot.sendMessage(chatId, original).catch(() => { /* give up */ });
  }
}
