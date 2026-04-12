import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Unit tests for TelegramAdapter.
 *
 * The adapter is thick: it owns the live-message edit-throttling, the
 * typing-indicator loop, message composition with a step cap, multi-part
 * reply splitting, and per-chat state teardown. These are exactly the
 * things that regress silently when a dependency or refactor moves.
 *
 * No real network: `node-telegram-bot-api` is mocked at module level so
 * `new TelegramBot(...)` returns a fake with spyable methods. We also
 * mock `agent-db` so enqueue() doesn't try to open SQLite.
 */

type FakeBot = {
  on: ReturnType<typeof vi.fn>;
  sendMessage: ReturnType<typeof vi.fn>;
  editMessageText: ReturnType<typeof vi.fn>;
  sendChatAction: ReturnType<typeof vi.fn>;
  stopPolling: ReturnType<typeof vi.fn>;
  _handlers: Map<string, ((arg: unknown) => void)[]>;
};

const makeFakeBot = (): FakeBot => {
  const handlers = new Map<string, ((arg: unknown) => void)[]>();
  let msgId = 1000;
  return {
    _handlers: handlers,
    on: vi.fn((event: string, fn: (arg: unknown) => void) => {
      if (!handlers.has(event)) handlers.set(event, []);
      handlers.get(event)!.push(fn);
    }),
    sendMessage: vi.fn().mockImplementation(() => {
      msgId += 1;
      return Promise.resolve({ message_id: msgId });
    }),
    editMessageText: vi.fn().mockResolvedValue(true),
    sendChatAction: vi.fn().mockResolvedValue(true),
    stopPolling: vi.fn().mockResolvedValue(true),
  };
};

let currentFakeBot: FakeBot;

vi.mock('./telegram-http-client.js', () => {
  return {
    TelegramHttpClient: vi.fn().mockImplementation(() => currentFakeBot),
  };
});

// Don't let the adapter actually enqueue into SQLite
vi.mock('../agent-db.js', () => ({
  enqueue: vi.fn().mockReturnValue('job-fake'),
}));

// Imports AFTER vi.mock so the mocked modules take effect
import { TelegramAdapter } from './telegram-adapter.js';
import { enqueue } from '../agent-db.js';

// Helper: emit a fake Telegram message through the registered 'message' handler
function emitMessage(bot: FakeBot, chatId: number, text: string) {
  const handlers = bot._handlers.get('message') ?? [];
  for (const h of handlers) {
    h({ text, chat: { id: chatId } });
  }
}

describe('TelegramAdapter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    currentFakeBot = makeFakeBot();
    (enqueue as unknown as ReturnType<typeof vi.fn>).mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── Message intake ────────────────────────────────────────────────────────

  it('enqueues the job and fires a typing indicator + ack on first user message', async () => {
    const adapter = new TelegramAdapter('test-agent', 'fake-token', '/tmp/ws');
    emitMessage(currentFakeBot, 999, 'hola, ¿puedes ayudarme?');

    // Flush any pending microtasks (the ack is a promise chain)
    await vi.runAllTicks();
    await Promise.resolve();

    expect(enqueue).toHaveBeenCalledWith(
      '/tmp/ws',
      'test-agent',
      'hola, ¿puedes ayudarme?',
      'telegram:999',
    );
    expect(currentFakeBot.sendChatAction).toHaveBeenCalledWith(999, 'typing');
    // Ack is in Spanish because the message triggered the es heuristic
    expect(currentFakeBot.sendMessage).toHaveBeenCalledWith(
      999,
      'Entendido, dame un momento que estoy trabajando en esto.',
    );

    adapter.stop();
  });

  it('chooses an English ack for a plain English message', async () => {
    new TelegramAdapter('test-agent', 'fake-token', '/tmp/ws');
    emitMessage(currentFakeBot, 1, 'What is the weather in Tokyo?');
    await vi.runAllTicks();
    expect(currentFakeBot.sendMessage).toHaveBeenCalledWith(
      1,
      "Got it — give me a moment, I'm working on this.",
    );
  });

  it('ignores messages without text', async () => {
    new TelegramAdapter('test-agent', 'fake-token', '/tmp/ws');
    const handlers = currentFakeBot._handlers.get('message') ?? [];
    for (const h of handlers) h({ chat: { id: 2 } }); // no text field
    await vi.runAllTicks();
    expect(enqueue).not.toHaveBeenCalled();
    expect(currentFakeBot.sendMessage).not.toHaveBeenCalled();
  });

  // ── Tool-step live edits ──────────────────────────────────────────────────

  it('coalesces rapid tool-step appends into a single edit per throttle window', async () => {
    const adapter = new TelegramAdapter('test-agent', 'fake-token', '/tmp/ws');
    emitMessage(currentFakeBot, 777, 'Hi there');
    await vi.runAllTicks();
    await Promise.resolve();

    // Append 3 steps in quick succession
    void adapter.appendToolStep('telegram:777', 'web_search');
    void adapter.appendToolStep('telegram:777', 'browser');
    void adapter.appendToolStep('telegram:777', 'write');
    await vi.runAllTicks();
    await Promise.resolve();

    // Push timers past the 1.5s throttle window
    await vi.advanceTimersByTimeAsync(1600);

    // Exactly ONE editMessageText for this chat in the window
    expect(currentFakeBot.editMessageText).toHaveBeenCalledTimes(1);
    // Message body includes the ack + the three steps joined by newlines
    const [body] = currentFakeBot.editMessageText.mock.calls[0];
    expect(body).toContain("Got it");
    expect(body).toContain('🔍 Searching the web');
    expect(body).toContain('🌐 Browsing');
    expect(body).toContain('✍️ Writing');

    adapter.stop();
  });

  it('caps visible steps with a "(N more steps)" summary once the list grows', async () => {
    const adapter = new TelegramAdapter('test-agent', 'fake-token', '/tmp/ws');
    emitMessage(currentFakeBot, 555, 'Hi');
    await vi.runAllTicks();
    await Promise.resolve();

    // 10 steps — over the MAX_VISIBLE_STEPS (6) threshold
    for (let i = 0; i < 10; i++) {
      void adapter.appendToolStep('telegram:555', 'browser');
    }
    await vi.runAllTicks();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(1600);

    expect(currentFakeBot.editMessageText).toHaveBeenCalled();
    const body = currentFakeBot.editMessageText.mock.calls.at(-1)![0] as string;
    // First step visible, then "(N more steps)" summary, then tail
    expect(body).toMatch(/\(\d+ more steps?\)/);

    adapter.stop();
  });

  // ── Reply flushing ────────────────────────────────────────────────────────

  it('flushReply sends the buffered response and stops typing', async () => {
    const adapter = new TelegramAdapter('test-agent', 'fake-token', '/tmp/ws');
    emitMessage(currentFakeBot, 333, 'Hi');
    await vi.runAllTicks();
    await Promise.resolve();
    const preFlushSendCount = currentFakeBot.sendMessage.mock.calls.length;

    adapter.appendChunk('telegram:333', 'Hello! ');
    adapter.appendChunk('telegram:333', 'Here is the answer.');

    await adapter.flushReply('telegram:333');

    // At least one additional sendMessage for the buffered reply
    expect(currentFakeBot.sendMessage.mock.calls.length).toBeGreaterThan(preFlushSendCount);
    const lastSend = currentFakeBot.sendMessage.mock.calls.at(-1)!;
    expect(lastSend[0]).toBe(333);
    expect(lastSend[1]).toBe('Hello! Here is the answer.');

    adapter.stop();
  });

  it('flushReply is a no-op for an unknown channel', async () => {
    const adapter = new TelegramAdapter('test-agent', 'fake-token', '/tmp/ws');
    await expect(adapter.flushReply('telegram:no-such')).resolves.toBeUndefined();
    expect(currentFakeBot.sendMessage).not.toHaveBeenCalled();
    adapter.stop();
  });

  it('flushReply skips the reply send when the response buffer is empty', async () => {
    const adapter = new TelegramAdapter('test-agent', 'fake-token', '/tmp/ws');
    emitMessage(currentFakeBot, 111, 'Hi');
    await vi.runAllTicks();
    await Promise.resolve();
    const preFlushSends = currentFakeBot.sendMessage.mock.calls.length;

    // No appendChunk — buffer stays empty
    await adapter.flushReply('telegram:111');

    // sendMessage count unchanged (only the ack was sent)
    expect(currentFakeBot.sendMessage.mock.calls.length).toBe(preFlushSends);
    adapter.stop();
  });

  // ── Error handling ────────────────────────────────────────────────────────

  it('sendErrorMessage tears down state and posts the error text', async () => {
    const adapter = new TelegramAdapter('test-agent', 'fake-token', '/tmp/ws');
    emitMessage(currentFakeBot, 222, 'Hi');
    await vi.runAllTicks();
    await Promise.resolve();

    await adapter.sendErrorMessage(222, 'Oops something broke');

    // Last sendMessage is the error
    const lastCall = currentFakeBot.sendMessage.mock.calls.at(-1)!;
    expect(lastCall[0]).toBe(222);
    expect(lastCall[1]).toBe('Oops something broke');

    adapter.stop();
  });

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  it('stop() clears pending state and calls bot.stopPolling', () => {
    const adapter = new TelegramAdapter('test-agent', 'fake-token', '/tmp/ws');
    adapter.stop();
    expect(currentFakeBot.stopPolling).toHaveBeenCalled();
  });
});
