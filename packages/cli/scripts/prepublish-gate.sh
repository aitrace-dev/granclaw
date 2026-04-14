#!/usr/bin/env bash
set -euo pipefail

# Prepublish quality gate for granclaw.
# Runs from the repo root (invoked via `npm run prepublishOnly -w granclaw` or
# the GH Actions publish workflow). Each step fails fast; all log lines carry a
# [gate:N] prefix so you can grep the logs.
#
# Beta escape hatches (REMOVE BEFORE STABLE):
#   GRANCLAW_GATE_SKIP_AUDIT=1    bypass Step 2 (npm audit)
#   GRANCLAW_GATE_SKIP_GITLEAKS=1 bypass Step 3 (gitleaks)
#   GRANCLAW_GATE_SKIP_MANIFEST=1 bypass Step 4 (manifest diff)
#   GRANCLAW_GATE_SKIP_INSTALL=1  bypass Step 5 (tarball install)
#   GRANCLAW_GATE_SKIP_E2E=1      bypass Step 6 (Playwright smoke)
# These are intended for local iteration during the beta period ONLY. The
# GH Actions publish workflow MUST NOT set them. A later task will add a
# check that aborts if any SKIP var is set while CI=true.

CLI_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPO_ROOT="$(cd "$CLI_ROOT/../.." && pwd)"
cd "$REPO_ROOT"

log() { echo "[gate:$1] $2"; }
fail() { echo "[gate:$1] FAIL: $2" >&2; exit 1; }

# CI sanity: escape hatches must not be set under CI
if [ "${CI:-}" = "true" ]; then
  for var in GRANCLAW_GATE_SKIP_AUDIT GRANCLAW_GATE_SKIP_GITLEAKS GRANCLAW_GATE_SKIP_MANIFEST GRANCLAW_GATE_SKIP_INSTALL GRANCLAW_GATE_SKIP_E2E; do
    if [ -n "${!var:-}" ]; then
      fail "ci" "escape hatch $var=$(eval echo \$$var) is set under CI — refusing to run"
    fi
  done
fi

# ── Step 1: Clean build ──────────────────────────────────────────────────────
log 1 "clean build"
rm -rf "$CLI_ROOT/dist"
npm run build -w granclaw > /tmp/gate-build.log 2>&1 || {
  tail -40 /tmp/gate-build.log >&2
  fail 1 "build failed (see /tmp/gate-build.log)"
}
log 1 "✓ built"

# ── Step 2: Dependency vulnerability scan ────────────────────────────────────
if [ "${GRANCLAW_GATE_SKIP_AUDIT:-}" = "1" ]; then
  log 2 "⚠ SKIPPED via GRANCLAW_GATE_SKIP_AUDIT (beta escape hatch)"
else
  log 2 "npm audit (production deps, level=high)"
  if ! npm audit --omit=dev --audit-level=high -w granclaw; then
    fail 2 "audit found high/critical vulnerabilities"
  fi
  log 2 "✓ no high/critical vulns"
fi

# ── Step 3: Secret scan (gitleaks) ───────────────────────────────────────────
if [ "${GRANCLAW_GATE_SKIP_GITLEAKS:-}" = "1" ]; then
  log 3 "⚠ SKIPPED via GRANCLAW_GATE_SKIP_GITLEAKS (beta escape hatch)"
else
  log 3 "gitleaks working tree"
  if ! command -v gitleaks >/dev/null 2>&1; then
    log 3 "gitleaks not on PATH — downloading pinned binary"
    GITLEAKS_VERSION="8.18.4"
    OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
    ARCH_RAW="$(uname -m)"
    case "$ARCH_RAW" in
      x86_64|amd64) ARCH=x64 ;;
      arm64|aarch64) ARCH=arm64 ;;
      *) fail 3 "unsupported arch: $ARCH_RAW" ;;
    esac
    CACHE_DIR="$HOME/.cache/granclaw-gate"
    mkdir -p "$CACHE_DIR"
    GITLEAKS_BIN="$CACHE_DIR/gitleaks"
    if [ ! -x "$GITLEAKS_BIN" ]; then
      URL="https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/gitleaks_${GITLEAKS_VERSION}_${OS}_${ARCH}.tar.gz"
      log 3 "downloading $URL"
      curl -sSL "$URL" | tar xz -C "$CACHE_DIR" gitleaks || fail 3 "gitleaks download failed"
      chmod +x "$GITLEAKS_BIN"
    fi
  else
    GITLEAKS_BIN="$(command -v gitleaks)"
  fi

  # .gitleaks.toml at repo root tunes path allowlists
  GITLEAKS_ARGS=(--source . --no-git --redact --exit-code 1)
  if [ -f "$REPO_ROOT/.gitleaks.toml" ]; then
    GITLEAKS_ARGS+=(--config "$REPO_ROOT/.gitleaks.toml")
  fi
  "$GITLEAKS_BIN" detect "${GITLEAKS_ARGS[@]}" || fail 3 "secrets found in working tree"
  log 3 "✓ working tree clean"

  log 3 "gitleaks dist/"
  DIST_GITLEAKS_ARGS=(--source "$CLI_ROOT/dist" --no-git --redact --exit-code 1)
  if [ -f "$REPO_ROOT/.gitleaks.toml" ]; then
    DIST_GITLEAKS_ARGS+=(--config "$REPO_ROOT/.gitleaks.toml")
  fi
  "$GITLEAKS_BIN" detect "${DIST_GITLEAKS_ARGS[@]}" || fail 3 "secrets found in dist/"
  log 3 "✓ dist/ clean"
fi

# ── Step 4: File allowlist + manifest diff + size delta ──────────────────────
if [ "${GRANCLAW_GATE_SKIP_MANIFEST:-}" = "1" ]; then
  log 4 "⚠ SKIPPED via GRANCLAW_GATE_SKIP_MANIFEST (beta escape hatch)"
else
  log 4 "npm pack --dry-run → manifest"
  ACTUAL="$(mktemp)"
  npm pack --dry-run -w granclaw --json 2>/dev/null | node -e '
    const data = JSON.parse(require("fs").readFileSync(0, "utf-8"));
    console.log(data[0].files.map(f => f.path).sort().join("\n"));
  ' > "$ACTUAL"

  EXPECTED="$CLI_ROOT/packaging/expected-files.txt"
  MANIFEST_CHECKER="$(mktemp --suffix=.js)"
  cat > "$MANIFEST_CHECKER" <<'JSEOF'
const fs = require('fs');
const expected = fs.readFileSync(process.env.EXPECTED, 'utf-8').trim().split('\n').filter(Boolean);
const actual   = fs.readFileSync(process.env.ACTUAL,   'utf-8').trim().split('\n').filter(Boolean);
const toRe = p => new RegExp('^' + p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*') + '$');
let ok = true;
for (const pat of expected) {
  const re = toRe(pat);
  if (!actual.some(f => re.test(f))) {
    console.error('Missing: ' + pat); ok = false;
  }
}
for (const file of actual) {
  if (!expected.some(pat => toRe(pat).test(file))) {
    console.error('Unexpected: ' + file); ok = false;
  }
}
process.exit(ok ? 0 : 1);
JSEOF
  if ! EXPECTED="$EXPECTED" ACTUAL="$ACTUAL" node "$MANIFEST_CHECKER"; then
    log 4 "manifest differs from $EXPECTED"
    log 4 "if the diff is intentional, update expected-files.txt and commit"
    rm -f "$ACTUAL" "$MANIFEST_CHECKER"
    fail 4 "manifest mismatch"
  fi
  rm -f "$ACTUAL" "$MANIFEST_CHECKER"
  log 4 "✓ manifest matches allowlist"

  log 4 "tarball size delta"
  # npm pack -w <ws> runs from CWD (repo root) and writes the tarball there,
  # not inside the workspace dir. We chdir to CLI_ROOT to force a predictable
  # output location and clean up any stray tarball first.
  rm -f "$REPO_ROOT"/granclaw-*.tgz "$CLI_ROOT"/granclaw-*.tgz
  TARBALL_NAME=$(cd "$CLI_ROOT" && npm pack 2>/dev/null | tail -n1 | tr -d '\r')
  TARBALL_PATH="$CLI_ROOT/$TARBALL_NAME"
  [ -f "$TARBALL_PATH" ] || fail 4 "cannot locate packed tarball at $TARBALL_PATH"

  # Cross-platform stat (BSD on macOS uses -f%z, GNU uses -c%s)
  ACTUAL_SIZE=$(stat -f%z "$TARBALL_PATH" 2>/dev/null || stat -c%s "$TARBALL_PATH")
  log 4 "packed size: $ACTUAL_SIZE bytes"

  PREV_SIZE=$(npm view granclaw dist.unpackedSize 2>/dev/null || true)
  if [ -n "$PREV_SIZE" ] && [ "$PREV_SIZE" -gt 0 ]; then
    MAX_SIZE=$((PREV_SIZE * 120 / 100))
    if [ "$ACTUAL_SIZE" -gt "$MAX_SIZE" ]; then
      fail 4 "tarball grew by >20%: prev=$PREV_SIZE new=$ACTUAL_SIZE"
    fi
    log 4 "✓ size within 20% of prev ($PREV_SIZE)"
  else
    log 4 "no previous published version — skipping size delta"
  fi

  # Stash the tarball path for Step 5
  echo "$TARBALL_PATH" > "$CLI_ROOT/.last-tarball"
fi

# ── Step 5: Tarball install verification ─────────────────────────────────────
if [ "${GRANCLAW_GATE_SKIP_INSTALL:-}" = "1" ]; then
  log 5 "⚠ SKIPPED via GRANCLAW_GATE_SKIP_INSTALL (beta escape hatch)"
else
  log 5 "ephemeral install of packed tarball"

  if [ ! -f "$CLI_ROOT/.last-tarball" ]; then
    fail 5 ".last-tarball marker missing — Step 4 did not complete"
  fi
  TARBALL_PATH=$(cat "$CLI_ROOT/.last-tarball")
  [ -f "$TARBALL_PATH" ] || fail 5 "tarball not found at $TARBALL_PATH"

  VERIFY_HOME=$(mktemp -d)
  VERIFY_GLOBAL=$(mktemp -d)

  cleanup_step5() {
    if [ -n "${SERVER_PID:-}" ]; then
      kill "$SERVER_PID" 2>/dev/null || true
      wait "$SERVER_PID" 2>/dev/null || true
    fi
    rm -rf "$VERIFY_HOME" "$VERIFY_GLOBAL"
  }
  trap cleanup_step5 EXIT

  log 5 "installing to ephemeral prefix $VERIFY_GLOBAL"
  npm install --prefix "$VERIFY_GLOBAL" --global "$TARBALL_PATH" > /tmp/gate-install.log 2>&1 || {
    tail -20 /tmp/gate-install.log >&2
    fail 5 "global install failed (see /tmp/gate-install.log)"
  }

  GRANCLAW_BIN="$VERIFY_GLOBAL/bin/granclaw"
  [ -x "$GRANCLAW_BIN" ] || fail 5 "binary not executable at $GRANCLAW_BIN"

  log 5 "$($GRANCLAW_BIN --version)"

  # Server startup requires the claude CLI. Skip the health-check in CI when
  # claude is unavailable — same policy as Step 6. The binary + version check
  # above is still a meaningful packaging regression guard.
  if ! command -v claude >/dev/null 2>&1 && [ "${CI:-}" = "true" ]; then
    log 5 "⚠ skipping server health-check: claude CLI unavailable in CI runner"
    echo "::warning::Step 5 server check skipped: claude CLI unavailable in CI runner"
    log 5 "✓ tarball install verified (binary only)"
  else
    log 5 "starting server on port 18787 with temp home"
    GRANCLAW_HOME="$VERIFY_HOME" "$GRANCLAW_BIN" start --port 18787 > /tmp/gate-server.log 2>&1 &
    SERVER_PID=$!

    # Poll /health for up to 12 seconds to allow cold-start + claude-cli check
    HEALTH_OK=0
    for i in 1 2 3 4 5 6 7 8 9 10 11 12; do
      sleep 1
      if curl -sf http://localhost:18787/health >/dev/null 2>&1; then
        HEALTH_OK=1
        break
      fi
    done

    if [ "$HEALTH_OK" -ne 1 ]; then
      tail -30 /tmp/gate-server.log >&2
      fail 5 "health endpoint unreachable after 12s"
    fi
    log 5 "✓ health OK"

    log 5 "verifying home was seeded"
    for sub in agents.config.json data workspaces logs; do
      [ -e "$VERIFY_HOME/$sub" ] || fail 5 "home missing $sub"
    done
    log 5 "✓ home seeded"

    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
    SERVER_PID=""

    log 5 "✓ tarball install verified"
  fi
fi

# ── Step 6: E2E smoke test ───────────────────────────────────────────────────
if [ "${GRANCLAW_GATE_SKIP_E2E:-}" = "1" ]; then
  log 6 "⚠ SKIPPED via GRANCLAW_GATE_SKIP_E2E (beta escape hatch)"
else
  log 6 "Playwright e2e smoke"

  if ! command -v claude >/dev/null 2>&1; then
    if [ "${CI:-}" = "true" ]; then
      log 6 "⚠ skipped: claude CLI unavailable in CI runner"
      echo "::warning::Step 6 skipped: claude CLI unavailable in CI runner"
      log "final" "✓ gates 1-5 passed, step 6 skipped"
      exit 0
    else
      fail 6 "claude CLI missing — install from https://claude.ai/download"
    fi
  fi

  # The tarball we installed in Step 5 is still on disk. Reboot a fresh server
  # with a new temp home so the e2e starts from a clean slate.
  E2E_HOME=$(mktemp -d)
  cleanup_step6() {
    if [ -n "${E2E_PID:-}" ]; then
      kill "$E2E_PID" 2>/dev/null || true
      wait "$E2E_PID" 2>/dev/null || true
    fi
    rm -rf "$E2E_HOME"
    cleanup_step5
  }
  trap cleanup_step6 EXIT

  GRANCLAW_HOME="$E2E_HOME" "$GRANCLAW_BIN" start --port 18787 > /tmp/gate-e2e-server.log 2>&1 &
  E2E_PID=$!

  # Poll /health for up to 12 seconds
  E2E_HEALTH=0
  for i in 1 2 3 4 5 6 7 8 9 10 11 12; do
    sleep 1
    if curl -sf http://localhost:18787/health >/dev/null 2>&1; then
      E2E_HEALTH=1
      break
    fi
  done
  if [ "$E2E_HEALTH" -ne 1 ]; then
    tail -30 /tmp/gate-e2e-server.log >&2
    fail 6 "server failed to restart for e2e"
  fi

  log 6 "running Playwright spec"
  (cd "$CLI_ROOT" && npx playwright test --config playwright.config.ts) || fail 6 "Playwright spec failed"

  kill "$E2E_PID" 2>/dev/null || true
  wait "$E2E_PID" 2>/dev/null || true
  E2E_PID=""

  log 6 "✓ e2e smoke passed"
fi

log "final" "✓ all gates passed"
