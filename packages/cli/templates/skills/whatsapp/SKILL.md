---
name: whatsapp
description: Send and read WhatsApp messages on behalf of the user via the bundled whatsapp-cli. Uses the unofficial whatsmeow library with QR-code login; the session survives about 20 days. NOT for bulk messaging, cold outreach, or burner numbers — Meta bans accounts that behave like bots.
user-invocable: false
allowed-tools: [bash, read, write]
---

# WhatsApp

Send and receive WhatsApp messages on behalf of the user, using the personal WhatsApp account on their phone. One-time QR login, then the session persists for ~20 days and automatically refreshes while the user keeps the linked device active.

## How it works

This skill shells out to `whatsapp-cli` (shipped in the container at `/usr/local/bin/whatsapp-cli`), which is a static Go binary built on top of [whatsmeow](https://github.com/tulir/whatsmeow). It authenticates the same way the "WhatsApp Web" / desktop app does — the user scans a QR code from their phone under **Settings → Linked Devices → Link a Device**, and the phone signs a device-key handshake back. No Meta Business API, no OAuth, no tokens.

All commands must go through the wrapper at `./.pi/skills/whatsapp/whatsapp.sh`, never raw `whatsapp-cli`. The wrapper pins `--store` to `$GRANCLAW_WORKSPACE_DIR/.whatsapp` so each agent's session is isolated under its own workspace volume.

---

## ⚠️ Safety rules — read before every conversation about WhatsApp

WhatsApp actively detects and bans accounts that behave like bots. These are not theoretical — there are ongoing waves of "Your account may be at risk" warnings and permanent bans tied to unofficial libraries in 2025–2026. Follow these rules strictly:

1. **Never bulk-send.** Do not send the same or near-duplicate message to more than a handful of recipients per hour. If the user asks for a broadcast, refuse and suggest they use Meta's official Broadcast Lists from their phone instead.
2. **Never cold-contact strangers.** Only message people who have already messaged the user first, or whom the user knows personally. If the user asks "send this to a number I've never talked to", warn them it's high-risk.
3. **Human pace only.** Maximum ~3 sends per minute, with natural pauses. Not a typing-speed metric — a minute between sends when having a back-and-forth.
4. **The user's primary account, ideally warmed.** New or burner numbers get flagged much faster than long-lived primary accounts.
5. **Do not link to more than one agent workspace at once.** WhatsApp's device limit is 4 linked devices; the user probably has desktop + web already, so leave room. Linking one agent is fine, linking five will look like abuse.
6. **The session file contains WhatsApp device keys** (`$GRANCLAW_WORKSPACE_DIR/.whatsapp/`). Treat it like an SSH private key: never print its contents in chat, never copy it outside the workspace, never commit it anywhere.

If the user asks for something that violates these rules, **refuse and explain why** — this is the user protecting themselves from losing their account.

---

## First-time setup (one-time QR scan, session lasts ~20 days)

### Step 1 — Check if already authenticated

```bash
./.pi/skills/whatsapp/whatsapp.sh auth
```

If the command exits 0 immediately and says something like `already linked to <phone>`, you're done — skip to **Using it**.

If you see a big Unicode QR code printed in the output, the session has expired (or was never set up). Continue to Step 2.

### Step 2 — Show the QR to the user

Capture the QR output verbatim and paste it back into chat inside a triple-backtick code block so the chat UI renders it as monospace preformatted text. The user's phone camera will read it directly from the screen.

Example (do this with the real output from `whatsapp.sh auth`):

> Please open WhatsApp on your phone → **Settings** → **Linked Devices** → **Link a Device**, then point the camera at this QR code:
>
> ```
> █▀▀▀▀▀█ ▄█▀▄  █▀▀▀▀▀█
> █ ███ █ ▀ █▀▄ █ ███ █
> █ ▀▀▀ █ █▀█▄  █ ▀▀▀ █
> ▀▀▀▀▀▀▀ █▄▀ █ ▀▀▀▀▀▀▀
> ▄█▄▀▄ ▀█ ▀▄██▀ ▀▀▀▄▄█
> (… the rest of the QR …)
> ```
>
> Tell me once your phone shows "WhatsApp-cli" as a linked device and I'll confirm.

**Telegram users:** if the user is chatting with you through the Telegram bridge rather than the web UI, the QR code will render as monospace in Telegram's code-block style but may wrap on narrow screens. Ask them to either (a) rotate their phone to landscape, or (b) open the GranClaw web UI at `$GRANCLAW_PUBLIC_URL` for the auth step only. After auth the session persists, and subsequent commands work fine from Telegram.

### Step 3 — Wait for the user to scan

`whatsapp.sh auth` blocks until the handshake completes. Once the phone signs back, the command prints a confirmation line and exits 0. The session file is now at `$GRANCLAW_WORKSPACE_DIR/.whatsapp/whatsapp.db` and survives container restarts.

### Step 4 — Confirm

Run `./.pi/skills/whatsapp/whatsapp.sh auth` one more time. It should exit immediately with "already linked".

Do NOT print the session file, its path, or any of its fields after setup. Just confirm "linked and ready" to the user.

---

## Using it

All commands go through the wrapper:

```bash
# Sync recent messages (pulls new messages since last sync into the local DB)
./.pi/skills/whatsapp/whatsapp.sh sync

# List chats (most recent first)
./.pi/skills/whatsapp/whatsapp.sh chats list
./.pi/skills/whatsapp/whatsapp.sh chats list --limit 20

# Search contacts by name or phone
./.pi/skills/whatsapp/whatsapp.sh contacts search "Alice"

# List messages in a chat (by contact JID or name)
./.pi/skills/whatsapp/whatsapp.sh messages list --chat "Alice" --limit 20
./.pi/skills/whatsapp/whatsapp.sh messages search --chat "Alice" --query "meeting"

# Send a text message
./.pi/skills/whatsapp/whatsapp.sh send --to "+34600000000" --message "Hi, can we move the meeting?"

# Send a file (image, PDF, audio, etc.)
./.pi/skills/whatsapp/whatsapp.sh send --to "+34600000000" --file /path/to/photo.jpg

# Download media from a received message
./.pi/skills/whatsapp/whatsapp.sh media download --message-id <id> --out /path/to/save.jpg
```

Run `./.pi/skills/whatsapp/whatsapp.sh --help` for the authoritative command list — upstream occasionally adds subcommands.

### Phone number format

Always use **E.164** format: `+` followed by country code and number, digits only, no spaces or dashes. Examples: `+34600000000` (Spain), `+15551234567` (US).

If the user gives you a number without a country code, ask which country they're in — don't guess. Getting this wrong silently sends to the wrong person.

### Chat identity (JIDs)

WhatsApp internally addresses chats by **JIDs** (e.g. `34600000000@s.whatsapp.net` for a direct chat, `1234567890-1609459200@g.us` for a group). Commands accept either a phone number (for direct chats) or a JID. When the user names a contact like "Alice", resolve it first via `contacts search` to get the JID, then use that JID in subsequent commands — more reliable than passing a display name.

### Reading vs syncing

`messages list` reads from the local SQLite cache. If the user asks "do I have any new messages from X?", run `sync` first to pull anything received since last check, then `messages list`. Don't trust the cache to be fresh.

---

## Security rules

1. **Never echo the session file's contents** or its path in full back to the user. Refer to it as "the linked-device session".
2. **Never ask the user to paste a WhatsApp password, 6-digit code, or recovery number in chat.** This skill uses QR device-linking only — if any flow asks the user for codes beyond "open WhatsApp → Linked Devices → scan", something is wrong and you should stop.
3. **Never send from one user's session as if you were someone else.** The session is bound to the phone that scanned the QR; that phone's owner is the sender of every message you send. Be explicit about this when the user asks questions like "can we send as..."

---

## Troubleshooting

**`whatsapp-cli: command not found`** — the Docker image is too old. Tell the user the image needs to be pulled (`docker pull ghcr.io/aitrace-dev/granclaw:latest`).

**QR code expired** — Whatsapp rotates the pairing code every ~20 seconds. If the user is slow, re-run `whatsapp.sh auth` and show them the fresh one.

**`device not linked` / `failed to connect`** — the session was revoked (the user removed the linked device from their phone, or WhatsApp refreshed all links). Re-run Step 1 of first-time setup.

**`rate-limited` / `temporarily banned`** — slow down. Stop sending for at least 30 minutes, then try one message to confirm the block lifted. If it persists, the account may be under review; do not keep pushing or it becomes permanent.

**`session expired` after exactly ~20 days** — expected behaviour. Re-scan the QR following Step 2. Message history in the local cache is preserved across re-auths.

**Messages not appearing in `messages list`** — run `./.pi/skills/whatsapp/whatsapp.sh sync` first, then retry the list command.
