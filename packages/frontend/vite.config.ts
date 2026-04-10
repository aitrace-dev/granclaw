import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Proxy only exact API paths — not SPA routes like /agents/:id/chat
      '^/agents$': 'http://localhost:3001',
      '^/agents/[^/]+$': 'http://localhost:3001',
      '^/agents/[^/]+/messages': 'http://localhost:3001',
      '^/agents/[^/]+/files': 'http://localhost:3001',
      '^/agents/[^/]+/secrets': 'http://localhost:3001',
      '^/agents/[^/]+/env': 'http://localhost:3001',
      '^/agents/[^/]+/tasks': 'http://localhost:3001',
      '^/agents/[^/]+/browser-sessions': 'http://localhost:3001',
      '^/agents/[^/]+/vault': 'http://localhost:3001',
      '^/agents/[^/]+/workflows': 'http://localhost:3001',
      '^/agents/[^/]+/schedules': 'http://localhost:3001',
      '^/agents/[^/]+/browser-launch': 'http://localhost:3001',
      '^/agents/[^/]+/browser-close': 'http://localhost:3001',
      '^/agents/[^/]+/browser-profile': 'http://localhost:3001',
      '^/agents/[^/]+/monitor.*': 'http://localhost:3001',
      '^/agents/[^/]+/usage': 'http://localhost:3001',
      '^/agents/[^/]+/skills': 'http://localhost:3001',
      '^/agents/[^/]+/reset': 'http://localhost:3001',
      '^/logs': 'http://localhost:3001',
      '^/settings': 'http://localhost:3001',
      '^/search': 'http://localhost:3001',
      '^/health$': 'http://localhost:3001',
      // WebSocket proxy: browser → vite → backend → internal agent process.
      // ws:true tells vite to forward the Upgrade handshake.
      '^/ws/agents/.*': {
        target: 'ws://localhost:3001',
        ws: true,
        changeOrigin: true,
      },
    },
  },
});
