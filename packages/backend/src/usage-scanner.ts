/**
 * usage-scanner.ts
 *
 * Scans Claude Code's JSONL session files to extract token usage data.
 * Files are at: ~/.claude/projects/<encoded-workspace-path>/*.jsonl
 *
 * Each JSONL file = one Claude session. Each line with type "assistant"
 * contains message.usage with token counts.
 */

import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { REPO_ROOT, getAgent } from './config.js';

// Pricing per million tokens (April 2026 rates)
const PRICING: Record<string, { input: number; output: number; cacheWrite: number; cacheRead: number }> = {
  'opus': { input: 6.15, output: 30.75, cacheWrite: 7.69, cacheRead: 0.61 },
  'sonnet': { input: 3.69, output: 18.45, cacheWrite: 4.61, cacheRead: 0.37 },
  'haiku': { input: 1.23, output: 6.15, cacheWrite: 1.54, cacheRead: 0.12 },
};

function getPricing(model: string) {
  for (const [key, pricing] of Object.entries(PRICING)) {
    if (model.includes(key)) return pricing;
  }
  return null;
}

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

function getClaudeProjectDir(agentId: string): string | null {
  const agent = getAgent(agentId);
  if (!agent) return null;

  const workspaceDir = path.resolve(REPO_ROOT, agent.workspaceDir);
  // Claude encodes the path: remove leading /, replace / with -
  const encoded = workspaceDir.replace(/^\//, '').replace(/\//g, '-');
  const claudeDir = path.join(process.env.HOME ?? '', '.claude', 'projects', `-${encoded}`);

  if (!fs.existsSync(claudeDir)) return null;
  return claudeDir;
}

export async function scanUsage(agentId: string, days = 30): Promise<UsageSummary> {
  const claudeDir = getClaudeProjectDir(agentId);

  const dailyMap = new Map<string, DailyUsage>();
  const modelMap = new Map<string, { inputTokens: number; outputTokens: number; sessions: number; estimatedCostUsd: number }>();
  const toolMap = new Map<string, number>();
  let totalInput = 0, totalOutput = 0, totalCacheRead = 0, totalCacheCreate = 0, totalCost = 0, totalSessions = 0;

  if (!claudeDir) {
    return { daily: [], totalInputTokens: 0, totalOutputTokens: 0, totalCacheReadTokens: 0, totalCacheCreateTokens: 0, totalSessions: 0, totalEstimatedCostUsd: 0, byModel: {}, byTool: {} };
  }

  const cutoff = Date.now() - days * 86400000;
  const files = fs.readdirSync(claudeDir).filter(f => f.endsWith('.jsonl'));

  for (const file of files) {
    const filePath = path.join(claudeDir, file);
    const stat = fs.statSync(filePath);
    if (stat.mtimeMs < cutoff) continue; // skip old files

    let sessionModel = 'unknown';
    let sessionInput = 0, sessionOutput = 0, sessionCacheRead = 0, sessionCacheCreate = 0;
    let sessionDate: string | null = null;
    let hasUsage = false;

    const rl = readline.createInterface({ input: fs.createReadStream(filePath), crlfDelay: Infinity });

    for await (const line of rl) {
      if (!line.trim()) continue;
      try {
        const record = JSON.parse(line);
        // Count tool usage
        if (record.type === 'assistant' && record.message?.content && Array.isArray(record.message.content)) {
          for (const block of record.message.content) {
            if (block.type === 'tool_use' && block.name) {
              toolMap.set(block.name, (toolMap.get(block.name) ?? 0) + 1);
            }
          }
        }
        if (record.type === 'assistant' && record.message?.usage) {
          const usage = record.message.usage;
          const model = record.message.model ?? 'unknown';
          sessionModel = model;
          hasUsage = true;

          const input = usage.input_tokens ?? 0;
          const output = usage.output_tokens ?? 0;
          const cacheRead = usage.cache_read_input_tokens ?? 0;
          const cacheCreate = usage.cache_creation_input_tokens ?? 0;

          sessionInput += input;
          sessionOutput += output;
          sessionCacheRead += cacheRead;
          sessionCacheCreate += cacheCreate;

          // Get date from the record timestamp or file mtime
          if (!sessionDate && record.timestamp) {
            sessionDate = new Date(record.timestamp).toISOString().slice(0, 10);
          }
        }
      } catch { /* skip malformed lines */ }
    }

    if (!hasUsage) continue;
    if (!sessionDate) sessionDate = new Date(stat.mtimeMs).toISOString().slice(0, 10);

    totalInput += sessionInput;
    totalOutput += sessionOutput;
    totalCacheRead += sessionCacheRead;
    totalCacheCreate += sessionCacheCreate;
    totalSessions++;

    // Cost estimate
    const pricing = getPricing(sessionModel);
    let cost = 0;
    if (pricing) {
      cost = (sessionInput * pricing.input + sessionOutput * pricing.output +
        sessionCacheRead * pricing.cacheRead + sessionCacheCreate * pricing.cacheWrite) / 1_000_000;
    }
    totalCost += cost;

    // Daily aggregation
    const day = dailyMap.get(sessionDate) ?? { date: sessionDate, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreateTokens: 0, sessions: 0, estimatedCostUsd: 0 };
    day.inputTokens += sessionInput;
    day.outputTokens += sessionOutput;
    day.cacheReadTokens += sessionCacheRead;
    day.cacheCreateTokens += sessionCacheCreate;
    day.sessions++;
    day.estimatedCostUsd += cost;
    dailyMap.set(sessionDate, day);

    // Model aggregation
    const m = modelMap.get(sessionModel) ?? { inputTokens: 0, outputTokens: 0, sessions: 0, estimatedCostUsd: 0 };
    m.inputTokens += sessionInput;
    m.outputTokens += sessionOutput;
    m.sessions++;
    m.estimatedCostUsd += cost;
    modelMap.set(sessionModel, m);
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
    totalCacheCreateTokens: totalCacheCreate,
    totalSessions,
    totalEstimatedCostUsd: totalCost,
    byModel,
    byTool,
  };
}
