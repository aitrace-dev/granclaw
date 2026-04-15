#!/bin/bash
# Per-agent Gmail CLI wrapper.
#
# Wraps @mariozechner/gmcli so each agent gets its own isolated ~/.gmcli/
# under its workspace (gmcli hard-codes os.homedir() at module load — no
# GMCLI_HOME env var upstream), and so OAuth credentials + refresh tokens
# live in the GranClaw secrets vault instead of on disk.
#
# Every invocation rebuilds credentials.json and accounts.json from the
# GMAIL_CREDENTIALS and GMAIL_ACCOUNTS env vars (which the orchestrator
# injects from the vault on agent spawn), so rotating a secret in the UI
# is picked up on the next call with zero ceremony.
set -eu

WORKSPACE="${GRANCLAW_WORKSPACE_DIR:-$PWD}"
export HOME="$WORKSPACE"
mkdir -p "$HOME/.gmcli"

# GMAIL_CREDENTIALS is either:
#   - the raw Google Cloud Console OAuth client JSON ({installed:{...}} or {web:{...}})
#   - the already-flattened form gmcli stores ({clientId, clientSecret})
# Accept both.
if [ -n "${GMAIL_CREDENTIALS-}" ]; then
  python3 - "$HOME/.gmcli/credentials.json" <<'PYEOF'
import json, os, sys
dst = sys.argv[1]
raw = os.environ["GMAIL_CREDENTIALS"].strip()
try:
    data = json.loads(raw)
except json.JSONDecodeError as e:
    sys.stderr.write(f"gmcli wrapper: GMAIL_CREDENTIALS is not valid JSON: {e}\n")
    sys.exit(2)
if "installed" in data:
    src = data["installed"]
elif "web" in data:
    src = data["web"]
else:
    src = data
out = {
    "clientId": src.get("client_id") or src.get("clientId"),
    "clientSecret": src.get("client_secret") or src.get("clientSecret"),
}
if not out["clientId"] or not out["clientSecret"]:
    sys.stderr.write(
        "gmcli wrapper: GMAIL_CREDENTIALS missing client_id / client_secret. "
        "Expected the JSON downloaded from Google Cloud Console → OAuth Clients → Desktop app.\n"
    )
    sys.exit(2)
with open(dst, "w") as f:
    json.dump(out, f)
PYEOF
fi

# GMAIL_ACCOUNTS holds the gmcli-written accounts.json (refresh tokens).
# Only overwrite when the secret is set — during first-time onboarding it
# won't be, and we want gmcli's own `accounts add` flow to write the file.
if [ -n "${GMAIL_ACCOUNTS-}" ]; then
  printf '%s' "$GMAIL_ACCOUNTS" > "$HOME/.gmcli/accounts.json"
fi

exec gmcli "$@"
