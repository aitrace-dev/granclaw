/**
 * agent/process.ts
 *
 * Standalone agent process — spawned by the orchestrator, one per agent.
 *
 * Architecture:
 *   WS server  →  receives messages  →  [BB evaluate]  →  enqueue()
 *   Queue worker (poll loop)          →  dequeueNext() → runAgent() → broadcastToChannel chunks
 *
 * WebSocket protocol:
 *   Client → Agent:  { type: 'message', text: string, channelId?: string }
 *   Agent  → Client: { type: 'queued' }
 *                    { type: 'chunk', chunk: StreamChunk }
 *                    { type: 'error', message: string }
 *                    { type: 'blocked', reason: string }
 */

import 'dotenv/config';
import { WebSocketServer, WebSocket } from 'ws';
import { randomUUID } from 'crypto';
import path from 'path';
import { getAgent, REPO_ROOT } from '../config.js';
import { enqueue, dequeueNext, markDone, markFailed, cleanupStaleJobs } from '../agent-db.js';
import { runAgent, stopAgent, bootstrapWorkspace } from './runner-pi.js';
import { saveMessage, getProactiveMessagesSinceLastUser } from '../messages-db.js';
import { TelegramAdapter } from './telegram-adapter.js';
import { forceCloseActiveSession } from '../browser-sessions.js';
import { assembleAssistantMessage, type AssistantChunk } from './message-assembly.js';
import {
  hasTakeover,
  cancelTakeoverTimer,
  updateTakeoverTimer,
  TAKEOVER_TIMEOUT_MS,
} from '../takeover-state.js';
import { handleTakeoverTimeout } from '../takeover-timeout.js';

const agentId = process.env.AGENT_ID;
const port = Number(process.env.AGENT_PORT);

if (!agentId || !port) {
  console.error('[agent/process] AGENT_ID and AGENT_PORT env vars are required');
  process.exit(1);
}

// ── Main ───────────────────────────────────────────────────────────────────────

function main() {
  const agent = getAgent(agentId as string);
  if (!agent) {
    console.error(`[agent/process] Agent "${agentId}" not found in agents.config.json`);
    process.exit(1);
  }

  const workspaceDir = path.resolve(REPO_ROOT, agent.workspaceDir);

  // Eager bootstrap on startup: syncs skills from the image template dir
  // BEFORE the first user turn, so "[runner-pi] synced skill ..." and any
  // frontmatter-validation warnings land in docker logs at container start
  // instead of only after a message has been processed. runAgent() also
  // calls bootstrapWorkspace() defensively on every turn, but the per-
  // process memoisation there makes it a no-op after this call.
  bootstrapWorkspace(workspaceDir, agentId);

  // Clean up stale 'processing' jobs from previous crashes/restarts
  const cleaned = cleanupStaleJobs(workspaceDir);
  if (cleaned > 0) console.log(`[agent:${agentId}] cleaned up ${cleaned} stale processing jobs`);

  // ── WebSocket server ───────────────────────────────────────────────────────
  const wss = new WebSocketServer({ port });

  // Map from channelId → set of WS clients subscribed to that channel
  const channelClients = new Map<string, Set<WebSocket>>();

  function getChannelClients(channelId: string): Set<WebSocket> {
    if (!channelClients.has(channelId)) channelClients.set(channelId, new Set());
    return channelClients.get(channelId)!;
  }

  wss.on('connection', (ws) => {
    let clientChannelId = 'ui'; // default until client sends a message with channelId
    console.log(`[agent:${agentId}] client connected`);

    ws.on('message', (raw) => {
      let msg: { type: string; text?: string; channelId?: string };
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        ws.send(JSON.stringify({ type: 'error', message: 'invalid JSON' }));
        return;
      }

      if (msg.type === 'stop') {
        const stopped = stopAgent(agentId as string);
        console.log(`[agent:${agentId}] stop requested — ${stopped ? 'killed' : 'no active process'}`);
        ws.send(JSON.stringify({ type: 'stopped', killed: stopped }));
      } else if (msg.type === 'subscribe' && msg.channelId) {
        // Subscribe this WS client to a channel without sending a message.
        // Used by the frontend to receive live chunks from scheduled runs.
        clientChannelId = msg.channelId;
        getChannelClients(clientChannelId).add(ws);
      } else if (msg.type === 'message' && msg.text) {
        clientChannelId = msg.channelId ?? 'ui';
        getChannelClients(clientChannelId).add(ws);

        enqueue(workspaceDir, agentId as string, msg.text, clientChannelId);
        ws.send(JSON.stringify({ type: 'queued' }));
      }
    });

    ws.on('close', () => {
      // Remove from whichever channel set it was in
      for (const [id, set] of channelClients.entries()) {
        set.delete(ws);
        if (set.size === 0) channelClients.delete(id);
      }
      console.log(`[agent:${agentId}] client disconnected`);
    });
  });

  console.log(`[agent:${agentId}] WS listening on ws://localhost:${port}`);

  // ── Telegram adapter ───────────────────────────────────────────────────────
  // Started automatically if TELEGRAM_BOT_TOKEN is set (via Secrets in the UI).
  // The user adds TELEGRAM_BOT_TOKEN as a secret → orchestrator injects it as
  // an env var when spawning this process → adapter picks it up here.
  let telegramAdapter: TelegramAdapter | null = null;
  const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN;
  if (telegramBotToken) {
    telegramAdapter = new TelegramAdapter(agentId as string, telegramBotToken, workspaceDir);
  }

  // ── Queue worker ───────────────────────────────────────────────────────────
  function broadcastToChannel(channelId: string, data: unknown) {
    const json = JSON.stringify(data);
    const targets = channelClients.get(channelId);
    if (!targets) return;
    for (const ws of targets) {
      if (ws.readyState === WebSocket.OPEN) ws.send(json);
    }
  }

  // Track busy state per channel type so UI chat can run while workflows/schedules execute
  const busyChannels = new Set<string>();

  function channelType(channelId: string): string {
    if (channelId.startsWith('wf-')) return 'workflow';
    if (channelId === 'schedule') return 'schedule';
    return channelId; // 'ui', 'telegram:xxx' — each is its own lane
  }

  async function processNext() {
    const job = dequeueNext(workspaceDir, agentId as string, busyChannels);
    if (!job) return;

    const lane = channelType(job.channelId);
    busyChannels.add(lane);
    try {
      const isTelegramJob = telegramAdapter !== null && job.channelId.startsWith('telegram:');

      // Save the prompt so it's visible in run history immediately
      try {
        saveMessage({ id: randomUUID(), agentId: agentId as string, channelId: job.channelId, role: 'user', content: job.message });
      } catch { /* non-fatal */ }

      // Stream chunks directly to channel clients.
      //
      // tool_call rows are persisted to the DB the moment they arrive
      // (not batched at turn end). Reason: if a user leaves the chat view
      // mid-turn and navigates to /dashboard, ChatPage unmounts and loses
      // its in-memory streaming state. On return, it refetches history
      // from the DB — if tool_calls were still buffered in memory, the
      // user would see an empty chat while the agent was clearly still
      // working. Persisting as-they-happen makes the live state
      // refetchable. See regression A (view-switch-state.spec.ts).
      // Buffer streamed chunks so we can assemble the final assistant message
      // with proper paragraph breaks between text blocks bracketing tool_calls.
      // See agent/message-assembly.ts — fixes bluggie's "first.I can see" run-on.
      const chunkBuffer: AssistantChunk[] = [];
      let toolCallCount = 0;

      // Inject context message if a human takeover was pending
      let messageText = job.message;
      if (hasTakeover(agentId as string)) {
        cancelTakeoverTimer(agentId as string); // stop 10min timeout — entry stays for runner-pi to restore handle
        messageText =
          `[User completed browser interaction]\n` +
          `User said: "${job.message}"`;
      }

      // Telegram cross-channel context: if the agent proactively sent
      // messages to this telegram chat (via telegram_send from some OTHER
      // channel's turn), the pi session for THIS channel doesn't know
      // about them. Without this, a user reply like "Yes ship it" leaves
      // the agent clueless about what "it" is. Prepend the proactive
      // messages so the model has the full thread.
      if (job.channelId.startsWith('telegram:')) {
        const proactive = getProactiveMessagesSinceLastUser(agentId as string, job.channelId);
        if (proactive.length > 0) {
          const lines = proactive.map((m, i) => {
            const ts = new Date(m.createdAt).toISOString().slice(11, 16) + ' UTC';
            return `  ${i + 1}. [${ts}] ${m.content}`;
          }).join('\n');
          messageText =
            `[System: since your last Telegram exchange you proactively sent the user these messages ` +
            `(they are not in your conversation history but the user received them):\n${lines}\n` +
            `]\n\n` +
            `User's new reply: ${messageText}`;
        }
      }

      await runAgent(agent!, messageText, (chunk) => {
        broadcastToChannel(job.channelId, { type: 'chunk', chunk });
        if (chunk.type === 'text') {
          chunkBuffer.push({ type: 'text', text: chunk.text });
          if (isTelegramJob) {
            telegramAdapter!.appendChunk(job.channelId, chunk.text);
          }
        }
        if ((chunk as any).type === 'takeover_requested') {
          const takeoverUrl = (chunk as any).takeoverUrl as string;
          if (isTelegramJob) {
            telegramAdapter!.notifyTakeover(job.channelId, takeoverUrl);
          } else {
            // For UI/WebSocket channels inject the URL as a text chunk so it
            // appears inline in the streaming response.
            broadcastToChannel(job.channelId, {
              type: 'chunk',
              chunk: { type: 'text', text: `\n\n🔗 **Takeover link:** ${takeoverUrl}\n\n` },
            });
          }
        }
        if (chunk.type === 'tool_call') {
          const tcString = `${chunk.tool}(${JSON.stringify(chunk.input)})`;
          chunkBuffer.push({ type: 'tool_call', tool: chunk.tool, input: chunk.input });
          toolCallCount++;
          try {
            saveMessage({
              id: randomUUID(),
              agentId: agentId as string,
              channelId: job.channelId,
              role: 'tool_call',
              content: tcString,
            });
          } catch { /* non-fatal — WAL/locking can fail under parallel writes */ }
          if (isTelegramJob) {
            // Live status update — appears in the user's chat as the
            // acknowledgment message gets edited to show progress.
            void telegramAdapter!.appendToolStep(job.channelId, chunk.tool);
          }
        }
      }, { channelId: job.channelId });

      // Persist the final assistant message. tool_call rows were already
      // saved one-by-one above, so no batch here.
      const fullResponse = assembleAssistantMessage(chunkBuffer);
      try {
        if (fullResponse) {
          saveMessage({
            id: randomUUID(),
            agentId: agentId as string,
            channelId: job.channelId,
            role: 'assistant',
            content: fullResponse,
            createdAt: Date.now() + toolCallCount, // ordered after the last tool_call
          });
        }
      } catch { /* non-fatal */ }

      markDone(workspaceDir, job.id);

      // Arm 10-minute timeout if the agent registered a takeover during this run
      if (hasTakeover(agentId as string)) {
        const timer = setTimeout(() => {
          handleTakeoverTimeout(agentId as string, workspaceDir).catch((err) => {
            console.error(`[agent:${agentId}] takeover timeout callback failed`, err);
          });
        }, TAKEOVER_TIMEOUT_MS);
        updateTakeoverTimer(agentId as string, timer);
      }

      // Belt-and-suspenders: if the agent left a browser session open (e.g.
      // forgot to call close), finalize it so recordings don't stay "active"
      // forever and stream subscribers detach cleanly.
      // Skip if a human takeover is pending — browser session must stay alive
      if (!hasTakeover(agentId as string)) {
        forceCloseActiveSession(agentId as string);
      }

      // Send the full reply back to Telegram once the turn is complete
      if (isTelegramJob) {
        await telegramAdapter!.flushReply(job.channelId);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      markFailed(workspaceDir, job.id);
      broadcastToChannel(job.channelId, { type: 'error', message });
      if (telegramAdapter && job.channelId.startsWith('telegram:')) {
        const chatId = parseInt(job.channelId.split(':')[1], 10);
        if (!isNaN(chatId)) {
          await telegramAdapter.sendErrorMessage(chatId, 'Sorry, something went wrong. Please try again.').catch(() => {});
        }
      }
    } finally {
      busyChannels.delete(lane);
    }
  }

  setInterval(() => { processNext().catch(console.error); }, 300);
}

main();
