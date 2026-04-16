# GranClaw Architecture

Multi-agent AI framework. Minimal by design — the entire codebase should be readable end-to-end.

This document is the public architecture and development reference. Start here if you've just cloned the repo.

---

## Quick start

```bash
cp .env.example .env
npm install
npm run dev                   # backend :3001 + frontend :5173
```

**Prerequisites:** Node 20+. Configure a provider at `http://localhost:5173/settings` on first run.

---

## Separate git repos: enterprise/ and landing/

**`enterprise/` and `landing/` are NOT part of this repo.** They are gitignored and each has its own git history.

When making changes in those directories:
- `cd enterprise/` (or `cd landing/`) before running any `git` command
- Commits and pushes must happen from inside that directory
- They push to their own remotes (`granclaw-enterprise`, `granclaw-landing`), not this repo

```bash
# Example: commit and push a change in enterprise/
cd enterprise
git add app/app/dashboard/page.tsx
git commit -m "fix: ..."
git push origin main
```

---

## Architecture in one paragraph

The **backend** (`packages/backend`) is an Express + WebSocket server. When a user sends a message through the dashboard, the backend spawns the `claude` CLI as a child process with `--output-format stream-json`, parses the streamed JSON output, and forwards each chunk back to the browser over WebSocket in real time. Session IDs are persisted in SQLite so conversations survive restarts. Every agent action (message in, tool call, tool result) is logged to SQLite. All agent configuration lives in `agents.config.json` at the root — no config in the database.

---

## Key files

| File | What it does |
|---|---|
| `agents.config.json` | Defines every agent: id, model, tools, workspace dir. Config as code — edit this file to change agent behaviour. |
| `packages/backend/src/agent/runner.ts` | **Core.** Spawns the `claude` CLI, streams JSON output, persists session IDs. Bootstraps workspace with onboarding template. |
| `packages/backend/src/agent/process.ts` | Standalone agent process — WS server + queue worker. Spawned by orchestrator. |
| `packages/backend/src/orchestrator/server.ts` | Express REST API. Manages agents, messages, and the wipe endpoint. |
| `packages/backend/src/messages-db.ts` | SQLite: chat history (host-side, UI display only). |
| `packages/backend/src/agent-db.ts` | SQLite: agent sessions and resume tokens. |
| `packages/backend/src/logs-db.ts` | SQLite: full audit trail of every agent action. |
| `packages/backend/src/config.ts` | Reads `agents.config.json`. Called fresh on every request — no restart needed. |
| `templates/CLAUDE.onboarding.md` | Bootstrap template copied to fresh agent workspaces. |
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

## Agent tools ship as inline extensionFactories

**Never use file-based pi extensions.** The programmatic runner does not load from `.pi/extensions/` — only the interactive pi TUI does. File-based extensions are not portable and may fail silently.

**The rule:** every tool added to GranClaw agents is registered as an inline `extensionFactory` in `runner-pi.ts`.

- Add a new `extensionFactories.push((pi: any) => { pi.registerTool({...}) })` block in `runAgent()`
- The tool is available to every agent immediately on next restart — no file copying required
- Any new npm packages the tool needs must be added to `packages/backend/package.json` `"dependencies"`

**Do not:**
- Write extensions to `packages/cli/templates/pi-extensions/` — that directory no longer exists
- Install extensions into `~/.pi/agent/extensions/` — they only exist on your machine

---

## Development conventions

- **Backend:** CommonJS modules (`"module": "CommonJS"` in tsconfig). Run with `tsx watch` in dev.
- **Frontend:** ES modules (`"type": "module"`). Vite dev server with proxy to backend.
- **No build step in dev** — `tsx` runs TypeScript directly.
- **Type safety:** both packages use `strict: true`. Run `npx tsc --noEmit` to type-check before committing.
- **Env vars:** `PORT` in `.env`. Never commit `.env`.

---

## Testing

**CRITICAL: Every fix ships with a test that fails before the fix and passes after.** No exceptions, no "I'll add it later". If the change can't be tested, write it down — explain why in the commit message and open a follow-up issue.

### The rule in one line

> A fix without a regression test is half a fix. The bug comes back.

### What to write, by layer

| Bug lives in | Test lives in | Why |
|---|---|---|
| **Backend logic** (runner, config, db, workflows) | `packages/backend/src/*.test.ts` — vitest | Runs in-process, fast, deterministic |
| **Backend packaging / runtime** (ESM loader, tarball shape, prepublish gate) | `packages/backend/src/*.test.ts` using `execFileSync(process.execPath, …)` for real-node runs | Vitest runs in a VM sandbox; real Node behaviour needs a subprocess |
| **Frontend component behaviour** (rendering, state, hooks) | `packages/frontend/tests/*.spec.ts` — Playwright against the full stack | React hook lifecycles + WebSocket + router interactions can't be caught by unit tests |
| **End-to-end flow** (user types → tool call → render) | `packages/frontend/tests/chat.spec.ts` | Exercises the real LLM or the mocked provider layer |
| **CLI tarball / publish pipeline** | `packages/cli/scripts/prepublish-gate.sh` steps + `packages/cli/scripts/gate-e2e.spec.ts` | Catches packaging regressions that only manifest after `npm install -g` |

### Workflow for a fix

1. **Reproduce with a failing test first.** If the test passes on a buggy build, it's not catching the bug — rewrite it.
2. **Make the test fail loudly** — assertion with a specific message about what's broken, not just `expect(x).toBe(y)`.
3. **Apply the minimal fix in the dev stack** (`npm run dev`) for fast iteration — HMR gives you instant feedback on both backend (`tsx watch`) and frontend (Vite).
4. **Confirm the test now passes** and that no other test regressed.
5. **Commit the test in the same commit as the fix** — never a separate "add test" follow-up. The test is part of the fix.
6. **Verify against the packaged tarball, not the dev stack.** Run the full build → pack → install → start → regression-test loop against `/tmp/granclaw-verify-prefix` on port 18787 before claiming "done". Packaging bugs (ESM loader, missing assets, stale dist) only manifest after `npm install -g`, so the dev-stack pass is necessary but not sufficient.

**Never fix in the verify install, never verify in the dev stack.** The dev stack is for iteration; the verify install is for the final green light. Confusing the two is how packaging bugs reach users.

### Running tests

```bash
npm run test -w @granclaw/backend          # backend vitest
npm run test:e2e -w packages/frontend      # full-stack Playwright
npm run gate -w granclaw                   # prepublish gate (build + audit + tarball install + smoke)
```

- Playwright tests need the full stack running (backend :3001, agent :3100, frontend :5173), one worker, no mocks.
- The prepublish gate spins up its own server from the packed tarball on port 18787 and cleans up after itself.

### Known regression tests and the bugs they guard

- `packages/backend/src/esm-import.test.ts` — bare `await import('@mariozechner/pi-ai')` was silently rewritten to `require()` by tsc and crashed the tarball-installed CLI. Tests shell out to a real Node process *and* statically scan backend source for the forbidden pattern.
- `packages/backend/src/providers-config.test.ts` — legacy `active` single-provider format must migrate transparently to the new `providers` map on read.
- `packages/backend/src/config.test.ts` — GRANCLAW_HOME resolution priority (CLI flag > env var > default) and whitespace handling.

---

## Project Vault

A project wiki at `vault/`. Committed to the repo — except `vault/secrets/` which is gitignored.

```
vault/
  index.md              ← start here
  wiki/                 ← architecture, services, concepts
  decisions/            ← ADRs (architecture decision records)
  findings/             ← bugs and surprises
  secrets/              ← gitignored, local-only
```

**Read the vault before:** starting a task, debugging, reviewing a PR.
**Write to the vault after:** commits, PRs, bug discoveries, architectural decisions.

`vault/secrets/` is gitignored — each developer maintains their own local copy of sensitive details. **Never write raw secret values anywhere in the vault** — write the location only.

---

## Roadmap

| Phase | Status | Description |
|---|---|---|
| P1 - MVP | Done | Single agent, chat, logs, SQLite |
| P2 - Guardian | Next | Guardrails, real-time approval, action control |
| P3 - Multi-Agent | Planned | Multiple agents, message queue, admin agent |
| P4 - Skills | Planned | Task manager, Notion, Asana integrations |
