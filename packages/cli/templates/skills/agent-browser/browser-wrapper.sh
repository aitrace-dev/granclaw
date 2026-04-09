#!/usr/bin/env bash
# browser-wrapper.sh — wraps agent-browser with auto-session + auto-screenshot
#
# Usage: ./browser-wrapper.sh <agent-browser args...>
#
# Behavior:
#   - First command creates a session dir + meta.json
#   - Every command (except screenshot/pdf/close) auto-captures a screenshot
#   - "close" marks the session as closed
#   - Session ID tracked via .active-session file

set -euo pipefail

SESSIONS_DIR="${AGENT_BROWSER_SESSIONS_DIR:-.browser-sessions}"
ACTIVE_FILE="$SESSIONS_DIR/.active-session"
AGENT_BROWSER_BIN="${AGENT_BROWSER_BIN:-agent-browser}"

# ── Helpers ───────────────────────────────────────────────────────────────

timestamp_ms() {
  if date +%s%3N 2>/dev/null | grep -qE '^[0-9]+$'; then
    date +%s%3N
  else
    # macOS fallback: seconds * 1000
    echo "$(( $(date +%s) * 1000 ))"
  fi
}

get_active_session() {
  if [ -f "$ACTIVE_FILE" ]; then
    local sid
    sid=$(cat "$ACTIVE_FILE")
    if [ -n "$sid" ] && [ -d "$SESSIONS_DIR/$sid" ]; then
      echo "$sid"
      return
    fi
  fi
  echo ""
}

create_session() {
  local ts
  ts=$(timestamp_ms)
  local id="sess-$ts"
  mkdir -p "$SESSIONS_DIR/$id"
  echo "$id" > "$ACTIVE_FILE"
  printf '{"id":"%s","name":null,"status":"active","createdAt":%s,"closedAt":null,"commands":[]}\n' \
    "$id" "$ts" > "$SESSIONS_DIR/$id/meta.json"
  echo "$id"
}

close_session() {
  local session_id="$1"
  local meta="$SESSIONS_DIR/$session_id/meta.json"
  local ts
  ts=$(timestamp_ms)
  # Use temp file for portable sed
  sed "s/\"status\":\"active\"/\"status\":\"closed\"/" "$meta" \
    | sed "s/\"closedAt\":null/\"closedAt\":$ts/" > "$meta.tmp"
  mv "$meta.tmp" "$meta"
  printf '' > "$ACTIVE_FILE"
}

append_command() {
  local session_id="$1"
  local args_escaped="$2"
  local ts="$3"
  local screenshot_file="$4"
  local meta="$SESSIONS_DIR/$session_id/meta.json"

  # Build the JSON entry
  local entry
  if [ -n "$screenshot_file" ]; then
    entry="{\"args\":\"$args_escaped\",\"timestamp\":$ts,\"screenshot\":\"$screenshot_file\"}"
  else
    entry="{\"args\":\"$args_escaped\",\"timestamp\":$ts,\"screenshot\":null}"
  fi

  # Append to the commands array in meta.json
  if grep -q '"commands":\[\]' "$meta"; then
    # Empty array case
    sed "s/\"commands\":\[\]/\"commands\":[$entry]/" "$meta" > "$meta.tmp"
  else
    # Non-empty array: add before closing ]
    sed "s/\(\"commands\":\[.*\)\]/\1,$entry]/" "$meta" > "$meta.tmp"
  fi
  mv "$meta.tmp" "$meta"
}

escape_json_string() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g; s/	/\\t/g'
}

# ── Main ──────────────────────────────────────────────────────────────────

# Ensure sessions dir exists
mkdir -p "$SESSIONS_DIR"

FIRST_ARG="${1:-}"
ALL_ARGS="$*"

# Handle close command
if [ "$FIRST_ARG" = "close" ]; then
  "$AGENT_BROWSER_BIN" "$@"
  EXIT_CODE=$?
  SESSION_ID=$(get_active_session)
  if [ -n "$SESSION_ID" ]; then
    close_session "$SESSION_ID"
  fi
  exit $EXIT_CODE
fi

# Get or create session
SESSION_ID=$(get_active_session)
if [ -z "$SESSION_ID" ]; then
  SESSION_ID=$(create_session)
fi

# Auto-inject persistent browser profile if it exists
# Profile keeps all cookies, localStorage, IndexedDB across sessions
PROFILE_ARGS=""
PROFILE_DIR=".browser-profile"
if [ -d "$PROFILE_DIR" ] && ! echo "$ALL_ARGS" | grep -q -- "--profile"; then
  PROFILE_ARGS="--profile $PROFILE_DIR"

  # If opening/navigating, kill any stale daemon first so the profile flag takes effect.
  # A running daemon ignores --profile on subsequent commands.
  if [ "$FIRST_ARG" = "go" ] || [ "$FIRST_ARG" = "open" ]; then
    "$AGENT_BROWSER_BIN" close 2>/dev/null || true
  fi
fi

# Run the actual command, capturing exit code
set +e
if [ -n "$PROFILE_ARGS" ]; then
  "$AGENT_BROWSER_BIN" $PROFILE_ARGS "$@"
else
  "$AGENT_BROWSER_BIN" "$@"
fi
EXIT_CODE=$?
set -e

# Auto-capture screenshot (skip for screenshot/pdf/snapshot commands)
TIMESTAMP=$(timestamp_ms)
SCREENSHOT_FILE=""
if [ "$FIRST_ARG" != "screenshot" ] && [ "$FIRST_ARG" != "pdf" ] && [ "$FIRST_ARG" != "snapshot" ]; then
  SCREENSHOT_FILE="$TIMESTAMP.png"
  "$AGENT_BROWSER_BIN" screenshot "$SESSIONS_DIR/$SESSION_ID/$SCREENSHOT_FILE" 2>/dev/null || true
fi

# Record command in meta.json
ESCAPED_ARGS=$(escape_json_string "$ALL_ARGS")
append_command "$SESSION_ID" "$ESCAPED_ARGS" "$TIMESTAMP" "$SCREENSHOT_FILE"

exit $EXIT_CODE
