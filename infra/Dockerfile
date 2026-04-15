FROM node:20-slim

# Install Chromium and dependencies for agent-browser.
# ffmpeg is required by agent-browser's `record` command — without it,
# `record start` prints a success line but produces no .webm file, so the
# browser session view shows sessions with "no recording" forever.
RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium \
      ffmpeg \
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

ARG GRANCLAW_VERSION=beta
RUN npm install -g granclaw@${GRANCLAW_VERSION} agent-browser

VOLUME /data
ENV GRANCLAW_HOME=/data
ENV PORT=8787
EXPOSE 8787

HEALTHCHECK --interval=5s --timeout=3s --start-period=15s --retries=6 \
  CMD node -e "fetch('http://localhost:8787/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["granclaw"]
