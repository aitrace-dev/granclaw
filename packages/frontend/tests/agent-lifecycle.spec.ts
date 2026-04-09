import { test, expect } from '@playwright/test';

/**
 * Agent lifecycle regression tests.
 *
 * Verifies that creating, deleting, and recreating an agent with the same id
 * does NOT leak data across instances (tasks, messages, secrets).
 *
 * Root cause this test guards against:
 *   The orchestrator caches SQLite handles in a pool keyed by agent id.
 *   If DELETE /agents/:id rm -rf's the workspace WITHOUT closing those
 *   handles first, the cached handle keeps pointing at the now-unlinked
 *   inode on POSIX. A recreated agent with the same id then reads/writes
 *   the ghost file — new workspace stays empty, old data bleeds through.
 *
 * CRITICAL: This test NEVER touches main-agent. It uses a disposable
 * `test-lifecycle-e2e` agent and always cleans up at the end.
 */

const TEST_AGENT = 'test-lifecycle-e2e';
const API = 'http://localhost:3001';

async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, init);
  if (!res.ok) throw new Error(`${init?.method ?? 'GET'} ${path}: ${res.status}`);
  return res.json() as Promise<T>;
}

async function deleteIfExists(id: string): Promise<void> {
  // Best-effort delete, ignore 404
  await fetch(`${API}/agents/${id}`, { method: 'DELETE' }).catch(() => {});
}

async function createAgent(id: string, name: string): Promise<void> {
  const res = await fetch(`${API}/agents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, name }),
  });
  if (!res.ok) throw new Error(`create agent: ${res.status}`);
}

async function createTask(id: string, title: string): Promise<void> {
  const res = await fetch(`${API}/agents/${id}/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, description: '', status: 'backlog' }),
  });
  if (!res.ok) throw new Error(`create task: ${res.status}`);
}

async function listTasks(id: string): Promise<Array<{ id: string; title: string }>> {
  return apiJson<Array<{ id: string; title: string }>>(`/agents/${id}/tasks`);
}

test.describe('Agent lifecycle', () => {
  test.beforeEach(async () => {
    // Ensure a clean slate — the test agent should not exist
    await deleteIfExists(TEST_AGENT);
  });

  test.afterAll(async () => {
    // Always clean up the disposable agent
    await deleteIfExists(TEST_AGENT);
  });

  test('recreating a deleted agent with the same id does not leak tasks', async () => {
    // 1. Create the agent
    await createAgent(TEST_AGENT, 'Test Lifecycle');

    // 2. Create 3 tasks
    await createTask(TEST_AGENT, 'Task A');
    await createTask(TEST_AGENT, 'Task B');
    await createTask(TEST_AGENT, 'Task C');

    // 3. Verify tasks exist
    const before = await listTasks(TEST_AGENT);
    expect(before).toHaveLength(3);

    // 4. Delete the agent (rm -rf workspace, close SQLite handles)
    const deleteRes = await fetch(`${API}/agents/${TEST_AGENT}`, { method: 'DELETE' });
    expect(deleteRes.ok).toBe(true);

    // 5. Recreate with the SAME id
    await createAgent(TEST_AGENT, 'Test Lifecycle');

    // 6. Tasks must be empty — if the SQLite handle pool wasn't flushed,
    //    the cached handle would return the 3 tasks from step 2 via the
    //    unlinked inode (the bug this test guards against).
    const after = await listTasks(TEST_AGENT);
    expect(after).toHaveLength(0);
  });

  test('recreating a deleted agent produces fresh task ids starting from 001', async () => {
    // Regression: even if the leak is fixed, a cached auto-increment sequence
    // could produce unexpected ids. Tasks should always number from TSK-001.

    // First lifecycle
    await createAgent(TEST_AGENT, 'Test Lifecycle');
    await createTask(TEST_AGENT, 'First run task');
    const firstRun = await listTasks(TEST_AGENT);
    expect(firstRun[0].id).toBe('TSK-001');

    // Delete + recreate
    await fetch(`${API}/agents/${TEST_AGENT}`, { method: 'DELETE' });
    await createAgent(TEST_AGENT, 'Test Lifecycle');

    // Second lifecycle — ids should restart, not continue from where they left off
    await createTask(TEST_AGENT, 'Second run task');
    const secondRun = await listTasks(TEST_AGENT);
    expect(secondRun).toHaveLength(1);
    expect(secondRun[0].id).toBe('TSK-001');
    expect(secondRun[0].title).toBe('Second run task');
  });
});
