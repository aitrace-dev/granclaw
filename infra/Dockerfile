FROM node:20-slim

# Install Chromium and dependencies for agent-browser.
# ffmpeg is required by agent-browser's `record` command — without it,
# `record start` prints a success line but produces no .webm file, so the
# browser session view shows sessions with "no recording" forever.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates \
      chromium \
      curl \
      ffmpeg \
      python3-minimal \
      fonts-liberation \
      libasound2 \
      libatk-bridge2.0-0 \
      libatk1.0-0 \
      libcups2 \
      libdbus-1-3 \
      libdrm2 \
      libgbm1 \
      libgtk-3-0 \
      libnspr4 \
      libnss3 \
      libx11-xcb1 \
      libxcomposite1 \
      libxdamage1 \
      libxfixes3 \
      libxrandr2 \
      libxss1 \
      libxtst6 \
      xdg-utils \
    && rm -rf /var/lib/apt/lists/*

ENV CHROME_BIN=/usr/bin/chromium

# WhatsApp CLI (vicentereig/whatsapp-cli) — pinned static binary with
# sha256 verification. Powers the `whatsapp` skill, which uses whatsmeow
# under the hood with QR login. Session state lives per-agent under the
# workspace volume, not in the vault (see the skill's README).
ARG WHATSAPP_CLI_VERSION=v1.3.3
ARG WHATSAPP_CLI_SHA256=bb0e9fc134cf217b88d00e7ea1f6ac4ba3a288dcf79a52f1419bebae0739ccf6
RUN set -eux; \
    curl -fsSL -o /tmp/whatsapp-cli.tar.gz \
      "https://github.com/vicentereig/whatsapp-cli/releases/download/${WHATSAPP_CLI_VERSION}/whatsapp-cli-linux-amd64.tar.gz"; \
    echo "${WHATSAPP_CLI_SHA256}  /tmp/whatsapp-cli.tar.gz" | sha256sum -c -; \
    tar -xzf /tmp/whatsapp-cli.tar.gz -C /tmp/; \
    mv /tmp/whatsapp-cli-linux-amd64 /usr/local/bin/whatsapp-cli; \
    chmod +x /usr/local/bin/whatsapp-cli; \
    rm /tmp/whatsapp-cli.tar.gz

ARG GRANCLAW_VERSION=beta
RUN npm install -g granclaw@${GRANCLAW_VERSION} agent-browser @mariozechner/gmcli

VOLUME /data
ENV GRANCLAW_HOME=/data
ENV PORT=8787
EXPOSE 8787

HEALTHCHECK --interval=5s --timeout=3s --start-period=15s --retries=6 \
  CMD node -e "fetch('http://localhost:8787/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["granclaw"]
