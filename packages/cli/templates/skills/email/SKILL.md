---
name: email
description: Send and read email. The default and recommended path is SMTP/IMAP with an app password — it works with Gmail, Outlook, Fastmail, Zoho, Yahoo, Proton Bridge, and any self-hosted provider, and takes 3 minutes to set up. For Gmail users who need labels, drafts, or threading, there is an advanced OAuth 2.0 path via the bundled gmcli. Credentials always live in the user's secrets vault — never ask the user to paste a password in chat.
user-invocable: false
allowed-tools: [bash, read, write]
---

# Email

Send and read mail on behalf of the user. One skill, two paths — **the user picks**.

## Which path to use

| Situation | Path | Why |
|---|---|---|
| User wants to send/receive email for the first time, any provider including Gmail | **SMTP/IMAP with app password** (default) | Works everywhere, 3 minutes to set up, no Google Cloud Console, no OAuth consent screens. This is the one you should suggest by default. |
| User specifically needs Gmail labels, drafts, threading, or advanced search | **Gmail via OAuth (gmcli)** (advanced) | Only Gmail exposes these features through the Gmail API. IMAP cannot touch them. |
| User has no 2FA enabled and will not enable it | **Gmail via OAuth (gmcli)** | App passwords require 2FA. OAuth is the escape hatch — though the user should really just enable 2FA. |
| User is on Google Workspace with an admin who disabled app passwords | **Gmail via OAuth (gmcli)** | Workspace admins can globally disable app-password access. |

**Rule of thumb:** ask the user which mail provider they use, then suggest the SMTP/IMAP branch unless one of the "advanced" conditions above applies.

---

## Golden security rules

1. **Never accept a password, app password, OAuth token, or client secret in chat.** The user pastes credentials into the Secrets panel in the GranClaw sidebar; the runtime injects them into your environment on startup. Your job is to tell the user what to put there, not to handle the value yourself.
2. **Never echo a secret's value back.** Refer to secrets by name (`SMTP_PASS`, `GMAIL_CREDENTIALS`) and never print `$SMTP_PASS` or paste it back to the user.
3. **Never commit a secret to disk outside `$GRANCLAW_WORKSPACE_DIR/.gmcli/`** (and those files are rebuilt from env on every call anyway).

---

## SMTP/IMAP branch (default, works for any provider including Gmail)

This is the path you should offer first.

### First-time setup

Ask the user to add the following secrets in the **Secrets** panel. Required for sending:

| Secret | Example | Notes |
|---|---|---|
| `SMTP_HOST` | `smtp.gmail.com`, `smtp.fastmail.com`, `smtp-mail.outlook.com` | Provider's SMTP host |
| `SMTP_PORT` | `587` (STARTTLS) or `465` (implicit TLS) | 587 is the modern default |
| `SMTP_USER` | `alice@gmail.com` | Full email address |
| `SMTP_PASS` | `abcdabcdabcdabcd` (16 chars) | **App password, not the real account password** |

Required for reading (optional if the user only wants to send):

| Secret | Example |
|---|---|
| `IMAP_HOST` | `imap.gmail.com` |
| `IMAP_PORT` | `993` (SSL — almost always) |
| `IMAP_USER` | same as `SMTP_USER` |
| `IMAP_PASS` | same app password as `SMTP_PASS` |

### Provider-specific setup walkthroughs

Figure out which provider the user is on, then copy-paste the relevant block:

**Gmail / Google Workspace (recommended path for most users):**

> To give me Gmail access the secure way:
>
> 1. **Enable 2-Step Verification** on your Google Account if you haven't already: <https://myaccount.google.com/signinoptions/twosv>. This is required — Google won't let you generate an app password without it.
> 2. Go to <https://myaccount.google.com/apppasswords>. Sign in again if asked.
> 3. Where it says "App name", type something like `GranClaw` and click **Create**.
> 4. Google will show you a **16-character password** (with spaces — ignore the spaces). Copy it.
> 5. Open the **Secrets** panel in the GranClaw sidebar and add these four secrets:
>    - `SMTP_HOST` = `smtp.gmail.com`
>    - `SMTP_PORT` = `587`
>    - `SMTP_USER` = your full Gmail address
>    - `SMTP_PASS` = the 16-character password (spaces can be there or not, both work)
> 6. If you also want me to read mail, add four more:
>    - `IMAP_HOST` = `imap.gmail.com`
>    - `IMAP_PORT` = `993`
>    - `IMAP_USER` = same as `SMTP_USER`
>    - `IMAP_PASS` = same 16-character password
> 7. Save and tell me when done.

**Outlook / Microsoft 365:**

> 1. Enable 2-Step Verification: <https://account.microsoft.com/proofs/Manage/additional> (required).
> 2. Go to <https://account.microsoft.com/security> → **Advanced security options** → **App passwords** → **Create a new app password**.
> 3. Open Secrets in the sidebar and add:
>    - `SMTP_HOST` = `smtp-mail.outlook.com`, `SMTP_PORT` = `587`
>    - `IMAP_HOST` = `outlook.office365.com`, `IMAP_PORT` = `993`
>    - `SMTP_USER` / `IMAP_USER` = your full Outlook email
>    - `SMTP_PASS` / `IMAP_PASS` = the app password
> 4. Save and tell me when done.

**Fastmail:**

> 1. Go to <https://app.fastmail.com/settings/security/apps>.
> 2. Click **New app password**, name it `GranClaw`, grant **Mail** access, click **Generate**.
> 3. Add these secrets in the sidebar: `SMTP_HOST=smtp.fastmail.com`, `SMTP_PORT=587`, `IMAP_HOST=imap.fastmail.com`, `IMAP_PORT=993`, `SMTP_USER` and `IMAP_USER` = your Fastmail address, `SMTP_PASS` and `IMAP_PASS` = the generated app password.
> 4. Save and tell me when done.

**Zoho:** <https://accounts.zoho.com/home#security/app_passwords>. Hosts: `smtp.zoho.com:465` (implicit TLS) and `imap.zoho.com:993`.

**Yahoo:** <https://login.yahoo.com/account/security> → App passwords. Hosts: `smtp.mail.yahoo.com:465` and `imap.mail.yahoo.com:993`.

**Proton Bridge:** install the Bridge app locally, copy the Bridge-issued password it shows. Hosts: `127.0.0.1` with the ports Bridge displays.

**Self-hosted / custom:** ask the user for the SMTP and IMAP host+port pair and walk them through creating an app-specific password in their admin panel (most mail servers support this).

Do **not** accept the user's regular account password. If they try to paste it, refuse and explain why.

### Sending

```bash
python3 .pi/skills/email/send-smtp.py \
  --to alice@example.com \
  --subject "Subject line" \
  --body "Plain text body"

# HTML body
python3 .pi/skills/email/send-smtp.py \
  --to alice@example.com \
  --subject "Hi" \
  --html "<p>Hello <b>world</b></p>"

# CC, BCC, multiple recipients
python3 .pi/skills/email/send-smtp.py \
  --to "alice@example.com,bob@example.com" \
  --cc "carol@example.com" \
  --bcc "boss@example.com" \
  --subject "Team sync" \
  --body "..."
```

The helper uses STARTTLS on port 587 and implicit TLS on 465. It exits non-zero and prints to stderr if the env vars are missing or the server rejects auth.

### Reading

```bash
# Recent messages from a mailbox
python3 .pi/skills/email/read-imap.py list --mailbox INBOX --max 20

# IMAP search (syntax is DIFFERENT from Gmail search — see below)
python3 .pi/skills/email/read-imap.py search \
  --mailbox INBOX \
  --query 'UNSEEN FROM "boss@example.com"' \
  --max 20

# Fetch a message by UID
python3 .pi/skills/email/read-imap.py fetch --mailbox INBOX --uid 12345

# List all mailboxes
python3 .pi/skills/email/read-imap.py mailboxes
```

IMAP search keys (note: uppercase, no colons, quoted strings for values):

- `UNSEEN`, `SEEN`, `ANSWERED`, `FLAGGED`, `DELETED`
- `FROM "alice@example.com"`, `TO "bob@..."`, `CC "..."`, `BCC "..."`
- `SUBJECT "meeting"`
- `BODY "phrase"`
- `SINCE 1-Jan-2026`, `BEFORE 31-Dec-2026`
- `LARGER 10000`, `SMALLER 100000` (bytes)
- Combine with spaces (implicit AND): `UNSEEN FROM "boss@..." SUBJECT "urgent"`
- OR: `OR (UNSEEN) (FLAGGED)`

**Important — Gmail IMAP quirks:**
- Use label names instead of folder names: the `INBOX` mailbox is the inbox, but `[Gmail]/Sent Mail`, `[Gmail]/Drafts`, `[Gmail]/All Mail`, `[Gmail]/Spam`, `[Gmail]/Trash` are the special mailboxes. Run `python3 .pi/skills/email/read-imap.py mailboxes` to see them.
- `X-GM-RAW` is a Gmail-specific extension that lets you use Gmail search syntax inside an IMAP search: `X-GM-RAW "from:boss@company.com has:attachment"`. Supported by our `--query` passthrough.
- Gmail does NOT delete messages when you copy them to `[Gmail]/Trash` unless you also expunge — but our reader is read-only so this won't bite you.

---

## Gmail via OAuth (advanced — only when the user needs it)

This path uses `@mariozechner/gmcli` bundled in the image and unlocks the Gmail API: labels, drafts, threads, and Gmail-native search. It takes ~15 minutes to set up (Google Cloud Console project, OAuth consent screen, OAuth client download) versus ~3 minutes for the SMTP app-password path above, so **only suggest it if the user explicitly asks for Gmail-specific features** or one of the "advanced" conditions in the decision table at the top of this file applies.

### First-time setup (once per agent, per Gmail address)

**Step 1 — Check if already set up.**

```bash
./.pi/skills/email/gmcli.sh accounts list
```

If the command prints at least one account with `ok` status, skip to **Using it**. Otherwise continue below.

**Step 2 — Require `GMAIL_CREDENTIALS` in the vault.**

Before anything else, verify the OAuth client JSON is available as a secret:

```bash
[ -n "${GMAIL_CREDENTIALS-}" ] && echo present || echo missing
```

If it says `missing`, **STOP and ask the user to set it up**. Do not try to run the OAuth flow without credentials. Say (adapting to the user's language — Spanish, Catalan, whatever they're using):

> To enable Gmail I need a Google Cloud OAuth "Desktop app" credentials JSON. I'll walk you through creating one — it's free and takes ~3 minutes:
>
> 1. Go to <https://console.cloud.google.com/projectcreate> and create a new project (or pick an existing one).
> 2. Enable the Gmail API: <https://console.cloud.google.com/apis/api/gmail.googleapis.com>
> 3. Configure the OAuth consent screen at <https://console.cloud.google.com/auth/branding>. User type: **External**. App name: whatever you like.
> 4. Add your own Gmail address as a test user: <https://console.cloud.google.com/auth/audience>
> 5. Create an OAuth Client at <https://console.cloud.google.com/auth/clients> — "Create Client" → Application type: **Desktop app**. Download the JSON.
> 6. Open the **Secrets** panel in the GranClaw sidebar, click "Add secret", name it exactly `GMAIL_CREDENTIALS`, paste the entire JSON file contents as the value, and save.
> 7. Tell me when it's done and I'll continue.

Then **STOP** and wait for the user. Do not call gmcli again until they confirm.

**Step 3 — Run the one-time OAuth flow.**

Once the user confirms `GMAIL_CREDENTIALS` is set, kick off gmcli's browserless OAuth:

```bash
./.pi/skills/email/gmcli.sh accounts add <user-email> --manual
```

gmcli prints an authorization URL. Show it to the user verbatim and ask:

> Please open this URL in your browser, sign in to your Gmail account, click "Allow", and paste the URL you land on (it will start with `http://localhost` or similar) back here:
>
> `<paste the URL gmcli printed>`

**Step 4 — Pass the redirect URL back to gmcli.**

When the user pastes the redirect URL, complete the exchange. gmcli's `--manual` flow reads the URL from stdin or accepts it as a prompt answer — check `gmcli accounts add --help` for the exact syntax if it changes. If gmcli blocks waiting for input, run with the URL piped in:

```bash
echo '<redirect-url>' | ./.pi/skills/email/gmcli.sh accounts add <user-email> --manual
```

On success gmcli writes the refresh token to `$GRANCLAW_WORKSPACE_DIR/.gmcli/accounts.json`. That file lives on the agent's persistent workspace volume, so it survives container restarts and redeploys — there is no second secret to manage. Run `./.pi/skills/email/gmcli.sh accounts list` to confirm the account shows up with `ok` status, then you're done with setup and can move on to **Using it**.

If the workspace volume is ever wiped (new instance, manual reset), just re-run Steps 3–4 to regenerate the token. `GMAIL_CREDENTIALS` in the vault stays untouched.

### Using it

All Gmail operations go through the wrapper, never raw `gmcli`:

```bash
# Search — standard Gmail query syntax
./.pi/skills/email/gmcli.sh <user-email> search "in:inbox is:unread" --max 20
./.pi/skills/email/gmcli.sh <user-email> search "from:alice@example.com has:attachment after:2026/01/01"

# Read a thread
./.pi/skills/email/gmcli.sh <user-email> thread <threadId>

# Send
./.pi/skills/email/gmcli.sh <user-email> send --to alice@example.com --subject "Hi" --body "Hello"

# Drafts
./.pi/skills/email/gmcli.sh <user-email> drafts list
./.pi/skills/email/gmcli.sh <user-email> drafts create --to alice@example.com --subject "WIP" --body "Draft body"

# Labels
./.pi/skills/email/gmcli.sh <user-email> labels list
./.pi/skills/email/gmcli.sh <user-email> labels <threadId> --remove UNREAD --add STARRED
```

Gmail search operators you'll use most: `in:inbox`, `in:sent`, `is:unread`, `is:starred`, `from:`, `to:`, `subject:`, `has:attachment`, `filename:pdf`, `after:YYYY/MM/DD`, `before:YYYY/MM/DD`, `label:Work`. Combine with spaces.

Do not hard-code the user's email address in commands — read it from `./.pi/skills/email/gmcli.sh accounts list` or remember it from the conversation.

---

## Troubleshooting

**`gmcli: command not found`** — the Docker image is too old. Tell the user the image needs to be pulled (`docker pull ghcr.io/aitrace-dev/granclaw:latest`).

**`gmcli wrapper: GMAIL_CREDENTIALS missing client_id/client_secret`** — the user pasted the wrong file, or an incomplete one. The correct file is the JSON downloaded from the OAuth Clients page in Google Cloud Console, and it contains either an `"installed"` or `"web"` top-level key. Ask them to re-download from Google Cloud Console.

**`invalid_grant` from gmcli** — the refresh token has been revoked (user changed password, removed the app from their Google account, or the OAuth app expired because it's in testing mode and was never verified). Re-run Step 3 of first-time setup.

**SMTP `535 Authentication failed`** — either the app password is wrong, the user pasted the account password by mistake, or 2FA isn't enabled on the provider (some providers refuse SMTP entirely without 2FA). Ask the user to regenerate the app password.

**IMAP `A001 NO [AUTHENTICATIONFAILED]`** — same as SMTP: wrong or missing app password.

**Empty search results** — Gmail's search syntax is NOT the same as IMAP's. If the user gave you a Gmail-style query (`is:unread from:x`) and you're on the IMAP branch, translate it: `UNSEEN FROM "x"`.
