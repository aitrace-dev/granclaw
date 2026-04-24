/**
 * scheduler.ts
 *
 * Runs inside the orchestrator process. Every 60 seconds, checks all
 * active schedules across all agents. When a schedule is due, enqueues
 * the message into the agent's job queue.
 */

import { parseExpression } from 'cron-parser';
import path from 'path';
import { getManagedAgents } from './orchestrator/agent-manager.js';
import { getDueSchedules, updateSchedule } from './schedules-db.js';
import { enqueue } from './agent-db.js';
import { REPO_ROOT } from './config.js';
import { executeGraphWorkflow } from './workflows/runner-graph.js';

const POLL_INTERVAL_MS = 60_000;

function getNextRun(cronExpr: string, timezone: string): number {
  const interval = parseExpression(cronExpr, { tz: timezone });
  return interval.next().getTime();
}

function tick(): void {
  const agents = getManagedAgents();

  for (const managed of agents) {
    const agentId = managed.config.id;
    let due;
    try {
      due = getDueSchedules(agentId);
    } catch {
      continue; // DB not yet created for this agent
    }

    for (const schedule of due) {
      if (schedule.workflowId) {
        console.log(`[scheduler] triggering workflow "${schedule.workflowId}" for schedule "${schedule.name}" (agent "${agentId}")`);
        executeGraphWorkflow(agentId, schedule.workflowId, 'schedule').catch((err) => {
          console.error(`[scheduler] workflow "${schedule.workflowId}" failed:`, err);
        });
      } else {
        const workspaceDir = path.resolve(REPO_ROOT, managed.config.workspaceDir);
        enqueue(workspaceDir, agentId, schedule.message, 'schedule');
        console.log(`[scheduler] triggered "${schedule.name}" for agent "${agentId}"`);
      }

      let nextRun: number;
      try {
        nextRun = getNextRun(schedule.cron, schedule.timezone);
      } catch {
        console.error(`[scheduler] invalid cron "${schedule.cron}" for schedule ${schedule.id}, pausing`);
        updateSchedule(agentId, schedule.id, { status: 'paused' });
        continue;
      }

      updateSchedule(agentId, schedule.id, { lastRun: Date.now(), nextRun });
    }
  }
}

let intervalHandle: ReturnType<typeof setInterval> | null = null;

export function startScheduler(): void {
  if (intervalHandle) return;
  console.log(`[scheduler] started (polling every ${POLL_INTERVAL_MS / 1000}s)`);
  intervalHandle = setInterval(tick, POLL_INTERVAL_MS);
}

export function stopScheduler(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}
