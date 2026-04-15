#!/bin/bash
# Per-agent WhatsApp CLI wrapper.
#
# Wraps vicentereig/whatsapp-cli so each agent gets its own isolated
# whatsmeow session under its workspace volume. whatsapp-cli stores its
# SQLite session DB and message history under the directory passed via
# the global --store flag; by default that is ./store relative to cwd,
# which would leak across agents inside the same container. We pin it
# to $GRANCLAW_WORKSPACE_DIR/.whatsapp.
#
# The session DB contains WhatsApp device keys and should be treated as
# sensitive (SSH-private-key-equivalent). It lives on the agent's
# persistent docker volume and never touches the vault.
set -eu

WORKSPACE="${GRANCLAW_WORKSPACE_DIR:-$PWD}"
STORE_DIR="$WORKSPACE/.whatsapp"
mkdir -p "$STORE_DIR"

exec whatsapp-cli --store "$STORE_DIR" "$@"
