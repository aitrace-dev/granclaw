# granclaw

> A personal AI assistant you run on your own machine. Built on the Claude Code CLI.

## Install

```bash
npx granclaw
```

or globally:

```bash
npm i -g granclaw
granclaw
```

Requires **Node 20+** and the [Claude Code CLI](https://claude.ai/download) on `PATH`.

## Usage

```
granclaw [start] [options]

Options:
  --port <n>      Listen on port n (default: 8787; env: PORT)
  --home <path>   GranClaw home directory (default: ~/.granclaw; env: GRANCLAW_HOME)
  --version       Print the version
  --help          Print this message
```

On first run, GranClaw creates `~/.granclaw/` containing:

```
agents.config.json    ← your agents (empty by default)
data/                 ← SQLite databases
workspaces/           ← per-agent working directories
logs/                 ← CLI process logs
```

Open the dashboard at <http://localhost:8787> and create your first agent.

## What's inside

- **Streaming chat** with Claude Code, tokens live over WebSocket
- **Mission Control** kanban board every agent knows how to drive
- **Persistent browser sessions** — saved logins, DOM replay, screenshots
- **Obsidian-compatible vault** — each agent keeps its own plain-markdown brain
- **Secrets vault** — API keys injected as env vars only inside the agent process
- **Schedules** — cron-based scheduled tasks with per-agent isolation
- **Usage tracking** — token cost breakdown per agent and per model

## Links

- 🌐 [granclaw.com](https://granclaw.com)
- 💻 [github.com/aitrace-dev/granclaw](https://github.com/aitrace-dev/granclaw)
- 🐛 [Issues](https://github.com/aitrace-dev/granclaw/issues)

## License

MIT
