#!/usr/bin/env node
/* eslint-disable no-console */

/**
 * Build the published granclaw package.
 *
 * Steps:
 *   1. Clean packages/cli/dist/
 *   2. Build @agent-brother/backend (tsc)
 *   3. Build @agent-brother/frontend (vite build)
 *   4. Compile packages/cli/src → packages/cli/dist/
 *   5. Copy backend dist → packages/cli/dist/backend/
 *   6. Copy frontend dist → packages/cli/dist/frontend/
 *
 * Resulting layout:
 *   packages/cli/dist/
 *     index.js          (the CLI entrypoint compiled from src/index.ts)
 *     home.js
 *     backend/          (compiled @agent-brother/backend)
 *     frontend/         (built @agent-brother/frontend static assets)
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const CLI_ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(CLI_ROOT, '..', '..');
const DIST = path.join(CLI_ROOT, 'dist');

function run(cmd, cwd) {
  console.log(`[build] $ ${cmd}`);
  execSync(cmd, { cwd: cwd ?? REPO_ROOT, stdio: 'inherit' });
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function main() {
  console.log('[build] clean dist/');
  fs.rmSync(DIST, { recursive: true, force: true });
  fs.mkdirSync(DIST, { recursive: true });

  console.log('[build] building @agent-brother/backend');
  run('npm run build -w @agent-brother/backend');

  console.log('[build] building @agent-brother/frontend');
  run('npm run build -w @agent-brother/frontend');

  console.log('[build] compiling packages/cli/src');
  run('npx tsc -p packages/cli/tsconfig.json');

  console.log('[build] copying backend dist');
  const backendDist = path.join(REPO_ROOT, 'packages', 'backend', 'dist');
  if (!fs.existsSync(backendDist)) {
    throw new Error(`backend dist not found at ${backendDist}`);
  }
  copyDir(backendDist, path.join(DIST, 'backend'));

  console.log('[build] copying frontend dist');
  const frontendDist = path.join(REPO_ROOT, 'packages', 'frontend', 'dist');
  if (!fs.existsSync(frontendDist)) {
    throw new Error(`frontend dist not found at ${frontendDist}`);
  }
  copyDir(frontendDist, path.join(DIST, 'frontend'));

  console.log('[build] ✓ done');
}

main();
