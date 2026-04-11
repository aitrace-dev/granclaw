/**
 * usage-scanner.ts
 *
 * Reads token usage and cost data from the shared logs.db audit log.
 *
 * The pi runner logs one 'system' row per agent turn containing:
 *   { tokens: { input, output, total }, cost: <usd>, model: <model-id> }
 *
 * Tool usage counts come from 'tool_call' rows:
 *   input: { tool: <name>, input: <args> }
 *
 * This approach works for every provider/model — no Claude-specific JSONL parsing.
 */

import { queryActions } from './logs-db.js';

export interface DailyUsage {
  date: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreateTokens: number;
  sessions: number;
  estimatedCostUsd: number;
}

export interface UsageSummary {
  daily: DailyUsage[];
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheCreateTokens: number;
  totalSessions: number;
  totalEstimatedCostUsd: number;
  byModel: Record<string, { inputTokens: number; outputTokens: number; sessions: number; estimatedCostUsd: number }>;
  byTool: Record<string, number>;
}

export async function scanUsage(agentId: string, days = 30): Promise<UsageSummary> {
  const cutoffMs = Date.now() - days * 86_400_000;

  // Fetch all system rows (one per completed turn) and tool_call rows
  const { items: systemRows } = queryActions({ agentId, type: 'system', limit: 50_000 });
  const { items: toolRows } = queryActions({ agentId, type: 'tool_call', limit: 50_000 });

  const dailyMap = new Map<string, DailyUsage>();
  const modelMap = new Map<string, { inputTokens: number; outputTokens: number; sessions: number; estimatedCostUsd: number }>();
  const toolMap = new Map<string, number>();

  let totalInput = 0, totalOutput = 0, totalCacheRead = 0, totalCacheWrite = 0, totalCost = 0, totalSessions = 0;

  for (const row of systemRows) {
    if (row.created_at < cutoffMs) continue;
    if (!row.output) continue;

    // The pi runner logs tokens as { input, output, cacheRead, cacheWrite, total }.
    // `total` is already input+output+cacheRead; we aggregate the components
    // separately so the UI can break them out (Cache Read / Cache Write bars).
    let tokens:
      | { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; total?: number }
      | undefined;
    let cost = 0;
    let model = 'unknown';

    try {
      const parsed = JSON.parse(row.output) as {
        tokens?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; total?: number };
        cost?: number;
        model?: string;
      };
      tokens = parsed.tokens;
      cost = parsed.cost ?? 0;
      model = parsed.model ?? 'unknown';
    } catch { continue; }

    const inputTokens = tokens?.input ?? 0;
    const outputTokens = tokens?.output ?? 0;
    const cacheReadTokens = tokens?.cacheRead ?? 0;
    const cacheWriteTokens = tokens?.cacheWrite ?? 0;

    if (!inputTokens && !outputTokens && !cacheReadTokens && !cacheWriteTokens && !cost) continue;

    totalInput += inputTokens;
    totalOutput += outputTokens;
    totalCacheRead += cacheReadTokens;
    totalCacheWrite += cacheWriteTokens;
    totalCost += cost;
    totalSessions++;

    const date = new Date(row.created_at).toISOString().slice(0, 10);
    const day = dailyMap.get(date) ?? {
      date, inputTokens: 0, outputTokens: 0,
      cacheReadTokens: 0, cacheCreateTokens: 0,
      sessions: 0, estimatedCostUsd: 0,
    };
    day.inputTokens += inputTokens;
    day.outputTokens += outputTokens;
    day.cacheReadTokens += cacheReadTokens;
    day.cacheCreateTokens += cacheWriteTokens;
    day.sessions++;
    day.estimatedCostUsd += cost;
    dailyMap.set(date, day);

    const m = modelMap.get(model) ?? { inputTokens: 0, outputTokens: 0, sessions: 0, estimatedCostUsd: 0 };
    m.inputTokens += inputTokens;
    m.outputTokens += outputTokens;
    m.sessions++;
    m.estimatedCostUsd += cost;
    modelMap.set(model, m);
  }

  for (const row of toolRows) {
    if (row.created_at < cutoffMs) continue;
    if (!row.input) continue;
    try {
      const parsed = JSON.parse(row.input) as { tool?: string };
      const toolName = parsed.tool ?? 'unknown';
      toolMap.set(toolName, (toolMap.get(toolName) ?? 0) + 1);
    } catch { /* skip malformed rows */ }
  }

  const daily = Array.from(dailyMap.values()).sort((a, b) => a.date.localeCompare(b.date));
  const byModel: Record<string, { inputTokens: number; outputTokens: number; sessions: number; estimatedCostUsd: number }> = {};
  for (const [k, v] of modelMap) byModel[k] = v;
  const byTool: Record<string, number> = {};
  for (const [k, v] of toolMap) byTool[k] = v;

  return {
    daily,
    totalInputTokens: totalInput,
    totalOutputTokens: totalOutput,
    totalCacheReadTokens: totalCacheRead,
    totalCacheCreateTokens: totalCacheWrite,
    totalSessions,
    totalEstimatedCostUsd: totalCost,
    byModel,
    byTool,
  };
}
