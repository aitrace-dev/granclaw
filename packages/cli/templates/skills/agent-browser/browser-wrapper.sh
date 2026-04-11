#!/usr/bin/env bash
# browser-wrapper.sh — wraps agent-browser with auto-session + video recording
#
# Usage: ./browser-wrapper.sh <agent-browser args...>
#
# Behavior:
#   - First command creates a session dir + meta.json and starts a WebM recording
#   - Each command updates a heartbeat and appends to meta.json atomically
#   - Next invocation reconciles stale sessions (heartbeat > STALE_TIMEOUT)
#   - "close" stops the recording, closes the browser, finalizes meta.json
#   - `record *` commands are rejected — recording is managed automatically
#
# Concurrency:
#   - All session-state mutations are serialized via a mkdir-based lock
#   - meta.json is written atomically by a Node helper (meta-helper.js)
#
# Crash safety:
#   - agent-browser flushes WebM on browser close even if record stop was missed
#   - Stale sessions are reconciled on the next wrapper invocation

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
META_HELPER="$SCRIPT_DIR/meta-helper.js"

SESSIONS_DIR="${AGENT_BROWSER_SESSIONS_DIR:-.browser-sessions}"
ACTIVE_FILE="$SESSIONS_DIR/.active-session"
LOCK_FILE="$SESSIONS_DIR/.lock"
AGENT_BROWSER_BIN="${AGENT_BROWSER_BIN:-agent-browser}"
STALE_TIMEOUT_MS="${AGENT_BROWSER_STALE_TIMEOUT_MS:-900000}"  # 15 min

# ── Utilities ─────────────────────────────────────────────────────────────

timestamp_ms() {
  node -e 'process.stdout.write(String(Date.now()))'
}

# Serialize a block of code via a mkdir-based lock (portable: POSIX mkdir
# is atomic across macOS + Linux and does not need flock(1)).
with_lock() {
  local lock_dir="${LOCK_FILE}.d"
  local tries=0
  while ! mkdir "$lock_dir" 2>/dev/null; do
    tries=$((tries + 1))
    if [ "$tries" -gt 200 ]; then
      rm -rf "$lock_dir" 2>/dev/null || true
    fi
    sleep 0.05
  done
  "$@"
  local rc=$?
  rmdir "$lock_dir" 2>/dev/null || true
  return $rc
}

meta() {
  node "$META_HELPER" "$@"
}

get_active_session() {
  if [ -f "$ACTIVE_FILE" ]; then
    local sid
    sid=$(cat "$ACTIVE_FILE" 2>/dev/null || printf '')
    if [ -n "$sid" ] && [ -d "$SESSIONS_DIR/$sid" ]; then
      printf '%s' "$sid"
      return
    fi
  fi
  printf ''
}

is_stale() {
  local session_id="$1"
  local hb
  hb=$(meta get-heartbeat "$SESSIONS_DIR/$session_id" 2>/dev/null || printf '0')
  if [ -z "$hb" ] || [ "$hb" = "0" ]; then printf '1'; return; fi
  local now
  now=$(timestamp_ms)
  local age=$((now - hb))
  if [ "$age" -gt "$STALE_TIMEOUT_MS" ]; then printf '1'; else printf '0'; fi
}

reconcile_stale() {
  local session_id="$1"
  [ -z "$session_id" ] && return
  [ -d "$SESSIONS_DIR/$session_id" ] || return
  local now
  now=$(timestamp_ms)
  meta close "$SESSIONS_DIR/$session_id" "$now" stale 2>/dev/null || true
  printf '' > "$ACTIVE_FILE"
}

create_session() {
  local ts
  ts=$(timestamp_ms)
  local id="sess-$ts"
  meta create "$SESSIONS_DIR/$id" "$ts" > /dev/null
  printf '%s' "$id" > "$ACTIVE_FILE"
  printf '%s' "$id"
}

start_recording_if_needed() {
  local session_id="$1"
  [ -z "$session_id" ] && return
  local existing
  existing=$(meta get-recording "$SESSIONS_DIR/$session_id" 2>/dev/null || printf '')
  if [ -n "$existing" ]; then return; fi

  local file="recording.webm"
  local path="$SESSIONS_DIR/$session_id/$file"
  if "$AGENT_BROWSER_BIN" record start "$path" >/dev/null 2>&1; then
    meta set-video "$SESSIONS_DIR/$session_id" "$file" 2>/dev/null || true
  fi
}

stop_recording_quietly() {
  "$AGENT_BROWSER_BIN" record stop >/dev/null 2>&1 || true
}

# ── Guards ────────────────────────────────────────────────────────────────
# Recording is owned by the wrapper. Reject direct calls from the agent.

FIRST_ARG="${1:-}"

if [ "$FIRST_ARG" = "record" ]; then
  echo "✗ Recording is managed automatically by the wrapper." >&2
  echo "  Do not call 'record start' or 'record stop' directly." >&2
  exit 2
fi

# ── Ensure sessions dir ───────────────────────────────────────────────────
mkdir -p "$SESSIONS_DIR"

# ── close — explicit end of session ───────────────────────────────────────
if [ "$FIRST_ARG" = "close" ]; then
  SESSION_ID=""
  _get_sid() { SESSION_ID=$(get_active_session); }
  with_lock _get_sid
  if [ -n "$SESSION_ID" ]; then
    stop_recording_quietly
  fi
  "$AGENT_BROWSER_BIN" "$@"
  EXIT_CODE=$?
  if [ -n "$SESSION_ID" ]; then
    NOW=$(timestamp_ms)
    _close_sess() { meta close "$SESSIONS_DIR/$SESSION_ID" "$NOW" closed; printf '' > "$ACTIVE_FILE"; }
    with_lock _close_sess
  fi
  exit $EXIT_CODE
fi

# ── Main flow ─────────────────────────────────────────────────────────────

ALL_ARGS="$*"
SESSION_ID=""

# Acquire lock for session resolution + potential creation
_resolve_session() {
  local sid
  sid=$(get_active_session)
  if [ -n "$sid" ]; then
    local stale
    stale=$(is_stale "$sid")
    if [ "$stale" = "1" ]; then
      reconcile_stale "$sid"
      sid=""
    fi
  fi
  if [ -z "$sid" ]; then
    sid=$(create_session)
  fi
  printf '%s' "$sid" > "$SESSIONS_DIR/.resolved-session"
}
with_lock _resolve_session
SESSION_ID=$(cat "$SESSIONS_DIR/.resolved-session" 2>/dev/null || printf '')
rm -f "$SESSIONS_DIR/.resolved-session"

# Auto-inject persistent browser profile if it exists.
PROFILE_ARGS=""
PROFILE_DIR=".browser-profile"
if [ -d "$PROFILE_DIR" ] && ! printf '%s' "$ALL_ARGS" | grep -q -- "--profile"; then
  PROFILE_ARGS="--profile $PROFILE_DIR"

  # A running daemon ignores --profile on subsequent commands, so kill it on
  # navigation. This wipes any in-flight recording — we restart below.
  if [ "$FIRST_ARG" = "go" ] || [ "$FIRST_ARG" = "open" ]; then
    stop_recording_quietly
    "$AGENT_BROWSER_BIN" close >/dev/null 2>&1 || true
    # Clear the recording marker so start_recording_if_needed kicks in again
    _clear_vid() { meta set-video "$SESSIONS_DIR/$SESSION_ID" ""; }
    with_lock _clear_vid
  fi
fi

# Start recording on the first command (after any daemon kill). Done before
# running the command so navigation is captured in the video.
_start_rec() { start_recording_if_needed "$SESSION_ID"; }
with_lock _start_rec

# ── Run the actual command ────────────────────────────────────────────────
set +e
if [ -n "$PROFILE_ARGS" ]; then
  "$AGENT_BROWSER_BIN" $PROFILE_ARGS "$@"
else
  "$AGENT_BROWSER_BIN" "$@"
fi
EXIT_CODE=$?
set -e

# Record the command in meta.json (atomic, concurrency-safe)
NOW=$(timestamp_ms)
_append() { meta append-command "$SESSIONS_DIR/$SESSION_ID" "$ALL_ARGS" "$NOW"; }
with_lock _append

exit $EXIT_CODE
