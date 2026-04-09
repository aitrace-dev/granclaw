#!/usr/bin/env bash
# docker-extract-credentials.sh
#
# On macOS the `claude` CLI stores its subscription OAuth tokens in the
# system keychain, not on disk. To let the Linux claude CLI inside a
# Docker container reuse them, we extract the keychain entry into
# ./.docker-claude/.credentials.json, which docker-compose.yml bind-mounts
# to /root/.claude/.credentials.json.
#
# On Linux, claude already writes credentials to ~/.claude/.credentials.json;
# this script just copies that file.
#
# Run once per machine, then `docker compose up --build`.

set -euo pipefail

cd "$(dirname "$0")/.."

TARGET_DIR=".docker-claude"
TARGET_FILE="$TARGET_DIR/.credentials.json"

mkdir -p "$TARGET_DIR"
chmod 700 "$TARGET_DIR"

OS="$(uname -s)"
case "$OS" in
  Darwin)
    echo "[docker-setup] extracting Claude Code credentials from macOS keychain…"
    if ! security find-generic-password -s "Claude Code-credentials" -w > "$TARGET_FILE" 2>/dev/null; then
      echo "ERROR: no keychain entry 'Claude Code-credentials'. Run 'claude login' on the host first." >&2
      rm -f "$TARGET_FILE"
      exit 1
    fi
    ;;
  Linux)
    SRC="$HOME/.claude/.credentials.json"
    if [ ! -f "$SRC" ]; then
      echo "ERROR: $SRC not found. Run 'claude login' first." >&2
      exit 1
    fi
    cp "$SRC" "$TARGET_FILE"
    ;;
  *)
    echo "ERROR: unsupported OS: $OS" >&2
    exit 1
    ;;
esac

chmod 600 "$TARGET_FILE"

# Sanity-check: must be JSON containing claudeAiOauth.accessToken
if ! grep -q '"accessToken"' "$TARGET_FILE"; then
  echo "ERROR: extracted credentials do not look valid. Re-run 'claude login'." >&2
  exit 1
fi

echo "[docker-setup] wrote $TARGET_FILE"
echo "[docker-setup] next: docker compose up --build"
