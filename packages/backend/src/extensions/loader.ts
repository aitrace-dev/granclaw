/**
 * extensions/loader.ts
 *
 * Backend extension loader. On boot, scans GRANCLAW_EXTENSIONS_DIR (if set)
 * for subdirectories and requires each subdirectory's compiled entrypoint.
 *
 * Layout:
 *   <GRANCLAW_EXTENSIONS_DIR>/
 *     my-extension/
 *       package.json   — "main": "dist/index.js"
 *       dist/index.js  — default export: ExtensionFactory
 *     another/
 *       package.json
 *       dist/index.js
 *
 * The loader:
 *   1. Reads the dir synchronously at boot.
 *   2. For each subdir, requires <subdir>/package.json's "main" entry.
 *   3. Invokes the module's default export with the ExtensionContext.
 *
 * All failures are logged but never crash the orchestrator — a broken
 * enterprise extension should not take down the whole tenant.
 */

import fs from 'fs';
import path from 'path';
import type { ExtensionContext, ExtensionFactory } from './types.js';

export async function loadExtensions(ctx: ExtensionContext): Promise<void> {
  const dir = process.env.GRANCLAW_EXTENSIONS_DIR?.trim();
  if (!dir) return;

  const resolved = path.resolve(dir);
  if (!fs.existsSync(resolved)) {
    console.warn(`[extensions] GRANCLAW_EXTENSIONS_DIR=${resolved} does not exist — skipping`);
    return;
  }

  const entries = fs.readdirSync(resolved, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const subdir = path.join(resolved, entry.name);
    const pkgPath = path.join(subdir, 'package.json');
    if (!fs.existsSync(pkgPath)) {
      console.warn(`[extensions] ${entry.name}: no package.json — skipping`);
      continue;
    }

    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { main?: string; name?: string };
      const mainRel = pkg.main ?? 'index.js';
      const mainPath = path.resolve(subdir, mainRel);
      if (!fs.existsSync(mainPath)) {
        console.warn(`[extensions] ${entry.name}: main entry ${mainPath} missing — skipping`);
        continue;
      }

      // require() works here because all GranClaw backend code compiles to CJS.
      // Extensions built with tsc (module: CommonJS) are fully compatible.
      // For ESM-only extensions, the author should provide a CJS interop shim.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require(mainPath) as { default?: ExtensionFactory };
      const factory = mod.default ?? (mod as unknown as ExtensionFactory);
      if (typeof factory !== 'function') {
        console.warn(`[extensions] ${entry.name}: default export is not a function — skipping`);
        continue;
      }

      await factory(ctx);
      console.log(`[extensions] loaded ${pkg.name ?? entry.name}`);
    } catch (err) {
      console.error(`[extensions] failed to load ${entry.name}:`, err);
    }
  }
}
