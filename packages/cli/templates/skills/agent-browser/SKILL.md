---
name: agent-browser
description: Browser automation CLI for AI agents. Use when the user needs to interact with websites, including navigating pages, filling forms, clicking buttons, taking screenshots, extracting data, testing web apps, or automating any browser task.
user-invocable: false
allowed-tools: [bash]
---

# agent-browser Skill

You have access to a browser automation CLI via `.agent/skills/agent-browser/browser-wrapper.sh`. This wrapper handles session management and audit logging automatically. Use it whenever the task requires interacting with a website.

---

## Core Workflow

The fundamental loop is: **open → snapshot → interact → re-snapshot**.

```bash
# 1. Navigate to a page
.agent/skills/agent-browser/browser-wrapper.sh go https://example.com

# 2. Take an annotated snapshot to see interactive elements with ref labels
.agent/skills/agent-browser/browser-wrapper.sh snapshot --annotate -i

# 3. Interact using the ref from the snapshot
.agent/skills/agent-browser/browser-wrapper.sh click --ref e12

# 4. Re-snapshot to confirm the result
.agent/skills/agent-browser/browser-wrapper.sh snapshot --annotate -i
```

**The entire session is recorded as video automatically.** You do not need to take screenshots for the audit trail. Recording starts on the first command and finalizes when you call `close`. **Never call `record start` or `record stop` yourself — the wrapper manages recording, and calling `record` directly will be rejected with exit code 2.**

Use `--annotate -i` for snapshots during reasoning — it overlays numbered labels on interactive elements so you can reference them precisely. Plain `snapshot` (without `--annotate`) gives you the accessibility tree for text extraction.

---

## Command Chaining

Chain commands with `&&` when steps are certain to succeed in sequence:

```bash
# Good — all steps are predictable
.agent/skills/agent-browser/browser-wrapper.sh go https://example.com && \
  .agent/skills/agent-browser/browser-wrapper.sh click --ref e5 && \
  .agent/skills/agent-browser/browser-wrapper.sh snapshot --annotate -i
```

Run commands separately when:
- You need to inspect the result before deciding the next action
- A step might fail or require conditional handling
- You are filling a form and want to verify each field

---

## Session Management

Sessions are managed automatically by the wrapper. You do not need to use `--session` flags or worry about session names. Every browser automation is recorded. Just focus on the task.

Always close the browser when done:

```bash
.agent/skills/agent-browser/browser-wrapper.sh close
```

---

## Handling Authentication

### Persistent browser profile (recommended — set up by user via dashboard)

The wrapper **automatically uses** a persistent browser profile at `.browser-profile/` if it exists.
This profile keeps all cookies, localStorage, IndexedDB, and cached sessions across runs.
You do NOT need to pass any flags — the wrapper handles it.

The user sets up the profile from the **dashboard Browser view**:
1. They click "Launch Browser" with a URL
2. They log in manually (handling 2FA, CAPTCHAs, etc.)
3. They click "Close Browser" — the profile is saved automatically

After that, every time you browse, the wrapper auto-injects `--profile .browser-profile` and you're already authenticated. The wrapper also auto-kills any stale browser daemon before `open`/`go` commands to ensure the profile loads fresh every time.

**You do NOT need to manually close the browser before opening a new page.** The wrapper handles this automatically.

**If you get a login wall on a site the user already logged into**, it may mean the session expired. Tell the user:
> "Your login session for <site> has expired. Please re-login from Dashboard → Browser view."

**Do NOT attempt to log in yourself** — sites with 2FA, CAPTCHAs, and security checkpoints require human intervention.

### Other approaches

#### Auto-connect to existing Chrome
If the user already has Chrome open and logged in:
```bash
.agent/skills/agent-browser/browser-wrapper.sh go https://app.example.com --connect-to existing
```

#### Interactive login
Navigate to the login page and fill credentials directly:
```bash
.agent/skills/agent-browser/browser-wrapper.sh go https://app.example.com/login
.agent/skills/agent-browser/browser-wrapper.sh snapshot --annotate -i
.agent/skills/agent-browser/browser-wrapper.sh fill --ref e2 --value "user@example.com"
.agent/skills/agent-browser/browser-wrapper.sh fill --ref e3 --value "secret"
.agent/skills/agent-browser/browser-wrapper.sh click --ref e4
```

---

## Essential Commands

### Navigation
| Command | Description |
|---------|-------------|
| `.agent/skills/agent-browser/browser-wrapper.sh go <url>` | Navigate to a URL |
| `.agent/skills/agent-browser/browser-wrapper.sh back` | Go back in history |
| `.agent/skills/agent-browser/browser-wrapper.sh forward` | Go forward in history |
| `.agent/skills/agent-browser/browser-wrapper.sh reload` | Reload current page |

### Snapshot
| Command | Description |
|---------|-------------|
| `.agent/skills/agent-browser/browser-wrapper.sh snapshot` | Accessibility tree (text/structure) |
| `.agent/skills/agent-browser/browser-wrapper.sh snapshot --annotate -i` | Annotated screenshot with ref labels |
| `.agent/skills/agent-browser/browser-wrapper.sh snapshot --selector "#main"` | Snapshot a specific element |

### Interaction
| Command | Description |
|---------|-------------|
| `.agent/skills/agent-browser/browser-wrapper.sh click --ref <ref>` | Click an element by ref |
| `.agent/skills/agent-browser/browser-wrapper.sh fill --ref <ref> --value <text>` | Fill an input field |
| `.agent/skills/agent-browser/browser-wrapper.sh select --ref <ref> --value <option>` | Select a dropdown option |
| `.agent/skills/agent-browser/browser-wrapper.sh check --ref <ref>` | Check a checkbox |
| `.agent/skills/agent-browser/browser-wrapper.sh uncheck --ref <ref>` | Uncheck a checkbox |
| `.agent/skills/agent-browser/browser-wrapper.sh hover --ref <ref>` | Hover over an element |
| `.agent/skills/agent-browser/browser-wrapper.sh press --key <key>` | Press a keyboard key (e.g. Enter, Tab) |
| `.agent/skills/agent-browser/browser-wrapper.sh type --text <text>` | Type text at current focus |
| `.agent/skills/agent-browser/browser-wrapper.sh drag --from <ref> --to <ref>` | Drag and drop |

### Get Info
| Command | Description |
|---------|-------------|
| `.agent/skills/agent-browser/browser-wrapper.sh url` | Get current URL |
| `.agent/skills/agent-browser/browser-wrapper.sh title` | Get page title |
| `.agent/skills/agent-browser/browser-wrapper.sh text --ref <ref>` | Get text content of an element |
| `.agent/skills/agent-browser/browser-wrapper.sh attr --ref <ref> --name <attr>` | Get an attribute value |

### Wait
| Command | Description |
|---------|-------------|
| `.agent/skills/agent-browser/browser-wrapper.sh wait --ref <ref>` | Wait for element to appear |
| `.agent/skills/agent-browser/browser-wrapper.sh wait --url <pattern>` | Wait for URL to match pattern |
| `.agent/skills/agent-browser/browser-wrapper.sh wait --text <text>` | Wait for text to appear on page |
| `.agent/skills/agent-browser/browser-wrapper.sh wait --ms <milliseconds>` | Wait a fixed duration |

### Downloads
| Command | Description |
|---------|-------------|
| `.agent/skills/agent-browser/browser-wrapper.sh download --ref <ref> --path <dir>` | Click and save a download |

### Network
| Command | Description |
|---------|-------------|
| `.agent/skills/agent-browser/browser-wrapper.sh network` | List network requests made by the page |
| `.agent/skills/agent-browser/browser-wrapper.sh network --filter <pattern>` | Filter by URL pattern |

### Viewport
| Command | Description |
|---------|-------------|
| `.agent/skills/agent-browser/browser-wrapper.sh viewport --width 1280 --height 800` | Set viewport size |
| `.agent/skills/agent-browser/browser-wrapper.sh scroll --ref <ref>` | Scroll element into view |
| `.agent/skills/agent-browser/browser-wrapper.sh scroll --down 500` | Scroll page down by pixels |

### Capture
| Command | Description |
|---------|-------------|
| `.agent/skills/agent-browser/browser-wrapper.sh screenshot` | Take a one-off screenshot (the session is already recorded as video) |
| `.agent/skills/agent-browser/browser-wrapper.sh screenshot --annotate -i` | Annotated screenshot for agent reasoning |
| `.agent/skills/agent-browser/browser-wrapper.sh screenshot --path <file>` | Save screenshot to a file |
| `.agent/skills/agent-browser/browser-wrapper.sh pdf --path <file>` | Save page as PDF |

### Clipboard
| Command | Description |
|---------|-------------|
| `.agent/skills/agent-browser/browser-wrapper.sh clipboard read` | Read clipboard contents |
| `.agent/skills/agent-browser/browser-wrapper.sh clipboard write --value <text>` | Write to clipboard |

### Dialogs
| Command | Description |
|---------|-------------|
| `.agent/skills/agent-browser/browser-wrapper.sh dialog accept` | Accept a browser dialog (alert/confirm) |
| `.agent/skills/agent-browser/browser-wrapper.sh dialog dismiss` | Dismiss a browser dialog |
| `.agent/skills/agent-browser/browser-wrapper.sh dialog fill --value <text>` | Fill a prompt dialog |

### Diff
| Command | Description |
|---------|-------------|
| `.agent/skills/agent-browser/browser-wrapper.sh diff --before <snap1> --after <snap2>` | Diff two snapshots |

---

## Common Patterns

### Form Submission
```bash
.agent/skills/agent-browser/browser-wrapper.sh go https://example.com/contact
.agent/skills/agent-browser/browser-wrapper.sh snapshot --annotate -i

# Fill each field using refs from the snapshot
.agent/skills/agent-browser/browser-wrapper.sh fill --ref e2 --value "Alice"
.agent/skills/agent-browser/browser-wrapper.sh fill --ref e3 --value "alice@example.com"
.agent/skills/agent-browser/browser-wrapper.sh fill --ref e4 --value "Hello from Claude"

# Submit
.agent/skills/agent-browser/browser-wrapper.sh click --ref e5
.agent/skills/agent-browser/browser-wrapper.sh snapshot --annotate -i
```

### Auth Vault (Recommended for Credentials)
```bash
# Store once (run interactively, not automated)
agent-browser vault set github_username "alice"
agent-browser vault set github_password "s3cr3t"

# Use in automation
.agent/skills/agent-browser/browser-wrapper.sh go https://github.com/login
.agent/skills/agent-browser/browser-wrapper.sh snapshot --annotate -i
.agent/skills/agent-browser/browser-wrapper.sh fill --ref e1 --value "$(agent-browser vault get github_username)"
.agent/skills/agent-browser/browser-wrapper.sh fill --ref e2 --value "$(agent-browser vault get github_password)"
.agent/skills/agent-browser/browser-wrapper.sh click --ref e3
```

### State Persistence (Save/Restore Login)
```bash
# After logging in manually, save the state
.agent/skills/agent-browser/browser-wrapper.sh state save --path ~/.browser-state/github.json

# In future automated runs, restore it
.agent/skills/agent-browser/browser-wrapper.sh go https://github.com --state ~/.browser-state/github.json
```

### Iframes
Iframes are treated as nested browsing contexts. Snapshot inside an iframe by targeting its ref:
```bash
.agent/skills/agent-browser/browser-wrapper.sh snapshot --annotate -i
# Find the iframe ref, e.g. f1
.agent/skills/agent-browser/browser-wrapper.sh snapshot --frame f1 --annotate -i
.agent/skills/agent-browser/browser-wrapper.sh click --frame f1 --ref e7
```

### Data Extraction
```bash
.agent/skills/agent-browser/browser-wrapper.sh go https://example.com/data
# Use snapshot (no --annotate) to get the raw accessibility tree as text
.agent/skills/agent-browser/browser-wrapper.sh snapshot
# Or extract a specific element's text
.agent/skills/agent-browser/browser-wrapper.sh text --ref e10
```

### Connect to Existing Chrome
If the user's Chrome is already open and logged in to services:
```bash
.agent/skills/agent-browser/browser-wrapper.sh go https://app.example.com --connect-to existing
.agent/skills/agent-browser/browser-wrapper.sh snapshot --annotate -i
```

---

## Security

### Content Boundaries
The browser runs with the permissions of the current user. Do not visit untrusted URLs or execute scripts from unknown sources.

### Domain Allowlist
If you need to restrict which domains the agent can visit, configure `agent-browser` with an allowlist:
```bash
agent-browser config set allowed-domains "example.com,api.example.com"
```

### Action Policy
Destructive actions (form submissions, purchases, account changes) should be confirmed with the user before execution. Prefer read-only operations when the goal is data extraction.

### Output Limits
Snapshot output can be large for complex pages. If the accessibility tree is too long, target a specific element:
```bash
.agent/skills/agent-browser/browser-wrapper.sh snapshot --selector "#results-table"
```

---

## Ref Lifecycle

Refs (e.g. `e12`, `f1`) are assigned to DOM elements at snapshot time. They are **invalidated whenever the page changes** — after navigation, form submission, or any dynamic update.

Always re-snapshot after:
- Navigating to a new URL
- Submitting a form
- Clicking a button that changes the page
- Any action that triggers a route change or significant DOM update

```bash
.agent/skills/agent-browser/browser-wrapper.sh click --ref e5   # triggers navigation
.agent/skills/agent-browser/browser-wrapper.sh snapshot --annotate -i  # get fresh refs
.agent/skills/agent-browser/browser-wrapper.sh click --ref e9   # use new ref
```

---

## Annotated Screenshots

Use `--annotate -i` with `snapshot` or `screenshot` when you need **visual reasoning** — it overlays numbered labels on interactive elements. This is for your own understanding of the page layout, not for the audit trail (the wrapper handles audit screenshots automatically).

```bash
# Best for reasoning about what's on the page
.agent/skills/agent-browser/browser-wrapper.sh snapshot --annotate -i

# Also valid — explicit screenshot with annotations
.agent/skills/agent-browser/browser-wrapper.sh screenshot --annotate -i
```

Without `--annotate`, `snapshot` returns the raw accessibility tree as text, which is better for data extraction and copy-pasting content.

---

## JavaScript Evaluation

Run arbitrary JavaScript on the page using `eval`:

```bash
# Simple expression
.agent/skills/agent-browser/browser-wrapper.sh eval --expression "document.title"

# Multi-line via --stdin
echo 'document.querySelectorAll("a").length' | \
  .agent/skills/agent-browser/browser-wrapper.sh eval --stdin

# Base64 for complex expressions with special characters
EXPR=$(echo 'Array.from(document.querySelectorAll("h2")).map(el => el.textContent)' | base64)
.agent/skills/agent-browser/browser-wrapper.sh eval --expression-base64 "$EXPR"
```

Use JavaScript evaluation when the accessibility tree does not expose the data you need.

---

## Timeouts

The default command timeout is **25 seconds**. For slow-loading pages, use explicit waits rather than relying on the timeout:

```bash
# Wait for a specific element before interacting
.agent/skills/agent-browser/browser-wrapper.sh go https://slow-app.example.com
.agent/skills/agent-browser/browser-wrapper.sh wait --ref e5 --timeout 60000

# Wait for a URL change after form submission
.agent/skills/agent-browser/browser-wrapper.sh click --ref e8
.agent/skills/agent-browser/browser-wrapper.sh wait --url "**/dashboard**"
.agent/skills/agent-browser/browser-wrapper.sh snapshot --annotate -i
```

For pages with animations or deferred content, a short wait can help:
```bash
.agent/skills/agent-browser/browser-wrapper.sh wait --ms 1500
.agent/skills/agent-browser/browser-wrapper.sh snapshot --annotate -i
```

---

## Setup Commands (Not via Wrapper)

These are one-time setup commands run directly, not through the wrapper:

```bash
# Install agent-browser
agent-browser install

# Upgrade to latest version
agent-browser upgrade

# Manage the auth vault
agent-browser vault set <key> <value>
agent-browser vault get <key>
agent-browser vault list
```
