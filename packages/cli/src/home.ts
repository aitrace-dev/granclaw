import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * Resolve the GranClaw home directory.
 *
 * Priority (highest first):
 *   1. --home CLI flag (passed in as `cliFlag`)
 *   2. GRANCLAW_HOME env var
 *   3. ~/.granclaw
 *
 * Whitespace-only values are treated as unset so callers do not land
 * on paths like "<cwd> " when a shell accidentally exports a padded value.
 */
export function resolveHome(cliFlag?: string): string {
  const flag = cliFlag?.trim();
  if (flag) return path.resolve(flag);

  const envHome = process.env.GRANCLAW_HOME?.trim();
  if (envHome) return path.resolve(envHome);

  return path.join(os.homedir(), '.granclaw');
}

/**
 * Create the home directory and seed it from bundled templates if it does
 * not already exist. Idempotent: existing files are never overwritten.
 *
 * After this runs, homeDir contains:
 *   agents.config.json  (copied from <templatesDir>/agents.config.json)
 *   data/               (empty, for SQLite DBs)
 *   workspaces/         (empty, for per-agent workspace dirs)
 *   logs/               (empty, for CLI stdout/stderr tee)
 */
export function seedHomeIfNeeded(homeDir: string, templatesDir: string): void {
  fs.mkdirSync(homeDir, { recursive: true });
  fs.mkdirSync(path.join(homeDir, 'data'), { recursive: true });
  fs.mkdirSync(path.join(homeDir, 'workspaces'), { recursive: true });
  fs.mkdirSync(path.join(homeDir, 'logs'), { recursive: true });

  const targetConfig = path.join(homeDir, 'agents.config.json');
  if (!fs.existsSync(targetConfig)) {
    const sourceConfig = path.join(templatesDir, 'agents.config.json');
    fs.copyFileSync(sourceConfig, targetConfig);
  }
}
