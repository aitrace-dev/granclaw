# GranClaw

Multi-agent AI framework. Minimal by design — the entire codebase should be readable.

## CRITICAL: NEVER wipe or reset the main-agent

**NEVER call the reset endpoint on `main-agent`.** The main-agent is a configured, onboarded agent with workflows, schedules, vault data, browser profiles, and conversation history. Wiping it destroys hours of configuration and data that cannot be recovered.

**If you need to test, create a separate test agent.** Add a temporary entry to `agents.config.json` with a different ID (e.g., `test-agent`), run your tests against that, and delete it when done. NEVER use `main-agent` for testing.

**This applies to:**
- E2E tests — NEVER reset main-agent in beforeAll/beforeEach
- Manual testing — use a separate agent ID
- Any code that calls `DELETE /agents/main-agent/reset`

## CRITICAL: NEVER wipe or reset the main-agent (repeated for emphasis)

If you are about to run a test that resets an agent, **stop and verify the agent ID is NOT main-agent**. Create a disposable test agent instead.

## IMPORTANT: Check the vault first

**Before assuming something doesn't exist, read `vault/index.md` and the relevant wiki page.** The vault documents what's already built, architectural decisions, and current state. Many features (Telegram, Secrets, Settings UI) are already fully implemented.

```
vault/
  index.md              ← start here
  wiki/                 ← architecture, services, concepts
  decisions/            ← ADRs
  findings/             ← bugs and surprises
  secrets/              ← gitignored, local-only
```

## Quick start

```bash
cp .env.example .env
npm install
npm run dev                   # backend :3001 + frontend :5173
```

**Prerequisites:** Node 20+, `claude` CLI on PATH (Claude Code subscription).

---

## Architecture in one paragraph

The **backend** (`packages/backend`) is an Express + WebSocket server. When a user sends a message through the dashboard, the backend spawns the `claude` CLI as a child process with `--output-format stream-json`, parses the streamed JSON output, and forwards each chunk back to the browser over WebSocket in real time. Session IDs are persisted in SQLite so conversations survive restarts. Every agent action (message in, tool call, tool result) is logged to SQLite. All agent configuration lives in `agents.config.json` at the root — no config in the database.

---

## Key files

| File | What it does |
|---|---|
| `agents.config.json` | Defines every agent: id, model, tools, workspace dir. Config as code — edit this file to change agent behaviour. |
| `packages/backend/src/agent/runner.ts` | **Core.** Spawns the `claude` CLI, streams JSON output, persists session IDs. Bootstraps workspace with onboarding CLAUDE.md template. |
| `packages/backend/src/agent/process.ts` | Standalone agent process — WS server + queue worker. Spawned by orchestrator. |
| `packages/backend/src/orchestrator/server.ts` | Express REST API. Manages agents, messages, and the wipe endpoint. |
| `packages/backend/src/messages-db.ts` | SQLite: chat history (host-side, UI display only). |
| `packages/backend/src/agent-db.ts` | SQLite: agent sessions and resume tokens. |
| `packages/backend/src/logs-db.ts` | SQLite: full audit trail of every agent action. |
| `packages/backend/src/config.ts` | Reads `agents.config.json`. Called fresh on every request — no restart needed. |
| `templates/CLAUDE.onboarding.md` | Bootstrap CLAUDE.md copied to fresh workspaces. Tells Claude to run onboarding if SOUL.md is missing. |
| `packages/frontend/src/hooks/useAgentSocket.ts` | WS connection to the agent's WS port. Streams chunks to the per-message handler. |
| `packages/frontend/src/pages/ChatPage.tsx` | Chat UI. Streams agent replies, renders markdown, persists history, danger zone wipe. |
| `packages/frontend/tests/chat.spec.ts` | Playwright E2E tests — must pass after every UI change. |

---

## Message flow (abbreviated)

```
User types → ChatPage → WebSocket → server.ts → agent-runner.ts
  → claude CLI (subprocess, --output-format stream-json)
  → parsed chunks → WebSocket → ChatPage (text appears live)
  → session_id saved to SQLite (for next message memory)
```

---

## SQLite databases

All data is stored in SQLite — no external database required.

| Database | Purpose |
|---|---|
| `messages-db` | Chat history for UI display |
| `agent-db` | Agent sessions and Claude resume tokens |
| `logs-db` | Full audit trail: messages, tool calls, results, errors |
| `tasks-db` | Per-agent task board |
| `workflows-db` | Workflow definitions and run history |
| `schedules-db` | Cron-based scheduled tasks |
| `secrets-vault` | Encrypted agent secrets |

---

## Adding a new agent

Edit `agents.config.json`, add an entry to the `agents` array. The backend reads it live — refresh the dashboard to see the new card.

```json
{
  "id": "my-agent",
  "name": "my-agent",
  "model": "claude-sonnet-4-5",
  "workspaceDir": "./workspaces/my-agent",
  "allowedTools": ["filesystem"],
  "bigBrother": { "enabled": false }
}
```

---

## Development conventions

- **Backend:** CommonJS modules (`"module": "CommonJS"` in tsconfig). Run with `tsx watch` in dev.
- **Frontend:** ES modules (`"type": "module"`). Vite dev server with proxy to backend.
- **No build step in dev** — `tsx` runs TypeScript directly.
- **Type safety:** both packages use `strict: true`. Run `npx tsc --noEmit` to type-check before committing.
- **Env vars:** `PORT` in `.env`. Never commit `.env`.

## Testing

**Every UI change must be verified with a Playwright test.** No exceptions.

```bash
npm run test:e2e -w packages/frontend   # run all E2E tests
```

- Tests live in `packages/frontend/tests/chat.spec.ts`
- The full stack must be running before tests execute (backend :3001, agent :3100, frontend :5173)
- Each new UI feature or behaviour change requires a corresponding test that proves it works
- Tests run serially (1 worker) against the live stack — no mocks

---

## Workflow

| Starting any task or investigation | `vault` — read relevant section for context |
| After commit, PR, or finding | `vault` — write entry to relevant section |

---

## Project Vault

A project wiki at `vault/`. Committed to the repo — except `vault/secrets/` which is gitignored.

**Read vault before:** starting a task, debugging, reviewing a PR.

**Write to vault after:** commits, PRs, bug discoveries, architectural decisions.

```
vault/
  index.md              ← start here
  wiki/                 ← architecture, services, concepts
  decisions/            ← ADRs (architecture decision records)
  findings/             ← bugs and surprises
  secrets/              ← gitignored, local-only
```

**`vault/secrets/` is gitignored.** Each developer maintains their own local copy of sensitive details.
**Never write raw secret values anywhere in the vault** — write the location only.

---

## Roadmap

| Phase | Status | Description |
|---|---|---|
| P1 - MVP | Done | Single agent, chat, logs, SQLite |
| P2 - Guardian | Next | Guardrails, real-time approval, action control |
| P3 - Multi-Agent | Planned | Multiple agents, message queue, admin agent |
| P4 - Skills | Planned | Task manager, Notion, Asana integrations |
