/**
 * agent/telegram-http-client.ts
 *
 * Minimal fetch-based Telegram Bot API client. Replaces
 * `node-telegram-bot-api` (which depends on the abandoned `request` library
 * and its vulnerable transitive deps: form-data<2.5.4, lodash, qs, tough-cookie).
 *
 * This client only implements the methods GranClaw's TelegramAdapter uses:
 *   - constructor(token, { polling })
 *   - on('message', fn) / on('polling_error', fn)
 *   - sendMessage(chatId, text, { parse_mode? })
 *   - editMessageText(text, { chat_id, message_id })
 *   - sendChatAction(chatId, action)
 *   - stopPolling()
 *
 * Long polling is done via getUpdates with `timeout=30` (Telegram's
 * recommended long-poll duration). Errors back off for 5 s before retrying
 * so a dropped network doesn't spin the loop. On stopPolling() the in-flight
 * fetch is aborted so shutdown is immediate.
 *
 * No runtime deps. Node 18+ has native fetch and AbortController.
 */

export interface TelegramMessage {
  message_id: number;
  chat: { id: number };
  text?: string;
}

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

interface TelegramApiResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
}

export type TelegramMessageHandler = (msg: TelegramMessage) => void;
export type TelegramErrorHandler = (err: Error) => void;

export interface TelegramClientOptions {
  polling?: boolean;
  /** Fetch impl override for tests. Defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
}

const LONG_POLL_TIMEOUT_SECONDS = 30;
const ERROR_BACKOFF_MS = 5000;

export class TelegramHttpClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly messageHandlers: TelegramMessageHandler[] = [];
  private readonly errorHandlers: TelegramErrorHandler[] = [];
  private offset = 0;
  private polling = false;
  private pollAbort: AbortController | null = null;

  constructor(token: string, opts: TelegramClientOptions = {}) {
    this.baseUrl = `https://api.telegram.org/bot${token}`;
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch;
    if (opts.polling) {
      this.polling = true;
      void this.pollLoop();
    }
  }

  on(event: 'message', handler: TelegramMessageHandler): this;
  on(event: 'polling_error', handler: TelegramErrorHandler): this;
  on(event: string, handler: TelegramMessageHandler | TelegramErrorHandler): this {
    if (event === 'message') {
      this.messageHandlers.push(handler as TelegramMessageHandler);
    } else if (event === 'polling_error') {
      this.errorHandlers.push(handler as TelegramErrorHandler);
    }
    return this;
  }

  async sendMessage(
    chatId: number,
    text: string,
    opts: { parse_mode?: string } = {},
  ): Promise<{ message_id: number }> {
    const body: Record<string, unknown> = { chat_id: chatId, text };
    if (opts.parse_mode) body.parse_mode = opts.parse_mode;
    const result = await this.call<{ message_id: number }>('sendMessage', body);
    return result;
  }

  async editMessageText(
    text: string,
    opts: { chat_id: number; message_id: number },
  ): Promise<true> {
    await this.call('editMessageText', {
      chat_id: opts.chat_id,
      message_id: opts.message_id,
      text,
    });
    return true;
  }

  async sendChatAction(chatId: number, action: string): Promise<true> {
    await this.call('sendChatAction', { chat_id: chatId, action });
    return true;
  }

  async stopPolling(): Promise<void> {
    this.polling = false;
    this.pollAbort?.abort();
    this.pollAbort = null;
  }

  // ── Internals ────────────────────────────────────────────────────────────

  private async call<T>(method: string, body: Record<string, unknown>): Promise<T> {
    const res = await this.fetchImpl(`${this.baseUrl}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as TelegramApiResponse<T>;
    if (!json.ok) {
      throw new Error(json.description ?? `Telegram API error (${method})`);
    }
    return json.result as T;
  }

  private async pollLoop(): Promise<void> {
    while (this.polling) {
      this.pollAbort = new AbortController();
      try {
        const url = `${this.baseUrl}/getUpdates?offset=${this.offset}&timeout=${LONG_POLL_TIMEOUT_SECONDS}`;
        const res = await this.fetchImpl(url, { signal: this.pollAbort.signal });
        if (!res.ok) {
          throw new Error(`Telegram getUpdates HTTP ${res.status}`);
        }
        const json = (await res.json()) as TelegramApiResponse<TelegramUpdate[]>;
        if (!json.ok) {
          throw new Error(json.description ?? 'Telegram getUpdates failed');
        }
        for (const update of json.result ?? []) {
          this.offset = update.update_id + 1;
          if (update.message) {
            for (const handler of this.messageHandlers) {
              try { handler(update.message); } catch { /* handler owns its errors */ }
            }
          }
        }
      } catch (err) {
        // Aborted stop is expected — exit quietly.
        const name = (err as { name?: string } | undefined)?.name;
        if (name === 'AbortError' || !this.polling) return;
        const error = err instanceof Error ? err : new Error(String(err));
        for (const handler of this.errorHandlers) {
          try { handler(error); } catch { /* ignore */ }
        }
        // Back off so a down server doesn't spin the loop.
        await new Promise((resolve) => setTimeout(resolve, ERROR_BACKOFF_MS));
      }
    }
  }
}
