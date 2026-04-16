# Developing GranClaw

Working notes for running GranClaw locally, testing the published-package path, and cutting a release. This file is for contributors — not end users. End users should read the root [README.md](./README.md).

---

## Prerequisites

- **Node 20+** (check with `node --version`)
- **[Claude Code CLI](https://claude.ai/download)** on `PATH` (check with `claude --version`)
- **Git** with working SSH or HTTPS to GitHub
- **Optional:** Docker Desktop 4.30+ for the containerized flow

---

## One-time setup

```bash
git clone https://github.com/aitrace-dev/granclaw.git
cd granclaw
npm install
```

`npm install` links the three workspaces (`packages/backend`, `packages/frontend`, `packages/cli`) and installs all transitive deps. You'll probably see `npm audit` warnings — those are tracked; see `vault/findings/2026-04-09-tough-cookie-vuln-chain.md`.

---

## Daily dev loop

```bash
npm run dev
```

This runs the backend (`packages/backend`, `tsx watch src/index.ts`) on `:3001` and the Vite frontend dev server (`packages/frontend`) on `:5173` in parallel, with hot reload on both.

**Open [http://localhost:5173](http://localhost:5173)** — the dev script exports `GRANCLAW_HOME="$PWD"` so:
- `agents.config.json` is read from the repo root
- SQLite databases live in `./data/`
- Agent workspaces live in `./workspaces/`
- Templates resolve from `./packages/cli/templates/`

Nothing lands in `~/.granclaw/` during dev — that directory is reserved for end users of the published package.

**Stop the dev stack** with Ctrl+C. If anything lingers, `pkill -f "tsx watch"` and `pkill -f "vite"` clean it up.

---

## Testing the published-package path (without publishing)

This is the flow you run before releasing to verify the tarball actually works on a clean machine.

### 1. Run the full prepublish gate

```bash
npm run gate -w granclaw
```

Six steps: build → `npm audit` → `gitleaks` → manifest diff + size delta → install verification → Playwright smoke. Total runtime ~90 seconds on a warm laptop.

**Step 2 (`npm audit`) currently fails** on 2 critical + 1 high transitive vulns via `node-telegram-bot-api`. See `vault/findings/2026-04-09-tough-cookie-vuln-chain.md`. To iterate on the other steps while that's being fixed:

```bash
GRANCLAW_GATE_SKIP_AUDIT=1 npm run gate -w granclaw
```

Other escape hatches exist for local iteration and **all refuse to run under `CI=true`**:

| Env var | Skips |
|---|---|
| `GRANCLAW_GATE_SKIP_AUDIT=1` | Step 2 (vulnerability scan) |
| `GRANCLAW_GATE_SKIP_GITLEAKS=1` | Step 3 (secret scan) |
| `GRANCLAW_GATE_SKIP_MANIFEST=1` | Step 4 (file allowlist diff + size delta) |
| `GRANCLAW_GATE_SKIP_INSTALL=1` | Step 5 (ephemeral install verification) |
| `GRANCLAW_GATE_SKIP_E2E=1` | Step 6 (Playwright smoke) |

### 2. Install the packed tarball globally (without touching your real install)

The gate produces `packages/cli/granclaw-0.0.1-beta.0.tgz`. To install it into a throwaway location and run it there:

```bash
VERIFY_PREFIX=$(mktemp -d)
VERIFY_HOME=$(mktemp -d)
npm install --prefix "$VERIFY_PREFIX" --global packages/cli/granclaw-0.0.1-beta.0.tgz

# Run the installed binary
GRANCLAW_HOME="$VERIFY_HOME" "$VERIFY_PREFIX/bin/granclaw" start --port 18788
```

Open [http://localhost:18788](http://localhost:18788). Create an agent, chat with it, exercise every tab. When you're done, Ctrl+C and:

```bash
rm -rf "$VERIFY_PREFIX" "$VERIFY_HOME"
```

This is the closest thing to running `npx granclaw` without actually publishing.

### 3. Smoke the built CLI without installing at all

Fastest iteration — skip the install step entirely and run the built output directly from the repo:

```bash
npm run build -w granclaw                  # produce packages/cli/dist/
TMPHOME=$(mktemp -d)
GRANCLAW_HOME="$TMPHOME" node packages/cli/bin/granclaw.js start --port 18787
```

Same behavior as the installed binary, zero install overhead.

---

## Running individual backend tests

```bash
# All backend vitest
npx vitest run packages/backend

# One file
npx vitest run packages/backend/src/config.test.ts

# Watch mode
npx vitest packages/backend
```

Backend unit tests live alongside source as `*.test.ts`. Excluded from the production TypeScript build via `packages/backend/tsconfig.json`.

## Running CLI tests

```bash
npx vitest run packages/cli
```

Covers `resolveHome`, `seedHomeIfNeeded`, `parseArgs`.

## Running the Playwright smoke directly

```bash
# First make sure the binary is running on :18787 (see "Smoke the built CLI" above)
cd packages/cli
npx playwright test --config playwright.config.ts
```

## Frontend E2E (existing suite)

```bash
npm run test:e2e -w packages/frontend
```

---

## Type-checking

```bash
# Backend only
npx tsc --noEmit -p packages/backend

# CLI only
npx tsc --noEmit -p packages/cli
```

Both must be clean before committing.

---

## Cutting a release (when ready)

**Not yet wired end-to-end.** The first real publish needs two one-time setup steps that haven't been done yet:

1. **Short-lived bootstrap token.** Generate an npm automation token with the shortest expiry on [npmjs.com](https://www.npmjs.com/settings/your-user/tokens), do one manual `npm publish --tag latest --access public -w granclaw`, revoke the token.
2. **Configure Trusted Publishing on npmjs.com.** Package → Settings → Trusted Publishers → Add GitHub Actions publisher:
   - Repo: `aitrace-dev/granclaw`
   - Workflow: `publish.yml`
   - Environment: `npm-publish`
3. **Create the `npm-publish` GitHub environment** at repo Settings → Environments → New. Add yourself as a required reviewer so every release pauses for manual approval.

Once those are done, the daily release flow is:

```bash
# 1. Run the full gate locally (must be green)
npm run gate -w granclaw

# 2. Bump the version. Creates a commit + git tag "v0.0.1-beta.N"
npm version prerelease --preid=beta -w granclaw

# 3. Push commit + tag. The tag push triggers .github/workflows/publish.yml
git push --follow-tags

# 4. Monitor the workflow at github.com/aitrace-dev/granclaw/actions
#    It will:
#      - Run the prepublish gate in a clean runner
#      - Pause at the npm-publish environment gate (click to approve)
#      - npm publish --tag latest --provenance --access public
#      - Create a GitHub Release with auto-generated notes
```

---

## Project layout

```
.
├── packages/
│   ├── backend/             ← @granclaw/backend (private, never published)
│   │   └── src/             ← Express + WebSocket server, SQLite DBs, Claude spawn
│   ├── frontend/            ← @granclaw/frontend (private, never published)
│   │   └── src/             ← React + Vite dashboard
│   └── cli/                 ← granclaw (THE published package)
│       ├── bin/granclaw.js  ← thin shim
│       ├── src/
│       │   ├── index.ts     ← CLI entrypoint, argparse, claude check, server spawn
│       │   └── home.ts      ← ~/.granclaw resolution + first-run seeding
│       ├── templates/       ← shipped inside the tarball (onboarding CLAUDE.md, skills/)
│       ├── scripts/
│       │   ├── build.js     ← orchestrates tsc backend + vite frontend + tsc cli
│       │   ├── prepublish-gate.sh  ← the 6-step gate
│       │   └── gate-e2e.spec.ts    ← Playwright smoke
│       ├── packaging/
│       │   └── expected-files.txt  ← committed file allowlist
│       ├── playwright.config.ts
│       ├── package.json     ← name: granclaw, files: [bin, dist, templates, ...]
│       ├── tsconfig.json
│       └── vitest.config.ts
├── .github/workflows/
│   └── publish.yml          ← OIDC Trusted Publishing, tag-triggered
├── .gitleaks.toml           ← allowlists runtime state, landing PNGs, test fixtures
├── agents.config.json       ← dev's local agents (not shipped; GRANCLAW_HOME=$PWD in dev)
├── data/                    ← dev's local SQLite DBs (gitignored)
├── workspaces/              ← dev's local agent workspaces (gitignored)
├── docs/
│   └── superpowers/         ← gitignored planning artifacts (specs, plans)
└── vault/                   ← gitignored project wiki (decisions, findings, PR notes)
```

---

## Environment variables the backend understands

The backend's path resolution is driven by three env vars. In dev mode, the root `npm run dev` script sets them automatically. If you run the backend standalone (e.g. `npm run dev -w packages/backend`), export them yourself.

| Var | Default | Purpose |
|---|---|---|
| `GRANCLAW_HOME` | `~/.granclaw` | Runtime state root: `agents.config.json`, `data/`, `workspaces/`, `logs/`. In dev: `$PWD` (the repo root). |
| `GRANCLAW_TEMPLATES_DIR` | `<GRANCLAW_HOME>/packages/cli/templates` | Bundled templates (onboarding CLAUDE.md, DO_NOT_DELETE.md, skills/). Set by the CLI entrypoint to the packaged location. |
| `GRANCLAW_STATIC_DIR` | `<REPO_ROOT>/packages/frontend/dist` | Built frontend static assets for single-port serving. Set by the CLI entrypoint to the packaged location. |
| `CONFIG_PATH` | `<GRANCLAW_HOME>/agents.config.json` | Override path to the agents config. Used by `orchestrator/agent-manager.ts` when spawning child agent processes. |
| `PORT` | `8787` (CLI) / `3001` (backend dev) | HTTP port. CLI flag `--port` wins over env var. |

---

## Common gotchas

- **`command not found: claude`** — install Claude Code CLI from [claude.ai/download](https://claude.ai/download). The CLI entrypoint hard-fails if it's missing; the backend also requires it to spawn agent processes.
- **Port 5000 conflicts on macOS** — AirPlay Receiver squats it. Don't use it; GranClaw defaults to 8787.
- **Port 8787 already in use** — usually a previous `granclaw start` that didn't clean up. `lsof -i :8787` to find the PID.
- **`npm run dev` reads `~/.granclaw/` instead of the repo root** — the dev script should export `GRANCLAW_HOME="$PWD"` automatically. If you see this, the root `package.json` dev script was modified or you're running `npm run dev -w packages/backend` directly without setting the env var.
- **`@granclaw/backend` E404 when installing the tarball** — see `vault/findings/2026-04-09-backend-runtime-deps-must-hoist.md`. Symptom that backend runtime deps aren't hoisted into `packages/cli/package.json`.
- **Nested `npm pack` silently fails inside `prepublishOnly`** — fixed by using `npm run gate` standalone; see `vault/findings/2026-04-09-nested-npm-pack-in-prepublishonly.md`.
- **Templates not found** — check `GRANCLAW_TEMPLATES_DIR`. In dev it should be `$PWD/packages/cli/templates`. If you see a fallback to `<REPO_ROOT>/packages/cli/templates` and `REPO_ROOT` is somewhere weird, the dev script env vars didn't export properly.

---

## Where to put things

- **New backend code** → `packages/backend/src/`, follow the existing pattern (CommonJS output, `*.test.ts` next to sources).
- **New frontend code** → `packages/frontend/src/`, same React+Vite conventions.
- **New CLI subcommand** → `packages/cli/src/index.ts`, extend `parseArgs()` and `main()`, add tests in `packages/cli/src/index.test.ts`.
- **New SQLite database** → new `*-db.ts` file in `packages/backend/src/`, consume `REPO_ROOT` (legacy alias — resolves to `GRANCLAW_HOME` at runtime) via `path.resolve(REPO_ROOT, 'data', 'your.db')`.
- **New template file that agents should see** → `packages/cli/templates/`, referenced via `resolveTemplatesDir()` in the backend.
- **New gate check** → append a new step to `packages/cli/scripts/prepublish-gate.sh` with a `GRANCLAW_GATE_SKIP_*` escape hatch, update `docs/` and this file.
- **Architectural decision** → `vault/decisions/YYYY-MM-DD-title.md`, update `vault/index.md`.
- **Unexpected bug or gotcha** → `vault/findings/YYYY-MM-DD-title.md`, update `vault/index.md`.

---

## Further reading

- [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) — full architecture and development reference
- [README.md](./README.md) — user-facing install + feature overview
- [packages/cli/README.md](./packages/cli/README.md) — the README shipped inside the npm tarball
- [vault/index.md](./vault/index.md) — project wiki with decisions, findings, and PR notes
- [docs/superpowers/specs/](./docs/superpowers/specs/) — design specs (gitignored, local only)
- [docs/superpowers/plans/](./docs/superpowers/plans/) — implementation plans (gitignored, local only)
