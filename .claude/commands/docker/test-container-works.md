---
description: Build the GranClaw Docker image, start the container, and walk through the UI end-to-end (chat, tool calls, browser skill) to prove every major feature still works in the container.
---

# /docker/test-container-works

Goal: prove that a fresh clone of GranClaw can be run entirely in Docker and
that the UI is fully functional — chat streams, tool calls fire, the browser
skill renders real pages. Everything we ship should work through a **single
exposed port** (`http://localhost:3001`).

---

## Architecture recap (why this is simple now)

The backend:

1. Serves the built frontend from `packages/frontend/dist/` as static files.
2. Exposes the REST API on the same port.
3. Proxies agent WebSocket connections at `/ws/agents/:id` to the internal
   agent subprocesses (which bind `127.0.0.1:3100+` inside the container).

Because the browser only ever talks to `http://localhost:3001`, the container
only needs to expose port **3001**. Agent ports stay private to the container.

The only two things that need to come from the host are:

- **Claude Code credentials** (so the CLI inside the container can talk to
  Anthropic as you).
- **Optional** persistent state — `./data`, `./workspaces`, `./agents.config.json`.

---

## Prerequisites

- Docker Desktop 4.30+ (`docker --version`, `docker compose version`)
- `claude` CLI installed and logged in on the host (`claude login`)
- Node 20+ on the host (only needed if you later want to run dev mode outside Docker)

No Playwright, no browser install on the host — the container ships Chromium
via apt, which `agent-browser` uses for the browser skill.

---

## Step 1 — Extract your Claude Code credentials for the container

```bash
./scripts/docker-extract-credentials.sh
```

On macOS this reads the `Claude Code-credentials` entry from the system
keychain and writes `./.docker-claude/.credentials.json` (mode 600). On Linux
it copies `~/.claude/.credentials.json`. The file is mounted into the
container at `/root/.claude/.credentials.json`.

`.docker-claude/` is gitignored.

---

## Step 2 — Pick a host port (optional)

The container listens on port **3001 internally**, and `docker-compose.yml`
maps that to **host port 3002** by default so you can keep `npm run dev`
running on host 3001 for comparison. Edit the `ports:` line in
`docker-compose.yml` if you want a different host port — because the
browser uses same-origin WebSockets, any port mapping just works.

---

## Step 3 — Build and start

```bash
docker compose up --build
```

The first build takes a few minutes (installs Chromium + the Claude Code
CLI + agent-browser). Subsequent builds are cached.

When the container is ready you'll see:

```
granclaw-test  | [orchestrator] serving built frontend from /app/packages/frontend/dist
granclaw-test  | [orchestrator] agent "main-agent" started on ws port 3100 (pid …)
granclaw-test  | [orchestrator] agent "demo" started on ws port 3101 (pid …)
granclaw-test  | [orchestrator] agent "lucia" started on ws port 3102 (pid …)
granclaw-test  | [orchestrator] REST API on http://localhost:3001
```

(The `3001` in the log is the container-side port.)

Open **http://localhost:3002** in your browser (or whichever host port you
mapped in `docker-compose.yml`).

---

## Step 4 — Verify the UI renders

Expected:

- [ ] The dashboard loads without a blank screen.
- [ ] Three agent cards appear: `main-agent`, `Demo`, `Lucia`.
- [ ] No red console errors in DevTools besides any unrelated React warnings.
- [ ] `GET /health` → `{"ok":true}` from the same origin.

Quick sanity check from the host:

```bash
curl -s http://localhost:3001/health
curl -s http://localhost:3001/agents | jq '.[].id'
```

---

## Step 5 — Verify chat streaming (the critical path)

> **NEVER test against `main-agent`.** It holds real onboarding state.
> Use `demo` for all testing. This is enforced by CLAUDE.md.

1. Click the **Demo** card → the chat page opens.
2. In the bottom-right connection indicator, the WS should say **connected**.
3. Send: `hello, are you running inside docker?`
4. Expected behaviour:
   - [ ] Tokens stream into the assistant bubble character-by-character (not
         one giant blob). This proves the WS proxy is piping chunks correctly.
   - [ ] The `connected` indicator stays green for the whole turn.
   - [ ] A `done` chunk arrives within ~60s and the streaming spinner clears.

If the chat hangs on "thinking…" or never streams text, the WS proxy is
broken — check the backend logs for `[ws-proxy] upstream error …`.

---

## Step 6 — Verify a tool call fires

Still in the `demo` chat, send:

```
Please create a file called docker-test.md inside your workspace with the
single line "hello from docker" and then read it back to me.
```

Expected:

- [ ] You see `tool_call` chunks for a `Write` or `Edit` and then a `Read`.
- [ ] The assistant reports the file contents.
- [ ] From the host:
      `cat workspaces/demo/docker-test.md` prints `hello from docker`.

This proves the workspace bind-mount is live (changes inside the container
land on the host).

---

## Step 7 — Verify the browser skill (Chromium inside the container)

Still in the `demo` chat, send:

```
Use your browser skill to open https://example.com, take a snapshot,
and tell me the page title.
```

Expected:

- [ ] A `tool_call` for `Bash(.../browser-wrapper.sh …)` appears.
- [ ] The assistant reports `Example Domain` as the title.
- [ ] In the left sidebar, the Browser Sessions view shows a new
      `sess-<timestamp>` with at least one screenshot.
- [ ] On the host: `ls workspaces/demo/.browser-sessions/` lists the session
      directory, which means Chromium inside the container wrote through
      the mounted workspace.

If Chromium fails with a sandbox error, check that `shm_size: "1gb"` is set
in `docker-compose.yml`.

---

## Step 8 — Navigate the rest of the UI

Click through each of the following and confirm they load without errors:

- [ ] **Tasks** (Mission Control) — the kanban board renders, even if empty.
- [ ] **Workflows** — the list page loads.
- [ ] **Schedules** — the list page loads.
- [ ] **Logs** — the log stream loads, search/filters render.
- [ ] **Monitor** — process cards appear with PID/CPU/memory.
- [ ] **Usage** — charts render (may be empty the first time).
- [ ] **Vault** — the agent vault browser loads.
- [ ] **Settings → Secrets** — the secrets UI loads.

---

## Step 9 — Persistence smoke test

```bash
docker compose down
docker compose up -d
```

Reopen the chat. Expected:

- [ ] Chat history from step 5–7 is still there.
- [ ] `docker-test.md` is still in `workspaces/demo/`.
- [ ] Browser session from step 7 still shows up in the sidebar.

This proves the SQLite dbs (`./data`) and workspaces (`./workspaces`) are
being persisted correctly through the bind-mounts.

---

## Step 10 — Shut down cleanly

```bash
docker compose down
```

All agent subprocesses should exit within the 10s `stop_grace_period`.
No orphaned `claude` processes should remain on the host.

---

## Failure modes & fixes

| Symptom | Cause | Fix |
|---|---|---|
| `bind: address already in use` on 3001 | Host `npm run dev` still running | See Step 2. |
| Blank page at `localhost:3001`, `/agents/:id/chat` 404 | Backend not serving static files | Check that `packages/frontend/dist/` exists in the image (`docker compose exec granclaw ls packages/frontend/dist`). Rebuild with `docker compose up --build`. |
| Chat WS never connects; DevTools shows `404` on `/ws/agents/demo` | Stale backend without the WS proxy | Rebuild the image (`docker compose build --no-cache`). |
| `claude` CLI inside container errors "not authenticated" | Credentials file missing/stale | Re-run `./scripts/docker-extract-credentials.sh` and `docker compose restart`. |
| Chromium fails with `no such file` or sandbox error | `shm_size` too small, or Chromium binary missing | `shm_size: 1gb` is in `docker-compose.yml`; rebuild if you changed it. |
| Agent writes files but they don't appear on the host | Bind-mount not writable (SELinux/macOS perms) | `ls -la workspaces/` — the directory should be writable by your user. |

---

## Cleanup

```bash
docker compose down
docker image rm granclaw:test
rm -rf .docker-claude          # removes the credentials copy
```

Your host state (`data/`, `workspaces/`, `agents.config.json`) is untouched
by the teardown.
