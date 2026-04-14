############################################################
# GranClaw — single-image, single-port test container.
#
# Ships the whole app on ONE port (3001). The backend:
#   - serves the built frontend (static files)
#   - exposes the REST API
#   - proxies /ws/agents/:id WebSocket to internal agent
#     processes (which listen on 127.0.0.1 inside the container,
#     never exposed to the host).
#
# Build deps (tsc, vite) are used only during the build stage,
# so the runtime image stays small.
############################################################

# ── Stage 1: build frontend + compile backend ─────────────────────────────
FROM node:20-slim AS builder

# Skip Playwright browser downloads — we use system Chromium at runtime.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

WORKDIR /app

COPY package.json package-lock.json* ./
COPY packages/backend/package.json ./packages/backend/
COPY packages/frontend/package.json ./packages/frontend/
COPY packages/agent/package.json ./packages/agent/

# Full install including dev deps (tsc, vite) for the build.
RUN npm install --no-audit --no-fund

# Copy source and build. `npm run build` at the root only builds backend +
# frontend — packages/agent is a legacy standalone package that is not used
# by the dev stack and doesn't need to ship in the container.
COPY packages ./packages
COPY templates ./templates
RUN npm run build

# ── Stage 2: runtime ──────────────────────────────────────────────────────
FROM node:20-slim AS runtime

# OS deps — Chromium powers the agent-browser skill; ffmpeg is required
# by agent-browser's `record` command to encode WebM session recordings.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates \
      curl \
      git \
      chromium \
      fonts-liberation \
      libnss3 \
      libxss1 \
      libasound2 \
      libgbm1 \
      libxshmfence1 \
      ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Global CLIs: claude CLI (the thing the agents actually run) and
# agent-browser (called by the browser skill).
RUN npm install -g --no-audit --no-fund \
      @anthropic-ai/claude-code \
      agent-browser \
    && claude --version \
    && agent-browser --version

ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    CHROME_BIN=/usr/bin/chromium \
    AGENT_BROWSER_CHROME_PATH=/usr/bin/chromium

# The `claude` CLI refuses to run with --dangerously-skip-permissions under
# uid 0 for security reasons, so the whole stack runs as the non-root `node`
# user that ships with the official node image.
WORKDIR /app
RUN chown -R node:node /app

# Bring in workspace manifests and install production deps only.
COPY --chown=node:node package.json package-lock.json* ./
COPY --chown=node:node packages/backend/package.json ./packages/backend/
COPY --chown=node:node packages/agent/package.json ./packages/agent/
COPY --chown=node:node packages/frontend/package.json ./packages/frontend/

USER node
RUN npm install --omit=dev --no-audit --no-fund \
    && printf '{}' > /home/node/.claude.json \
    && chmod 600 /home/node/.claude.json

# Copy compiled backend + built frontend + templates from the builder stage.
COPY --chown=node:node --from=builder /app/packages/backend/dist ./packages/backend/dist
COPY --chown=node:node --from=builder /app/packages/frontend/dist ./packages/frontend/dist
COPY --chown=node:node templates ./templates

# Runtime config. CONFIG_PATH is pinned so REPO_ROOT resolves to /app
# regardless of where the node process was started from. HOME points to
# the node user's home so claude CLI finds /home/node/.claude/.credentials.json.
ENV NODE_ENV=production \
    PORT=3001 \
    HOME=/home/node \
    CONFIG_PATH=/app/agents.config.json

# The only port the container exposes. Agents run internally on 3100+.
EXPOSE 3001

# Graceful shutdown: the backend forwards SIGTERM to agent children.
STOPSIGNAL SIGTERM

CMD ["node", "packages/backend/dist/index.js"]
