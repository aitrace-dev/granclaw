#!/bin/bash
# Per-agent Gmail CLI wrapper.
#
# Wraps @mariozechner/gmcli so each agent gets its own isolated ~/.gmcli/
# under its workspace (gmcli hard-codes os.homedir() at module load — no
# GMCLI_HOME env var upstream).
#
# Every invocation rebuilds ~/.gmcli/credentials.json from the
# GMAIL_CREDENTIALS vault secret so rotating the OAuth client in the UI
# is picked up immediately. The refresh token file (accounts.json) lives
# under the workspace volume and is written once by gmcli's `accounts add`
# flow — the workspace volume persists across container restarts, so
# there is no second vault secret to manage.
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

exec gmcli "$@"
