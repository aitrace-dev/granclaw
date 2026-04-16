# GranClaw — local operational notes

This file is **local-only** (gitignored). Public architecture, dev conventions, and testing discipline live in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — read that first if you've just cloned the repo.

What's below is guidance for Claude when working in this specific developer's checkout, plus personal reminders that shouldn't land in the public repo.

---

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

---

## Workflow

| Trigger | Action |
|---|---|
| Starting any task or investigation | read `vault/` — the relevant section, for context |
| After commit, PR, or finding | write an entry to the relevant `vault/` section |

---

## Public docs

Everything architectural, onboarding-level, or contributor-facing has moved to:

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — architecture, key files, message flow, SQLite schema, dev conventions, testing discipline, vault structure, roadmap
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — contributor workflow, PR flow, commit style
- [`README.md`](README.md) — user-facing install + feature overview
