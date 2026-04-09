/* eslint-disable no-console */
import { execSync, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { resolveHome, seedHomeIfNeeded } from './home.js';

// package.json is resolved at runtime; require() avoids rootDir complaints
// from tsc when the JSON sits outside the TypeScript rootDir.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pkg = require('../package.json') as { name: string; version: string };

const DEFAULT_PORT = 8787;

export interface ParsedArgs {
  command: 'start' | 'version' | 'help';
  port?: number;
  home?: string;
}

/**
 * Parse the CLI argv slice (sans `node` and the script path).
 *
 * Supported forms:
 *   granclaw                  → start with defaults
 *   granclaw start            → same as above (explicit subcommand)
 *   granclaw --port 9000
 *   granclaw --home /tmp/gc
 *   granclaw start --port 9000 --home /tmp/gc
 *   granclaw --version / -v
 *   granclaw --help / -h
 */
export function parseArgs(argv: string[]): ParsedArgs {
  if (argv.includes('--version') || argv.includes('-v')) return { command: 'version' };
  if (argv.includes('--help') || argv.includes('-h')) return { command: 'help' };

  // Skip the optional `start` subcommand if present
  const args = argv[0] === 'start' ? argv.slice(1) : argv;

  let port: number | undefined;
  let home: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--port') {
      const next = args[++i];
      const parsed = Number(next);
      if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 65535) {
        throw new Error(`invalid port: ${next}`);
      }
      port = parsed;
    } else if (arg === '--home') {
      const next = args[++i];
      if (!next) {
        throw new Error('--home requires a path');
      }
      home = next;
    } else if (arg !== undefined && arg.startsWith('--')) {
      throw new Error(`unknown option: ${arg}`);
    }
  }

  return { command: 'start', port, home };
}

function printHelp(): void {
  console.log(`
${pkg.name} ${pkg.version}

Usage:
  granclaw [start] [options]
  granclaw --version
  granclaw --help

Options:
  --port <n>      Listen on port n (default: ${DEFAULT_PORT}; env: PORT)
  --home <path>   Use path as the GranClaw home (default: ~/.granclaw; env: GRANCLAW_HOME)

Home directory:
  Runtime state (agents.config.json, data/, workspaces/) lives in the home
  directory. GranClaw creates it on first run and seeds an empty config.

Prerequisites:
  The Claude Code CLI must be on PATH. Install from https://claude.ai/download.
`);
}

function requireClaudeCli(): void {
  try {
    execSync('claude --version', { stdio: 'ignore' });
  } catch {
    console.error(`
error: Claude Code CLI not found.

GranClaw requires the \`claude\` CLI.
Install from https://claude.ai/download, then rerun.
`);
    process.exit(1);
  }
}

function cliPackageDir(): string {
  // dist/index.js runs at <cli-pkg>/dist/, so the package root is one up.
  return path.resolve(__dirname, '..');
}

function startServer(parsed: ParsedArgs): void {
  const homeDir = resolveHome(parsed.home);
  const templatesDir = path.join(cliPackageDir(), 'templates');
  const staticDir = path.join(cliPackageDir(), 'dist', 'frontend');

  requireClaudeCli();
  seedHomeIfNeeded(homeDir, templatesDir);

  const port = parsed.port ?? (Number(process.env.PORT) || DEFAULT_PORT);

  const env = {
    ...process.env,
    GRANCLAW_HOME: homeDir,
    GRANCLAW_TEMPLATES_DIR: templatesDir,
    GRANCLAW_STATIC_DIR: staticDir,
    PORT: String(port),
  };

  console.log(`GranClaw ${pkg.version}`);
  console.log(`Data:  ${homeDir}`);
  console.log(`Port:  ${port}`);
  console.log(`Ready: http://localhost:${port}`);
  console.log('');

  // Spawn the compiled backend entrypoint. Bundled at dist/backend/index.js
  // by the CLI build script (see scripts/build.js).
  const backendEntry = path.join(cliPackageDir(), 'dist', 'backend', 'index.js');
  if (!fs.existsSync(backendEntry)) {
    console.error(`error: backend entrypoint missing at ${backendEntry}. Did the build run?`);
    process.exit(1);
  }

  const proc = spawn(process.execPath, [backendEntry], {
    env,
    stdio: 'inherit',
  });

  proc.on('exit', (code) => process.exit(code ?? 0));
  process.on('SIGINT', () => proc.kill('SIGINT'));
  process.on('SIGTERM', () => proc.kill('SIGTERM'));
}

export function main(argv: string[]): void {
  let parsed: ParsedArgs;
  try {
    parsed = parseArgs(argv);
  } catch (err) {
    console.error(`error: ${(err as Error).message}`);
    process.exit(2);
  }

  switch (parsed.command) {
    case 'version':
      console.log(pkg.version);
      return;
    case 'help':
      printHelp();
      return;
    case 'start':
      startServer(parsed);
      return;
  }
}

// When invoked as the CLI entrypoint (via bin/granclaw.js)
if (require.main === module) {
  main(process.argv.slice(2));
}
