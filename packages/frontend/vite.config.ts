import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const backendPort = process.env.GRANCLAW_BACKEND_PORT ?? '3001';
const backendUrl = `http://localhost:${backendPort}`;
const backendWsUrl = `ws://localhost:${backendPort}`;

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Proxy only exact API paths — not SPA routes like /agents/:id/chat
      '^/agents$': backendUrl,
      '^/agents/[^/]+$': backendUrl,
      '^/agents/[^/]+/messages': backendUrl,
      '^/agents/[^/]+/files': backendUrl,
      '^/agents/[^/]+/secrets': backendUrl,
      '^/agents/[^/]+/env': backendUrl,
      '^/agents/[^/]+/tasks': backendUrl,
      '^/agents/[^/]+/browser-sessions': backendUrl,
      '^/agents/[^/]+/vault': backendUrl,
      '^/agents/[^/]+/workflows': backendUrl,
      '^/agents/[^/]+/schedules': backendUrl,
      '^/agents/[^/]+/browser-launch': backendUrl,
      '^/agents/[^/]+/browser-close': backendUrl,
      '^/agents/[^/]+/browser-profile': backendUrl,
      '^/agents/[^/]+/monitor.*': backendUrl,
      '^/agents/[^/]+/usage': backendUrl,
      '^/agents/[^/]+/skills': backendUrl,
      '^/agents/[^/]+/reset': backendUrl,
      '^/agents/[^/]+/export': backendUrl,
      '^/agents/import$': backendUrl,
      '^/logs': backendUrl,
      '^/settings': backendUrl,
      '^/search': backendUrl,
      '^/health$': backendUrl,
      // WebSocket proxy: browser → vite → backend → internal agent process.
      // ws:true tells vite to forward the Upgrade handshake.
      '^/ws/agents/.*': {
        target: backendWsUrl,
        ws: true,
        changeOrigin: true,
      },
      // Live CDP screencast relay for active browser sessions.
      '^/browser-live/.*': {
        target: backendWsUrl,
        ws: true,
        changeOrigin: true,
      },
    },
  },
});
