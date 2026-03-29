// Typed wrappers around the backend REST API

export interface Agent {
  id: string;
  name: string;
  model: string;
  allowedTools: string[];
  bigBrother: { enabled: boolean };
  sessionId: string | null;
  status: 'active' | 'idle';
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

export async function fetchAgent(id: string): Promise<Agent> {
  const res = await fetch(`${BASE}/agents/${id}`);
  if (!res.ok) throw new Error(`fetchAgent: ${res.status}`);
  return res.json() as Promise<Agent>;
}

export async function fetchLogs(params?: {
  agentId?: string;
  type?: string;
  limit?: number;
  offset?: number;
}): Promise<LogsResponse> {
  const qs = new URLSearchParams();
  if (params?.agentId) qs.set('agentId', params.agentId);
  if (params?.type) qs.set('type', params.type);
  if (params?.limit != null) qs.set('limit', String(params.limit));
  if (params?.offset != null) qs.set('offset', String(params.offset));
  const res = await fetch(`${BASE}/logs?${qs}`);
  if (!res.ok) throw new Error(`fetchLogs: ${res.status}`);
  return res.json() as Promise<LogsResponse>;
}
