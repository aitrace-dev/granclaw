---
name: email
description: Send and read email. Gmail uses OAuth 2.0 via the bundled gmcli; any other provider (Outlook, Fastmail, Zoho, Yahoo, self-hosted) uses SMTP/IMAP with an app password. Credentials always live in the user's secrets vault — never ask the user to paste a password in chat.
user-invocable: false
allowed-tools: [bash, read, write]
---

# Email

Send and read mail on behalf of the user. Two branches, one skill:

- **Gmail / Google Workspace** → OAuth 2.0 via `gmcli` (bundled in the image)
- **Everything else** → Generic SMTP/IMAP via Python stdlib helpers

Pick the branch by asking the user which provider their mailbox is on.

---

## Golden security rules

1. **Never accept a password, app password, OAuth token, or client secret in chat.** The user pastes credentials into the Secrets panel in the GranClaw sidebar; the runtime injects them into your environment on startup. Your job is to tell the user what to put there, not to handle the value yourself.
2. **Never echo a secret's value back.** Refer to secrets by name (`GMAIL_CREDENTIALS`, `SMTP_PASS`) and never print `$GMAIL_CREDENTIALS` or paste it back to the user.
3. **Never commit a secret to disk outside `$GRANCLAW_WORKSPACE_DIR/.gmcli/`** (and those files are rebuilt from env on every call anyway).

---

## Gmail branch

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

On success gmcli writes the refresh token to `$GRANCLAW_WORKSPACE_DIR/.gmcli/accounts.json`.

**Step 5 — Persist accounts.json to the vault.**

The workspace volume normally survives container restarts, but to make rotations and cross-instance restores clean, ask the user to copy the generated file into a second secret:

```bash
cat "$GRANCLAW_WORKSPACE_DIR/.gmcli/accounts.json"
```

> OAuth successful. For the refresh token to survive container rebuilds, please:
>
> 1. Open the **Secrets** panel again.
> 2. Add a new secret named exactly `GMAIL_ACCOUNTS`.
> 3. Paste everything I just printed as the value.
> 4. Save and tell me when it's done.

From this point on, the skill is fully vault-backed — every future call materializes both `credentials.json` and `accounts.json` from env.

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

## SMTP/IMAP branch (everything that is not Gmail)

For Outlook, Fastmail, Zoho, Yahoo, Proton Bridge, or any self-hosted mail server. These providers expose standard SMTP and IMAP and support **app passwords** (a separate 16-character password the user generates in their account settings, specifically so third-party tools don't see the real account password).

### First-time setup

Ask the user to add the following secrets in the **Secrets** panel. Required for sending:

| Secret | Example | Notes |
|---|---|---|
| `SMTP_HOST` | `smtp.fastmail.com`, `smtp-mail.outlook.com` | Provider's SMTP host |
| `SMTP_PORT` | `587` (STARTTLS) or `465` (implicit TLS) | 587 is the modern default |
| `SMTP_USER` | `alice@fastmail.com` | Full email address |
| `SMTP_PASS` | `app-password-here` | **App password, not account password** |

Required for reading:

| Secret | Example |
|---|---|
| `IMAP_HOST` | `imap.fastmail.com` |
| `IMAP_PORT` | `993` (SSL — almost always) |
| `IMAP_USER` | `alice@fastmail.com` (usually same as SMTP_USER) |
| `IMAP_PASS` | same app password as SMTP_PASS for most providers |

Provider-specific app password docs — walk the user to the right one:

- **Outlook/Microsoft 365**: <https://support.microsoft.com/en-us/account-billing/5896ed9b-4263-e681-128a-a6f2979a7944> (requires 2FA enabled first)
- **Fastmail**: <https://app.fastmail.com/settings/security/apps> → "Create new app password"
- **Zoho**: <https://accounts.zoho.com/home#security/app_passwords>
- **Yahoo**: <https://login.yahoo.com/account/security> → App passwords
- **Proton Bridge**: run the Bridge app, copy the password it shows (SMTP_HOST is `127.0.0.1`, port varies)
- **Gmail via SMTP** (only if for some reason not using the Gmail branch above): <https://myaccount.google.com/apppasswords> — requires 2-Step Verification

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

# IMAP search (syntax is different from Gmail — see below)
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

The `list` command returns the latest N messages regardless of read state. Use `search` with `UNSEEN` if you want the inbox-unread flow.

---

## Troubleshooting

**`gmcli: command not found`** — the Docker image is too old. Tell the user the image needs to be pulled (`docker pull ghcr.io/aitrace-dev/granclaw:latest`).

**`gmcli wrapper: GMAIL_CREDENTIALS missing client_id/client_secret`** — the user pasted the wrong file, or an incomplete one. The correct file is the JSON downloaded from the OAuth Clients page in Google Cloud Console, and it contains either an `"installed"` or `"web"` top-level key. Ask them to re-download from Google Cloud Console.

**`invalid_grant` from gmcli** — the refresh token has been revoked (user changed password, removed the app from their Google account, or the OAuth app expired because it's in testing mode and was never verified). Re-run Step 3 of first-time setup.

**SMTP `535 Authentication failed`** — either the app password is wrong, the user pasted the account password by mistake, or 2FA isn't enabled on the provider (some providers refuse SMTP entirely without 2FA). Ask the user to regenerate the app password.

**IMAP `A001 NO [AUTHENTICATIONFAILED]`** — same as SMTP: wrong or missing app password.

**Empty search results** — Gmail's search syntax is NOT the same as IMAP's. If the user gave you a Gmail-style query (`is:unread from:x`) and you're on the IMAP branch, translate it: `UNSEEN FROM "x"`.
