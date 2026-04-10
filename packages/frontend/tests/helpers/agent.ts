/**
 * Test agent lifecycle helpers.
 *
 * createSeededAgent: copies a seed workspace, then registers the agent via
 *   POST /agents with a custom workspaceDir pointing at .test/workspaces/{id}.
 *   bootstrapWorkspace on the server skips files that already exist, so the
 *   pre-onboarded state (AGENT.md, SOUL.md, vault/) is preserved.
 *
 * teardownAgent: calls DELETE /agents/{id}, which stops the process and
 *   deletes the workspace directory.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// helpers/ → tests/ → frontend/ → packages/ → repo root
const REPO_ROOT = path.resolve(__dirname, '../../../../');

const API = 'http://localhost:3001';

export interface TestAgentInfo {
  id: string;
  wsPort: number;
}

/**
 * Creates a test agent pre-seeded from a workspace template directory.
 *
 * @param id       Agent ID (e.g. 'test-websearch-e2e')
 * @param seedDir  Absolute path to a workspace seed directory
 */
export async function createSeededAgent(id: string, seedDir: string): Promise<TestAgentInfo> {
  const workspaceDir = path.resolve(REPO_ROOT, '.test', 'workspaces', id);

  // Remove any leftover workspace from a previous run
  if (fs.existsSync(workspaceDir)) {
    fs.rmSync(workspaceDir, { recursive: true, force: true });
  }

  // Copy seed into the fresh workspace directory
  fs.mkdirSync(workspaceDir, { recursive: true });
  copyDirRecursive(seedDir, workspaceDir);

  // Delete any leftover agent registration
  await fetch(`${API}/agents/${id}`, { method: 'DELETE' }).catch(() => {});

  // Register agent with the pre-seeded workspaceDir
  // .test/workspaceDir is relative to REPO_ROOT — the server resolves it via path.resolve(REPO_ROOT, ...)
  const res = await fetch(`${API}/agents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id,
      name: id,
      workspaceDir: `.test/workspaces/${id}`,
    }),
  });

  if (!res.ok) {
    throw new Error(`Failed to create agent "${id}": HTTP ${res.status} — ${await res.text()}`);
  }

  return res.json() as Promise<TestAgentInfo>;
}

/**
 * Deletes the agent registration and its workspace directory.
 * DELETE /agents/:id on the server calls rmSync on the workspaceDir.
 */
export async function teardownAgent(id: string): Promise<void> {
  await fetch(`${API}/agents/${id}`, { method: 'DELETE' }).catch(() => {});
}

function copyDirRecursive(src: string, dest: string): void {
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(destPath, { recursive: true });
      copyDirRecursive(srcPath, destPath);
    } else if (entry.name !== '.gitkeep') {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}
