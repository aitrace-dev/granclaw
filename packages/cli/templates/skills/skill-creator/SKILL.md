---
name: skill-creator
description: Author a new skill into your own workspace so it becomes available on the next turn. Use when the user says "create a new skill", "make this reusable", "teach yourself to X", "I do this often", "turn this into a skill", or when you notice a multi-step procedure worth encoding for reuse. Writes directly to `$GRANCLAW_WORKSPACE_DIR/.pi/skills/<new-skill-name>/` — pi's `loadSkills()` auto-discovers it immediately, no restart required.
user-invocable: false
allowed-tools: [bash, read, write, edit]
---

# Skill Creator

Author new skills for yourself on demand. A skill is a directory with a `SKILL.md` at its root (plus optional helper scripts). pi scans `$GRANCLAW_WORKSPACE_DIR/.pi/skills/` at the start of every turn, so a skill you write now appears in the `<available_skills>` block on the very next turn — no agent restart, no config reload.

---

## When to create a skill vs just do the work inline

| Situation | What to do |
|---|---|
| One-off task ("grep this file once") | Just do it inline. Don't create a skill. |
| User will ask again ("every week, pull the latest X and format it as Y") | **Create a skill.** |
| Multi-step procedure with rules the LLM might forget (credentials, ordering, validation) | **Create a skill.** |
| User says "turn this into a skill" or "teach yourself this" | **Create a skill.** |
| Single-line shell command you'd wrap in 3 lines of markdown | Inline it. A skill for `curl -s $URL` is noise. |
| Procedure depends on a tool you don't have | Do not fabricate. Tell the user what's missing first. |

**Heuristic:** if you'd need to re-explain the same thing next week, encode it.

---

## Where the skill lives

```
$GRANCLAW_WORKSPACE_DIR/.pi/skills/<new-skill-name>/
  SKILL.md          ← required, frontmatter + markdown body
  helper.sh         ← optional, remember to chmod +x yourself
  helper.py         ← optional
```

Things to know:

- `$GRANCLAW_WORKSPACE_DIR` is injected into your environment. Use it — never hard-code `/workspaces/...`.
- pi's `loadSkills()` reads this directory at the start of every turn. No cache to bust.
- You are writing to the **agent's workspace**, not to `packages/cli/templates/skills/`. Those template-dir skills ship with the image; they require a release. Skill-creator is for **per-agent, on-demand** skills only.
- The workspace volume is persistent, so the skill survives container restarts.

---

## Frontmatter — get this right or the skill is invisible

Every `SKILL.md` starts with a YAML frontmatter block. All four fields below are required:

```yaml
---
name: <kebab-case-identifier>
description: <one paragraph — see below>
user-invocable: <true|false>
allowed-tools: [bash, read, write, edit]
---
```

**`name`** — short, filesystem-safe, lowercase-with-hyphens. Must match the directory name. Examples: `currency-convert`, `daily-standup`, `invoice-parser`.

**`description`** — one paragraph describing **when to use it**, not just what it is. This is the string that pi feeds into the system prompt as the retrieval key, so trigger words matter. Compare:

- Bad: `"Converts currencies."` (no trigger words)
- Good: `"Convert an amount from one currency to another using a live FX rate. Use when the user asks to convert money, compare prices in different currencies, or mentions FX / exchange rate / EUR / USD / GBP."`

Include the exact phrases a user is likely to say. Name the inputs. Mention the outputs. If it has preconditions (a secret, a tool, a file), say so.

**`user-invocable`** — `true` if the user can type `/<name>` in chat to run it as a slash command, `false` if only you (the agent) should reach for it based on intent. Default to `false` unless the user explicitly wants a slash command.

**`allowed-tools`** — the pi tools this skill needs. Only four are supported: `bash`, `read`, `write`, `edit`. Do not invent others. Browser, recall_history, and every other agent capability comes from the runner, not the skill frontmatter — omit them.

---

## Body structure

Keep the body under ~200 lines. Imperative voice. Concrete commands. Match the tone of the other skills in this image: direct, practical, no marketing.

Recommended sections in order:

1. **One-sentence summary** (what the skill does, restating the description)
2. **When to use it** (a short decision table or bullet list if not obvious)
3. **Preconditions** (required secrets, tools, files — how to check for them)
4. **Step-by-step instructions** (numbered, each step is a single concrete action)
5. **Worked example** (one full invocation the agent can copy verbatim)
6. **Rules / what not to do**
7. **Troubleshooting** (common failure modes and their fix)

If the skill touches secrets, add a **Security rules** section near the top with the golden rules (never echo secret values, never accept secrets in chat, refer to secrets by name).

---

## How to author the skill — concrete steps

1. **Pick a name.** Kebab-case, filesystem-safe. Check it doesn't already exist:

   ```bash
   ls "$GRANCLAW_WORKSPACE_DIR/.pi/skills/" 2>/dev/null
   ```

   If `<new-skill-name>/` is already there, **stop and ask the user** whether to overwrite or pick a different name. Never clobber silently.

2. **Create the directory.**

   ```bash
   mkdir -p "$GRANCLAW_WORKSPACE_DIR/.pi/skills/<new-skill-name>"
   ```

3. **Write `SKILL.md`** using the `write` tool at `$GRANCLAW_WORKSPACE_DIR/.pi/skills/<new-skill-name>/SKILL.md`. Start with the frontmatter block, then the body. Keep it focused — one skill, one job.

4. **(Optional) add a helper script.** If there's a repetitive shell command the skill will call, put it in a `.sh` or `.py` file alongside `SKILL.md`. Name it clearly (`run.sh`, `send.py`, not `script1.sh`). Then make it executable:

   ```bash
   chmod +x "$GRANCLAW_WORKSPACE_DIR/.pi/skills/<new-skill-name>/run.sh"
   ```

   **Important — the auto-chmod only runs on bootstrap for template-dir skills**, not for skills you write into the workspace. You must `chmod +x` explicitly or bash will refuse to execute the helper.

5. **Read it back to verify** the frontmatter parsed cleanly and the markdown renders the way you expect:

   ```bash
   cat "$GRANCLAW_WORKSPACE_DIR/.pi/skills/<new-skill-name>/SKILL.md"
   ```

6. **Tell the user it's ready.** Say something like: "I've written a `<new-skill-name>` skill into your workspace. It'll appear in my available skills on the next message — try asking me to <representative task> and I'll use it."

   No restart is needed. The next turn picks it up automatically.

---

## Worked example — a `currency-convert` skill

Create the directory, then `write` the following to `$GRANCLAW_WORKSPACE_DIR/.pi/skills/currency-convert/SKILL.md`:

```markdown
---
name: currency-convert
description: Convert an amount from one currency to another using a live FX rate from exchangerate.host. Use when the user asks to convert money, compare prices across currencies, or mentions FX, exchange rate, EUR, USD, GBP, JPY, or any ISO currency code.
user-invocable: true
allowed-tools: [bash]
---

# Currency Convert

Fetch a live FX rate and convert an amount.

## Step 1 — Identify inputs
From the user's message, extract `AMOUNT` (number), `FROM` (ISO code), `TO` (ISO code). If any are missing, ask once before calling the API.

## Step 2 — Fetch the rate
    curl -sf "https://api.exchangerate.host/convert?from=$FROM&to=$TO&amount=$AMOUNT" | jq .

The response includes `result` (converted amount) and `info.rate` (rate used).

## Step 3 — Reply
Tell the user: `$AMOUNT $FROM = $result $TO (rate: $rate)`. Always cite `exchangerate.host` as the source.

## Troubleshooting
**Empty or null `result`** — either the currency code is invalid or the API is down. Confirm the code with the user, or fall back to `https://api.frankfurter.app/latest?amount=$AMOUNT&from=$FROM&to=$TO`.
```

Verify with `cat` and tell the user it's ready. On the next turn, `currency-convert` appears in `<available_skills>`.

---

## What NOT to do

- **Never write to `packages/cli/templates/skills/`.** That directory is baked into the shipped image and requires a release. This skill is for per-agent workspace skills only.
- **Never overwrite an existing skill without asking.** Check `ls "$GRANCLAW_WORKSPACE_DIR/.pi/skills/"` first and confirm with the user if there's a name clash.
- **Never create a skill that wraps a single shell command.** Inline it. Skills are for multi-step procedures or code with non-obvious rules.
- **Never reference environment variables the skill won't actually have.** Agents inherit a specific set (`GRANCLAW_WORKSPACE_DIR`, `GRANCLAW_API_URL`, `GRANCLAW_AGENT_ID`, and whatever the user added in the Secrets panel). Do not assume a custom `$FOO` exists.
- **Never list tools other than `bash`, `read`, `write`, `edit` in `allowed-tools`.** Other names are silently ignored and confuse the next reader.
- **Never fabricate capabilities.** If a skill would need a tool you don't have (Slack API, Stripe SDK, etc.), say so to the user before writing. Do not author a skill that shells out to a binary you never verified exists.
- **Never embed secret values in the skill body.** Reference them by name (`$SMTP_PASS`) and tell the user to add them via the Secrets panel.

---

## Troubleshooting

**New skill not showing up in `<available_skills>` on the next turn** — the frontmatter is almost certainly malformed. Re-read the file with `cat` and check: the `---` fences are on their own lines, `name:` matches the directory name, `user-invocable:` is literally `true` or `false` (not `yes`/`no`), and `allowed-tools:` is a valid YAML array like `[bash, read, write, edit]`.

**`permission denied` when running a helper script** — you forgot to `chmod +x` the file. The auto-chmod on bootstrap only applies to template-dir skills shipped in the image, not to ones you write into the workspace yourself. Run `chmod +x "$GRANCLAW_WORKSPACE_DIR/.pi/skills/<name>/<helper>.sh"`.

**Skill is visible but the agent (you) doesn't pick it up when it should** — the description is too vague. Edit the frontmatter `description` to include the exact phrases the user typed when they asked for the skill originally. Trigger words in the description are what pi's retriever matches against.

**`mkdir: cannot create directory: No such file or directory`** — `$GRANCLAW_WORKSPACE_DIR` is unset or wrong. Echo it (`echo "$GRANCLAW_WORKSPACE_DIR"`) to confirm, and fall back to `pwd` if that's also the workspace root.

**User wants to delete a skill they no longer need** — `rm -rf "$GRANCLAW_WORKSPACE_DIR/.pi/skills/<name>"` and confirm deletion. It disappears from `<available_skills>` on the next turn.
