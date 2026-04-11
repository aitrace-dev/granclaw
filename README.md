<div align="center">

<img src="assets/granclaw-logo.png" alt="GranClaw" width="180">

# GranClaw

### Everything you wanted in OpenClaw. In one place. Bring your own LLM.

[Website](https://granclaw.com) · [Docs](https://granclaw.com/docs) · [Discord](https://discord.gg/granclaw)

![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)
![Node 20+](https://img.shields.io/badge/node-20%2B-brightgreen)
![Bring your own LLM](https://img.shields.io/badge/LLM-bring%20your%20own-blueviolet)

</div>

---

GranClaw is a personal AI assistant you run on your own machine. Give it a browser, saved logins, persistent memory, and a real-time dashboard — then tell it what to do. It drafts your posts, runs your errands on the web, tracks your work in a kanban, and writes back to you on Telegram in your own language. Everything happens locally, on your hardware, where you can see it.

No black boxes. No gated features. No vendor lock-in. **Bring your own LLM** — OpenAI, Anthropic, Gemini, Groq, or OpenRouter. Swap providers per agent from the settings panel without restarting anything.

![GranClaw chat](docs/images/chat-streaming.png)

---

## The Wow

- **Mission Control** — a built-in kanban board every agent already knows how to use. Say _"plan a LinkedIn launch week"_ and watch the cards appear, move through states, and report back. Zero configuration.

- **Real browser, real sessions** — LinkedIn, Instagram, Reddit, Gmail, your internal tools. Log in once, save the profile, and the agent reuses it forever. No CAPTCHA loops, no API keys for sites that don't have APIs. Each agent gets its own dedicated Chrome — they never see each other's cookies.

- **Watch it browse, live or replay** — open any active session and stream the agent's screen in real time over CDP, with the active tab labeled and updating as it switches. After the session ends, the same view becomes a `<video>` of the whole turn with chapter markers for every command the agent ran.

- **Bring your own LLM** — OpenAI, Anthropic, Gemini, Groq, OpenRouter. Configure per agent, swap from the dashboard, mix providers across agents on the same machine.

- **Telegram with live UX** — messages get an instant acknowledgment in the user's language (English, Spanish, Chinese), a typing indicator while the agent thinks, and a live status board that updates as the agent runs each tool — exactly the same feel as the dashboard.

- **Obsidian-native memory** — every agent has its own **vault** of plain markdown files: daily journals, action logs, topic notes, research findings, wikilinks between everything. Open it in [Obsidian](https://obsidian.md) and browse your agent's brain like any other notebook. Your agent writes to it. You can too.

- **Export and import agents** — one click downloads a full workspace backup as a zip (vault, sqlite, profile, everything). Drop the zip on another machine and the agent comes back online — same identity, same memory, same logins.

- **Secrets that stay secret** — API keys, bot tokens, credentials added in the UI are injected as env vars only inside the agent process. Never written to files. Never committed.

- **Know what you're spending** — every token, every session, every day. Input, output, cache reads, cache writes, cost estimates, per-model breakdown. No surprises at the end of the month.

---

## See it in action

### Mission Control

Kanban tasks created by the agent itself. Drag-drop, live updates, per-agent isolation.

![Mission Control](docs/images/mission-control.png)

### Browser session replay

Every browser turn is recorded as a real WebM video plus a chapter marker for every command the agent ran. Active sessions stream live over CDP — open the tab and you see the agent's screen update in real time, with the current tab title labeled at the top.

![Browser session replay](docs/images/browser-session-player.png)

### Usage tracking

Every token, every session, every day. Per-model breakdown, cost estimates, cache hit rates.

![Usage dashboard](docs/images/usage.png)

---

## Quick Start

```bash
npx granclaw
```

Open `http://localhost:8787` → **Settings** → add an API key for your provider → **+ New Agent** → done.

**Prerequisites:** Node 20+ and an API key from any of [OpenAI](https://platform.openai.com/api-keys), [Anthropic](https://console.anthropic.com/), [Google Gemini](https://aistudio.google.com/app/apikey), [Groq](https://console.groq.com/keys), or [OpenRouter](https://openrouter.ai/keys). You only need one.

### Or install globally

```bash
npm i -g granclaw
granclaw
```

Runtime state lives in `~/.granclaw/` (override with `--home <path>` or `GRANCLAW_HOME`).

### Or run it in Docker

The whole stack ships on a single port. The container needs your provider API key and (optionally) the workspaces directory you want to mount.

```bash
docker compose up --build
```

Open `http://localhost:3002` → **Settings** → paste your API key. The host port is remappable in `docker-compose.yml` — same-origin WebSockets mean the port can be anything.

The image installs `agent-browser` and Chromium, so the host only needs Docker Desktop 4.30+.

---

## What's Inside

Every GranClaw agent ships with this out of the box — no setup, no plugins, no config:

- **💬 Streaming Chat** — tokens stream live over WebSocket. See the agent thinking in real time. Stop it mid-action. Session memory survives restarts.
- **🤖 Multi-provider LLM** — OpenAI, Anthropic, Gemini, Groq, OpenRouter. Per-agent provider + model selection. Mix and match.
- **📋 Mission Control (Tasks)** — kanban board baked into every agent. Agents create tasks, move them through states, and report back.
- **🌐 Persistent Browser Sessions** — real browser with saved logins. LinkedIn, Gmail, Notion, your internal dashboard. Each agent gets its own dedicated Chrome process, isolated cookies, and persistent profile that the next turn picks up automatically.
- **🎬 Live + Recorded Browser View** — watch the agent browse in real time over CDP, then replay each finished turn as a single WebM video with command chapter markers. Tab-following automatically rebinds the screencast when the agent switches tabs.
- **📨 Telegram with Live UX** — messages get an instant localized acknowledgment (en/es/zh), a typing indicator, and a live status board that grows as the agent runs each tool — same feel as the dashboard.
- **🧠 Obsidian Vault** — every agent has its own `vault/` of plain markdown files (daily journals, action logs, topic notes, knowledge, wikilinks). Open it in [Obsidian](https://obsidian.md) and browse your agent's brain. It's yours, not trapped in a vendor DB.
- **📦 Export & Import Agents** — one click downloads a full workspace backup as a zip with a `workspace.json` manifest. Drop it on another machine and the agent comes back online — identity, memory, profile, everything.
- **📂 Workspace Files** — each agent gets its own directory. Browse, read, edit, export — right from the dashboard.
- **🔐 Secrets Vault** — API keys, bot tokens, credentials added in the UI, injected as env vars only in the agent process.
- **⚡ Workflows** — chain agent calls, code steps, and LLM calls into reusable pipelines.
- **⏰ Schedules + Run History** — cron-based scheduled tasks. Each run gets its own channel so you can tail it live or browse historical runs from the dashboard.
- **📡 Monitor** — CPU, memory, uptime for every agent process.
- **📊 Usage Tracking** — token consumption, per-model cost breakdown, cache read/write totals, daily charts.
- **📋 Datadog-Style Logs** — searchable, filterable, live-polling. Expand any entry to see the full input and output.
- **🛡 Guardian** _(Coming Soon)_ — a second agent that watches the first. Define rules. Block sensitive actions. Require human approval.

---

## Why not OpenClaw?

One sentence: **because you want to sleep at night.**

GranClaw was built for people who got tired of waiting for features they already needed, fighting vendor lock-in, and worrying about bans on accounts they were paying for. Everything here runs locally, on your machine, from code you can read.

Fork it. Modify it. Delete what you don't need. Nobody's watching.

---

## Developing GranClaw

If you want to hack on the framework itself:

```bash
git clone https://github.com/aitrace-dev/granclaw.git
cd granclaw
npm install
npm run dev                   # backend :3001 + frontend :5173 with hot reload
```

The dev script exports `GRANCLAW_HOME=$PWD` so `agents.config.json`, `data/`, and `workspaces/` continue to resolve to the repo root — no surprise conflicts with a production `~/.granclaw` install.

Before cutting a release, run the prepublish gate locally:

```bash
npm run gate -w granclaw
```

See [CLAUDE.md](./CLAUDE.md) for the full developer guide.

---

## Community

- **Discord** — [join us](https://discord.gg/granclaw)
- **Issues** — [github.com/aitrace-dev/granclaw/issues](https://github.com/aitrace-dev/granclaw/issues)
- **Twitter** — [@granclaw](https://twitter.com/granclaw)

---

## License

[MIT](./LICENSE) — free forever, for any use.
