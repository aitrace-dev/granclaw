<div align="center">

<img src="assets/granclaw-logo.png" alt="GranClaw" width="180">

# GranClaw

### Everything you wanted in OpenClaw. In one place. With Claude Code.

[Website](https://granclaw.com) · [Docs](https://granclaw.com/docs) · [Discord](https://discord.gg/granclaw)

![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)
![Node 20+](https://img.shields.io/badge/node-20%2B-brightgreen)
![Built with Claude Code](https://img.shields.io/badge/built%20with-Claude%20Code-orange)

</div>

---

GranClaw is an open-source, self-hostable agent framework for developers who actually want to see what their agents are doing. Your agents get a real desktop, a real browser, persistent memory, and a real-time dashboard you can trust. No black boxes, no gated features, no surprise bans.

Built to run on **Claude Code** — not the API. No API keys. No per-token anxiety. Just your subscription.

![GranClaw Mission Control](docs/images/mission-control.png)

---

## The Wow

<table>
<tr>
<td width="50%">

### Mission Control
Your agents ship with a built-in task board. They know how to break work into tasks, assign them, update status, and report progress — zero configuration. Open Mission Control on any agent and watch the kanban fill itself.

**Just say: "plan a LinkedIn launch week for me"** and watch the cards appear.

</td>
<td width="50%">

### Real Browser, Real Sessions
LinkedIn. Instagram. Reddit. Gmail. Your internal tools. Your agent logs in once — you save the profile — and it reuses those sessions forever. No CAPTCHA loops, no API keys for sites that don't have APIs.

**You can watch it browse in real time.** Click the Browser tab, see every page the agent loads, every click, every scroll.

</td>
</tr>
<tr>
<td width="50%">

### Secrets That Stay Secret
Your API keys never touch a .env file. Add them in the Secrets tab, injected into the agent process only at runtime. Your agents can `printenv LINKEDIN_EMAIL` — but nothing ever hits disk in the workspace.

**One place. Rotate anytime. No leaks.**

</td>
<td width="50%">

### Claude Code First
GranClaw runs on your **Claude Code subscription** — the same CLI you use every day. No API billing. No rate-limit terror. No risk of account action for "unusual usage" — because it *is* usual usage.

**Your subscription. Your agents. Your rules.**

</td>
</tr>
</table>

### Know exactly what you're spending

Every token, every session, every day. Cost estimates, cache hit rates, per-model breakdown. No surprises at the end of the month.

![Usage dashboard](docs/images/usage.png)

---

## Quick Start

```bash
git clone https://github.com/aitrace-dev/granclaw.git
cd granclaw
npm install
npm run dev
```

Open `http://localhost:5173` → **+ New Agent** → done.

**Prerequisites:** Node 20+, the `claude` CLI on your PATH ([Claude Code](https://claude.ai/download)).

---

## What's Inside

Every GranClaw agent ships with this out of the box — no setup, no plugins, no config:

### 💬 Streaming Chat
Every token streams live over WebSocket. See the agent thinking in real time. Stop it mid-action if you change your mind. Session memory survives restarts.

### 📋 Mission Control (Tasks)
A kanban board baked into every agent. Your agents already know how to create tasks, move them through states, and report back. Say "break this project into 10 tasks" and it happens.

### 🌐 Persistent Browser Sessions
Launch a real browser inside GranClaw, log in to any site once, close it. The agent reuses that profile. LinkedIn, Gmail, Instagram, Reddit, Notion, your internal dashboard — anything that runs in a browser, runs for your agent.

### 📂 Workspace Files
Each agent gets its own directory. Browse it in the UI. Read it, edit it, export it. Your agent's knowledge is yours — not trapped in a vendor database.

### 🔐 Secrets Vault
API keys, bot tokens, credentials — added in the UI, injected as environment variables only in the agent process. Never written to files. Never committed. Never leaked.

### ⚡ Workflows
Chain agent calls, code steps, and LLM calls into reusable pipelines. Run them manually or on a schedule. See every step, every input, every output.

### ⏰ Schedules
Cron-based scheduled tasks. Your agent wakes up at 9am, checks a website, writes you a summary, goes back to sleep.

### 📡 Monitor
CPU, memory, uptime for every agent process. Know instantly if something's stuck.

### 📊 Usage Tracking
Token consumption per session. No surprise bills at the end of the month.

### 📋 Datadog-Style Logs
Every message, every tool call, every result — searchable, filterable, live-polling. Expand any entry to see the full input and output. Debug what your agent actually did.

### 🛡 Guardian *(Coming Soon)*
Set up a second agent that watches the first. Define rules. Block sensitive actions. Require human approval for anything that could hurt.

---

## Why not OpenClaw?

One sentence: **because you want to sleep at night.**

GranClaw was built by developers who got tired of waiting for features they already needed, fighting vendor lock-in, and worrying about bans on accounts they were paying for. Everything here runs locally, on your machine, from code you can read.

Fork it. Modify it. Delete what you don't need. Nobody's watching.

---

## Community

- **Discord** — [join us](https://discord.gg/granclaw)
- **Issues** — [github.com/aitrace-dev/granclaw/issues](https://github.com/aitrace-dev/granclaw/issues)
- **Twitter** — [@granclaw](https://twitter.com/granclaw)

---

## License

[MIT](./LICENSE) — free forever, for any use.
