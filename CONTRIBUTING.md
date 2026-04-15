# Contributing to GranClaw

First — **thank you.** GranClaw is built for people who want an AI framework they can read, fork, and bend to their will. If that's you, you're in the right place.

This guide gets you from "cloned the repo" to "shipped your first PR" without friction.

---

## TL;DR

```bash
git clone https://github.com/aitrace-dev/granclaw.git
cd granclaw
npm install
npm run dev                   # backend :3001 + frontend :5173
```

Open `http://localhost:5173`, configure a provider at **Settings**, create an agent, and you're live.

---

## Ways to contribute

No contribution is too small. Seriously.

- 🟢 **Good first issues** — browse [`good first issue`](https://github.com/aitrace-dev/granclaw/labels/good%20first%20issue). Every one is scoped, has context, and is ready to pick up.
- 🐛 **Bug reports** — [open an issue](https://github.com/aitrace-dev/granclaw/issues/new). Include reproduction steps, your OS, your Node version, and what you expected vs. what happened.
- 📝 **Docs & typos** — fix a confusing sentence, add a missing example, update a stale screenshot. Ship it.
- ✨ **New integrations** — a new LLM provider, a new MCP tool, a new agent template. Open an issue first so we can align on the design.
- 🧪 **Tests** — regression tests for old bugs, coverage for untested code paths, flakes you want to stabilize.
- 🎨 **UI polish** — empty states, keyboard shortcuts, accessibility, dark-mode glitches.

**Not sure where to start?** [Join Discord](https://discord.gg/granclaw) and say hi. We'll help you pick something that matches your interests.

---

## Prerequisites

- **Node 20+** — check with `node --version`
- **npm 10+** — ships with Node 20
- **Git** — obviously
- An **API key** from any of OpenAI, Anthropic, Gemini, Groq, or OpenRouter — configure it in the dashboard at `http://localhost:5173/settings` on first run

---

## Development workflow

### 1. Fork and clone

```bash
gh repo fork aitrace-dev/granclaw --clone
cd granclaw
npm install
```

### 2. Run the dev stack

```bash
npm run dev
```

This starts:
- Backend on `:3001` (Express + WebSocket, `tsx watch` for instant reload)
- Frontend on `:5173` (Vite with HMR)
- Agent processes spawned on demand

The dev script exports `GRANCLAW_HOME=$PWD` so all config, data, and workspaces resolve to the repo root — no surprise conflicts with a production `~/.granclaw` install.

### 3. Make your changes

- **Backend code** lives in `packages/backend/src/`
- **Frontend code** lives in `packages/frontend/src/`
- **Agent configs** live in `agents.config.json` at the repo root
- **Architecture context** lives in `vault/wiki/` — **read the relevant page before starting**

### 4. Write a test

Every fix ships with a regression test. No exceptions.

| Bug lives in | Test lives in |
|---|---|
| Backend logic | `packages/backend/src/*.test.ts` (vitest) |
| Frontend / full-stack flow | `packages/frontend/tests/*.spec.ts` (Playwright) |
| CLI tarball / packaging | `packages/cli/scripts/gate-e2e.spec.ts` |

Run them:

```bash
npm run test -w @granclaw/backend          # backend vitest
npm run test:e2e -w packages/frontend      # full-stack Playwright
```

### 5. Type-check

```bash
npx tsc --noEmit
```

Both packages use `strict: true`. No `any` without a `// reason:` comment.

### 6. Verify against the packaged tarball

For changes that touch packaging, the CLI, or anything the tarball ships:

```bash
npm run gate -w granclaw
```

This builds, packs, installs to a clean prefix, and runs a smoke test. Packaging bugs only show up here — the dev stack will happily pass while the installed CLI is broken.

### 7. Commit and open a PR

```bash
git checkout -b fix/short-description
git commit -m "fix(scope): what and why"
git push origin fix/short-description
gh pr create
```

PR title: conventional commits style (`fix:`, `feat:`, `docs:`, `test:`, `refactor:`, `chore:`).

---

## Coding conventions

- **Backend**: CommonJS modules, run with `tsx watch` in dev, vitest for tests.
- **Frontend**: ES modules, React + Vite, Playwright for E2E.
- **No build step in dev** — `tsx` runs TypeScript directly.
- **Minimal by design.** The whole point of GranClaw is that the codebase should be readable end-to-end. Resist abstraction. Prefer three similar lines over a premature helper.
- **No comments unless the WHY is non-obvious.** Good names beat comments. Don't narrate what the code does.
- **No placeholder code.** Ship the full thing or don't ship.
- **Secrets never hit disk.** API keys, bot tokens, credentials are injected as env vars only — never written to files, never committed.

---

## Project layout

```
granclaw/
├── packages/
│   ├── backend/         # Express + WS server, agent runner, SQLite
│   ├── frontend/        # React dashboard
│   └── cli/             # `granclaw` CLI entry point
├── agents.config.json   # agent definitions (config as code)
├── templates/           # onboarding CLAUDE.md and vault templates
├── vault/               # project wiki — read before starting a task
│   ├── wiki/            # architecture, services, concepts
│   ├── decisions/       # ADRs
│   └── findings/        # bugs and surprises
└── CLAUDE.md            # full developer guide
```

**Read `CLAUDE.md` for the full architecture reference** — it's the single source of truth for how the pieces fit together.

---

## Reporting bugs

Good bug reports include:

1. **What happened** — the error message, the wrong behavior, the screenshot.
2. **What you expected** — one sentence.
3. **Reproduction steps** — exact commands, exact clicks.
4. **Environment** — OS, Node version, GranClaw version (`npx granclaw --version`), provider.
5. **Logs** — anything from the backend terminal or browser console that looks relevant.

[Open an issue →](https://github.com/aitrace-dev/granclaw/issues/new)

---

## Code of conduct

Be kind. Assume good faith. Disagree on ideas, not people. If someone's behavior makes you uncomfortable, reach out to the maintainers in Discord or by email.

---

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](./LICENSE) — same as the rest of the project. Free forever, for any use.

---

**Thanks for helping build GranClaw.** Now go pick an issue. 🦀
