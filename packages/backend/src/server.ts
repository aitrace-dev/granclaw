/**
 * server.ts — Express + WebSocket server
 *
 * WebSocket protocol (messages are JSON strings):
 *
 *   Client → Server:
 *     { type: 'message', agentId: string, text: string }
 *
 *   Server → Client:
 *     { type: 'chunk',   agentId, chunk: StreamChunk }
 *     { type: 'error',   agentId, message: string }
 *     { type: 'agents',  agents: AgentSummary[] }   (broadcast on change)
 */

import express from 'express';
import cors from 'cors';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import agentsRouter from './routes/agents.js';
import logsRouter from './routes/logs.js';
import { getAgent } from './config.js';
import { runAgent } from './agent-runner.js';

export function createServer() {
  const app = express();
  app.use(cors());
  app.use(express.json());

  // REST routes
  app.use('/agents', agentsRouter);
  app.use('/logs', logsRouter);

  app.get('/health', (_req, res) => res.json({ ok: true }));

  // ── WebSocket ─────────────────────────────────────────────────────────────
  const httpServer = http.createServer(app);
  const wss = new WebSocketServer({ server: httpServer });

  wss.on('connection', (ws: WebSocket) => {
    console.log('[ws] client connected');

    ws.on('message', async (raw) => {
      let msg: { type: string; agentId?: string; text?: string };
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        ws.send(JSON.stringify({ type: 'error', message: 'invalid JSON' }));
        return;
      }

      if (msg.type === 'message') {
        const { agentId, text } = msg;
        if (!agentId || !text) {
          ws.send(JSON.stringify({ type: 'error', message: 'agentId and text required' }));
          return;
        }

        const agent = getAgent(agentId);
        if (!agent) {
          ws.send(JSON.stringify({ type: 'error', agentId, message: `Agent ${agentId} not found` }));
          return;
        }

        try {
          await runAgent(agent, text, (chunk) => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: 'chunk', agentId, chunk }));
            }
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'error', agentId, message }));
          }
        }
      }
    });

    ws.on('close', () => console.log('[ws] client disconnected'));
  });

  return httpServer;
}
