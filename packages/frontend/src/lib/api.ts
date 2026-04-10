// Typed wrappers around the backend REST API

export interface Agent {
  id: string;
  name: string;
  model: string;
  allowedTools: string[];
  bigBrother: { enabled: boolean };
  sessionId: string | null;
  status: 'active' | 'idle';
  wsPort: number;
  bbPort: number | null;
  pid?: number;
  installedTools: Record<string, unknown>;
  guardrails: string[] | null;
}

export interface LogEntry {
  _id: string;
  agentId: string;
  type: 'message' | 'tool_call' | 'tool_result' | 'error' | 'system';
  input?: unknown;
  output?: unknown;
  durationMs?: number;
  createdAt: string;
}

export interface LogsResponse {
  items: LogEntry[];
  total: number;
  limit: number;
  offset: number;
}

const BASE = '';

export async function fetchAgents(): Promise<Agent[]> {
  const res = await fetch(`${BASE}/agents`);
  if (!res.ok) throw new Error(`fetchAgents: ${res.status}`);
  return res.json() as Promise<Agent[]>;
}

export async function createAgent(id: string, name: string, model?: string, workspaceDir?: string): Promise<void> {
  const res = await fetch(`${BASE}/agents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, name, model, ...(workspaceDir ? { workspaceDir } : {}) }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText })) as { error: string };
    throw new Error(err.error);
  }
}

export async function deleteAgent(id: string): Promise<void> {
  const res = await fetch(`${BASE}/agents/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`deleteAgent: ${res.status}`);
}

export async function fetchAgent(id: string): Promise<Agent> {
  const res = await fetch(`${BASE}/agents/${id}`);
  if (!res.ok) throw new Error(`fetchAgent: ${res.status}`);
  return res.json() as Promise<Agent>;
}

export interface ChatMessage {
  id: string;
  agentId: string;
  channelId: string;
  role: 'user' | 'assistant' | 'tool_call';
  content: string;
  createdAt: number;
}

export async function fetchMessages(agentId: string, channelId = 'ui'): Promise<ChatMessage[]> {
  const res = await fetch(`${BASE}/agents/${agentId}/messages?channelId=${channelId}`);
  if (!res.ok) throw new Error(`fetchMessages: ${res.status}`);
  return res.json() as Promise<ChatMessage[]>;
}

export async function postMessage(
  agentId: string,
  role: 'user' | 'assistant',
  content: string,
  channelId = 'ui'
): Promise<void> {
  await fetch(`${BASE}/agents/${agentId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role, content, channelId }),
  });
}

export async function resetAgent(agentId: string): Promise<void> {
  const res = await fetch(`${BASE}/agents/${agentId}/reset`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`resetAgent: ${res.status}`);
}

// ── Agent .env ──────────────────────────────────────────────────────────────

export interface EnvEntry { key: string; value: string; }

export async function fetchEnv(agentId: string): Promise<EnvEntry[]> {
  const res = await fetch(`${BASE}/agents/${agentId}/env`);
  if (!res.ok) throw new Error(`fetchEnv: ${res.status}`);
  const data = await res.json() as { entries: EnvEntry[] };
  return data.entries;
}

export async function saveEnv(agentId: string, entries: EnvEntry[]): Promise<void> {
  const res = await fetch(`${BASE}/agents/${agentId}/env`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ entries }),
  });
  if (!res.ok) throw new Error(`saveEnv: ${res.status}`);
}

// ── Workspace filesystem ────────────────────────────────────────────────────

export interface FileEntry {
  name: string;
  type: 'file' | 'directory';
  size?: number;
}

export async function fetchFiles(agentId: string, dirPath = ''): Promise<FileEntry[]> {
  const res = await fetch(`${BASE}/agents/${agentId}/files?path=${encodeURIComponent(dirPath)}`);
  if (!res.ok) throw new Error(`fetchFiles: ${res.status}`);
  const data = await res.json() as { entries: FileEntry[] };
  return data.entries;
}

export async function readFile(agentId: string, filePath: string): Promise<string> {
  const res = await fetch(`${BASE}/agents/${agentId}/files/read?path=${encodeURIComponent(filePath)}`);
  if (!res.ok) throw new Error(`readFile: ${res.status}`);
  const data = await res.json() as { content: string };
  return data.content;
}

export async function writeFile(agentId: string, filePath: string, content: string): Promise<void> {
  const res = await fetch(`${BASE}/agents/${agentId}/files/write?path=${encodeURIComponent(filePath)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
  if (!res.ok) throw new Error(`writeFile: ${res.status}`);
}

// ── Secrets ─────────────────────────────────────────────────────────────────

export interface SecretsResponse {
  names: string[];
}

export async function fetchSecrets(agentId: string): Promise<SecretsResponse> {
  const res = await fetch(`${BASE}/agents/${agentId}/secrets`);
  if (!res.ok) throw new Error(`fetchSecrets: ${res.status}`);
  return res.json() as Promise<SecretsResponse>;
}

export async function addSecret(agentId: string, name: string, value: string): Promise<void> {
  const res = await fetch(`${BASE}/agents/${agentId}/secrets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, value }),
  });
  if (!res.ok) throw new Error(`addSecret: ${res.status}`);
}

export async function updateSecret(agentId: string, name: string, value: string): Promise<void> {
  const res = await fetch(`${BASE}/agents/${agentId}/secrets/${encodeURIComponent(name)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value }),
  });
  if (!res.ok) throw new Error(`updateSecret: ${res.status}`);
}

export async function deleteSecretApi(agentId: string, name: string): Promise<void> {
  const res = await fetch(`${BASE}/agents/${agentId}/secrets/${encodeURIComponent(name)}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`deleteSecret: ${res.status}`);
}

// ── Skills ─────────────────────────────────────────────────────────────────

export interface Skill {
  name: string;
  description: string;
}

export async function fetchSkills(agentId: string): Promise<Skill[]> {
  const res = await fetch(`${BASE}/agents/${agentId}/skills`);
  if (!res.ok) throw new Error(`fetchSkills: ${res.status}`);
  const data = await res.json() as { skills: Skill[] };
  return data.skills;
}

// ── Tasks ──────────────────────────────────────────────────────────────────

export type TaskStatus = 'backlog' | 'in_progress' | 'scheduled' | 'to_review' | 'done';

export interface Task {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  source: 'agent' | 'human';
  updatedBy: 'agent' | 'human' | null;
  createdAt: number;
  updatedAt: number;
}

export interface TaskWithComments extends Task {
  comments: TaskComment[];
}

export interface TaskComment {
  id: string;
  taskId: string;
  body: string;
  source: 'agent' | 'human';
  createdAt: number;
}

export async function fetchTasks(agentId: string, status?: string): Promise<Task[]> {
  const qs = status ? `?status=${status}` : '';
  const res = await fetch(`${BASE}/agents/${agentId}/tasks${qs}`);
  if (!res.ok) throw new Error(`fetchTasks: ${res.status}`);
  return res.json() as Promise<Task[]>;
}

export async function fetchTask(agentId: string, taskId: string): Promise<TaskWithComments> {
  const res = await fetch(`${BASE}/agents/${agentId}/tasks/${taskId}`);
  if (!res.ok) throw new Error(`fetchTask: ${res.status}`);
  return res.json() as Promise<TaskWithComments>;
}

export async function createTaskApi(agentId: string, data: { title: string; description?: string; status?: TaskStatus }): Promise<Task> {
  const res = await fetch(`${BASE}/agents/${agentId}/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`createTask: ${res.status}`);
  return res.json() as Promise<Task>;
}

export async function updateTaskApi(agentId: string, taskId: string, data: { title?: string; description?: string; status?: TaskStatus }): Promise<Task> {
  const res = await fetch(`${BASE}/agents/${agentId}/tasks/${taskId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`updateTask: ${res.status}`);
  return res.json() as Promise<Task>;
}

export async function deleteTaskApi(agentId: string, taskId: string): Promise<void> {
  const res = await fetch(`${BASE}/agents/${agentId}/tasks/${taskId}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`deleteTask: ${res.status}`);
}

export async function addTaskComment(agentId: string, taskId: string, body: string): Promise<TaskComment> {
  const res = await fetch(`${BASE}/agents/${agentId}/tasks/${taskId}/comments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body }),
  });
  if (!res.ok) throw new Error(`addTaskComment: ${res.status}`);
  return res.json() as Promise<TaskComment>;
}

// ── Workflow types ────────────────────────────────────────────────────────

export type WorkflowStatus = 'active' | 'paused' | 'archived';
export type StepType = 'code' | 'llm' | 'agent';
export type RunStatus = 'running' | 'completed' | 'failed' | 'cancelled';
export type RunStepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

export interface CodeConfig {
  script: string;
  shell?: string;
  timeout_ms?: number;
}

export interface LlmConfig {
  prompt: string;
  model?: string;
  output_schema?: Record<string, string>;
}

export interface Condition {
  expr: string;
  goto: string;
}

export interface WorkflowStep {
  id: string;
  workflowId: string;
  position: number;
  name: string;
  type: StepType;
  config: CodeConfig | LlmConfig;
  transitions: { conditions: Condition[] } | null;
}

export interface Workflow {
  id: string;
  name: string;
  description: string;
  status: WorkflowStatus;
  createdAt: number;
  updatedAt: number;
}

export interface WorkflowWithSteps extends Workflow {
  steps: WorkflowStep[];
}

export interface WorkflowRun {
  id: string;
  workflowId: string;
  status: RunStatus;
  trigger: string;
  startedAt: number;
  finishedAt: number | null;
}

export interface WorkflowRunStep {
  id: string;
  runId: string;
  stepId: string;
  status: RunStepStatus;
  input: unknown;
  output: unknown;
  error: string | null;
  startedAt: number | null;
  finishedAt: number | null;
  durationMs: number | null;
}

export interface WorkflowRunWithSteps extends WorkflowRun {
  steps: WorkflowRunStep[];
}

// ── Browser Sessions ───────────────────────────────────────────────────

export interface BrowserSessionSummary {
  id: string;
  name: string | null;
  status: 'active' | 'closed';
  createdAt: number;
  closedAt: number | null;
  screenshotCount: number;
}

export interface SessionCommand {
  args: string;
  timestamp: number;
  screenshot: string | null;
}

export interface BrowserSessionDetail extends BrowserSessionSummary {
  commands: SessionCommand[];
  screenshots: string[];
}

export async function fetchBrowserSessions(agentId: string): Promise<BrowserSessionSummary[]> {
  const res = await fetch(`${BASE}/agents/${agentId}/browser-sessions`);
  if (!res.ok) throw new Error(`fetchBrowserSessions: ${res.status}`);
  return res.json() as Promise<BrowserSessionSummary[]>;
}

export async function fetchBrowserSession(agentId: string, sessionId: string): Promise<BrowserSessionDetail> {
  const res = await fetch(`${BASE}/agents/${agentId}/browser-sessions/${sessionId}`);
  if (!res.ok) throw new Error(`fetchBrowserSession: ${res.status}`);
  return res.json() as Promise<BrowserSessionDetail>;
}

export function browserScreenshotUrl(agentId: string, sessionId: string, filename: string): string {
  return `${BASE}/agents/${agentId}/browser-sessions/${sessionId}/screenshots/${filename}`;
}

export async function generateBrowserSessionName(agentId: string, sessionId: string): Promise<string | null> {
  const res = await fetch(`${BASE}/agents/${agentId}/browser-sessions/${sessionId}/name`, { method: 'POST' });
  if (!res.ok) throw new Error(`generateSessionName: ${res.status}`);
  const data = await res.json() as { name: string | null };
  return data.name;
}

// ── Browser Profile ───────────────────────────────────────────────────

export interface BrowserProfileResponse {
  hasProfile: boolean;
  activeBrowser: { url: string } | null;
}

export async function launchBrowser(agentId: string, url: string): Promise<void> {
  const res = await fetch(`${BASE}/agents/${agentId}/browser-launch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText })) as { error: string };
    throw new Error(err.error);
  }
}

export async function closeBrowser(agentId: string): Promise<void> {
  const res = await fetch(`${BASE}/agents/${agentId}/browser-close`, { method: 'POST' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText })) as { error: string };
    throw new Error(err.error);
  }
}

export async function fetchBrowserProfile(agentId: string): Promise<BrowserProfileResponse> {
  const res = await fetch(`${BASE}/agents/${agentId}/browser-profile`);
  if (!res.ok) throw new Error(`fetchBrowserProfile: ${res.status}`);
  return res.json() as Promise<BrowserProfileResponse>;
}

export async function deleteBrowserProfile(agentId: string): Promise<void> {
  const res = await fetch(`${BASE}/agents/${agentId}/browser-profile`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`deleteBrowserProfile: ${res.status}`);
}

// ── Vault ──────────────────────────────────────────────────────────────────

export function exportVaultUrl(agentId: string): string {
  return `${BASE}/agents/${agentId}/vault/export`;
}

// ── Monitor ───────────────────────────────────────────────────────────────

export interface MonitorJob {
  id: string;
  channelId: string;
  status: string;
  message: string;
  createdAt: number;
}

export interface MonitorWorkflow {
  runId: string;
  workflowId: string;
  workflowName: string;
  startedAt: number;
}

export interface ProcessInfo {
  pid: number;
  cpu: string;
  mem: string;
  rss: string;
  elapsed: string;
  command: string;
}

export interface MonitorData {
  agent: ProcessInfo & { role: string; wsPort: number } | null;
  guardian: ProcessInfo & { role: string; bbPort: number | null } | null;
  claudeProcesses: ProcessInfo[];
  browserProcess: { pid: number; cpu: string; mem: string; rss: string } | null;
  jobs: { processing: MonitorJob[]; pending: MonitorJob[] };
  workflows: MonitorWorkflow[];
  headedBrowser: { url: string } | null;
}

export async function killJob(agentId: string, jobId: string): Promise<void> {
  const res = await fetch(`${BASE}/agents/${agentId}/monitor/jobs/${jobId}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`killJob: ${res.status}`);
}

export async function fetchMonitor(agentId: string): Promise<MonitorData> {
  const res = await fetch(`${BASE}/agents/${agentId}/monitor`);
  if (!res.ok) throw new Error(`fetchMonitor: ${res.status}`);
  return res.json() as Promise<MonitorData>;
}

// ── Usage ─────────────────────────────────────────────────────────────────

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

export async function fetchUsage(agentId: string, days = 30): Promise<UsageSummary> {
  const res = await fetch(`${BASE}/agents/${agentId}/usage?days=${days}`);
  if (!res.ok) throw new Error(`fetchUsage: ${res.status}`);
  return res.json() as Promise<UsageSummary>;
}

// ── Schedules ─────────────────────────────────────────────────────────────

export type ScheduleStatus = 'active' | 'paused';

export interface Schedule {
  id: string;
  agentId: string;
  name: string;
  message: string;
  cron: string;
  timezone: string;
  status: ScheduleStatus;
  nextRun: number | null;
  lastRun: number | null;
  createdAt: number;
}

export async function fetchSchedules(agentId: string): Promise<Schedule[]> {
  const res = await fetch(`${BASE}/agents/${agentId}/schedules`);
  if (!res.ok) throw new Error(`fetchSchedules: ${res.status}`);
  return res.json() as Promise<Schedule[]>;
}

export async function createScheduleApi(
  agentId: string,
  data: { name: string; message: string; cron: string; timezone?: string }
): Promise<Schedule> {
  const res = await fetch(`${BASE}/agents/${agentId}/schedules`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`createSchedule: ${res.status}`);
  return res.json() as Promise<Schedule>;
}

export async function updateScheduleApi(
  agentId: string,
  scheduleId: string,
  data: { name?: string; message?: string; cron?: string; timezone?: string; status?: ScheduleStatus }
): Promise<Schedule> {
  const res = await fetch(`${BASE}/agents/${agentId}/schedules/${scheduleId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`updateSchedule: ${res.status}`);
  return res.json() as Promise<Schedule>;
}

export async function deleteScheduleApi(agentId: string, scheduleId: string): Promise<void> {
  const res = await fetch(`${BASE}/agents/${agentId}/schedules/${scheduleId}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`deleteSchedule: ${res.status}`);
}

export async function triggerScheduleApi(agentId: string, scheduleId: string): Promise<void> {
  const res = await fetch(`${BASE}/agents/${agentId}/schedules/${scheduleId}/trigger`, { method: 'POST' });
  if (!res.ok) throw new Error(`triggerSchedule: ${res.status}`);
}

// ── Workflow API ──────────────────────────────────────────────────────────

export async function fetchWorkflows(agentId: string): Promise<Workflow[]> {
  const res = await fetch(`${BASE}/agents/${agentId}/workflows`);
  if (!res.ok) throw new Error(`fetchWorkflows: ${res.status}`);
  return res.json() as Promise<Workflow[]>;
}

export async function fetchWorkflow(agentId: string, workflowId: string): Promise<WorkflowWithSteps> {
  const res = await fetch(`${BASE}/agents/${agentId}/workflows/${workflowId}`);
  if (!res.ok) throw new Error(`fetchWorkflow: ${res.status}`);
  return res.json() as Promise<WorkflowWithSteps>;
}

export async function fetchWorkflowRuns(agentId: string, workflowId: string): Promise<WorkflowRun[]> {
  const res = await fetch(`${BASE}/agents/${agentId}/workflows/${workflowId}/runs`);
  if (!res.ok) throw new Error(`fetchWorkflowRuns: ${res.status}`);
  return res.json() as Promise<WorkflowRun[]>;
}

export async function fetchWorkflowRun(agentId: string, workflowId: string, runId: string): Promise<WorkflowRunWithSteps> {
  const res = await fetch(`${BASE}/agents/${agentId}/workflows/${workflowId}/runs/${runId}`);
  if (!res.ok) throw new Error(`fetchWorkflowRun: ${res.status}`);
  return res.json() as Promise<WorkflowRunWithSteps>;
}

export async function triggerWorkflowRun(agentId: string, workflowId: string): Promise<{ runId: string }> {
  const res = await fetch(`${BASE}/agents/${agentId}/workflows/${workflowId}/run`, { method: 'POST' });
  if (!res.ok) throw new Error(`triggerWorkflowRun: ${res.status}`);
  return res.json() as Promise<{ runId: string }>;
}

// ── Logs ────────────────────────────────────────────────────────────────────

export async function fetchLogs(params?: {
  agentId?: string;
  type?: string;
  search?: string;
  limit?: number;
  offset?: number;
}): Promise<LogsResponse> {
  const qs = new URLSearchParams();
  if (params?.agentId) qs.set('agentId', params.agentId);
  if (params?.type) qs.set('type', params.type);
  if (params?.search) qs.set('search', params.search);
  if (params?.limit != null) qs.set('limit', String(params.limit));
  if (params?.offset != null) qs.set('offset', String(params.offset));
  const res = await fetch(`${BASE}/logs?${qs}`);
  if (!res.ok) throw new Error(`fetchLogs: ${res.status}`);
  return res.json() as Promise<LogsResponse>;
}

// ── Provider settings ─────────────────────────────────────────────────────────

export interface ProviderSettings {
  provider: string | null;
  model: string | null;
  configured: boolean;
}

export async function fetchProviderSettings(): Promise<ProviderSettings> {
  const res = await fetch(`${BASE}/settings/provider`);
  if (!res.ok) throw new Error('Failed to fetch provider settings');
  return res.json() as Promise<ProviderSettings>;
}

export async function saveProviderSettings(provider: string, model: string, apiKey: string): Promise<void> {
  const res = await fetch(`${BASE}/settings/provider`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider, model, apiKey }),
  });
  if (!res.ok) throw new Error('Failed to save provider settings');
}

export async function clearProviderSettings(): Promise<void> {
  const res = await fetch(`${BASE}/settings/provider`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to clear provider settings');
}
