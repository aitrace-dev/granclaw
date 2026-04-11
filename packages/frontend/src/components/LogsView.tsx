import { useEffect, useState, useRef, useCallback } from 'react';
import { fetchLogs, type LogEntry } from '../lib/api.ts';

// ── Normalize API response ──────────────────────────────────────────────────

interface RawLogEntry {
  id: string;
  _id?: string;
  agent_id?: string;
  agentId?: string;
  type: string;
  input?: unknown;
  output?: unknown;
  duration_ms?: number;
  durationMs?: number;
  created_at?: number;
  createdAt?: string | number;
}

function normalizeEntry(raw: RawLogEntry): LogEntry {
  const createdAt = raw.createdAt ?? raw.created_at;
  return {
    _id: raw._id ?? raw.id,
    agentId: raw.agentId ?? raw.agent_id ?? '',
    type: raw.type as LogEntry['type'],
    input: raw.input,
    output: raw.output,
    durationMs: raw.durationMs ?? raw.duration_ms,
    createdAt: typeof createdAt === 'number' ? new Date(createdAt).toISOString() : (createdAt ?? ''),
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

type Filter = 'default' | 'all' | 'message' | 'tool_call' | 'error' | 'system';

const FILTERS: { label: string; value: Filter; color: string }[] = [
  { label: 'All', value: 'default', color: '' },
  { label: 'MSG', value: 'message', color: 'bg-emerald-500' },
  { label: 'TOOL', value: 'tool_call', color: 'bg-blue-500' },
  { label: 'ERR', value: 'error', color: 'bg-red-500' },
  { label: 'SYS', value: 'system', color: 'bg-gray-500' },
];

function levelColor(type: string): string {
  const map: Record<string, string> = {
    message: 'text-success',
    tool_call: 'text-info',
    tool_result: 'text-info/60',
    error: 'text-error',
    system: 'text-gray-500',
  };
  return map[type] ?? 'text-gray-500';
}

function levelBg(type: string): string {
  const map: Record<string, string> = {
    message: 'bg-emerald-500/10',
    tool_call: 'bg-blue-500/10',
    tool_result: 'bg-blue-500/5',
    error: 'bg-red-500/10',
    system: '',
  };
  return map[type] ?? '';
}

function levelDot(type: string): string {
  const map: Record<string, string> = {
    message: 'bg-emerald-400',
    tool_call: 'bg-blue-400',
    tool_result: 'bg-blue-400/60',
    error: 'bg-red-400',
    system: 'bg-gray-600',
  };
  return map[type] ?? 'bg-gray-600';
}

function formatTs(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const time = d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  if (d.toDateString() !== now.toDateString()) {
    const date = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return `${date} ${time}`;
  }
  return time;
}

// Parse a field that may be a JSON string or already an object
function parse(val: unknown): unknown {
  if (typeof val === 'string') {
    try { return JSON.parse(val); } catch { return val; }
  }
  return val;
}

function summarise(entry: LogEntry): string {
  const input = parse(entry.input) as Record<string, unknown> | null;
  const output = parse(entry.output) as Record<string, unknown> | null;

  if (entry.type === 'message') {
    const text = input?.text ?? '';
    return String(text) || '(no text)';
  }
  if (entry.type === 'tool_call') {
    const tool = input?.tool ?? input?.tool_name ?? input?.name ?? '';
    const desc = input?.description ?? '';
    if (tool) {
      const args = { ...input };
      delete args.tool; delete args.tool_name; delete args.name; delete args.description;
      delete args.input;
      // Show tool(key_arg) style
      const innerInput = parse(input?.input) as Record<string, unknown> | null;
      const argHint = innerInput
        ? Object.values(innerInput).map(v => String(v).slice(0, 60)).join(', ').slice(0, 80)
        : '';
      const summary = argHint ? `${tool}(${argHint})` : String(tool);
      return desc ? `${summary} — ${desc}` : summary;
    }
    return JSON.stringify(input ?? {}).slice(0, 200);
  }
  if (entry.type === 'tool_result') {
    return JSON.stringify(output ?? {}).slice(0, 200);
  }
  if (entry.type === 'error') {
    return String(output?.message ?? output ?? 'unknown error');
  }
  if (entry.type === 'system') {
    const exitCode = output?.exitCode;
    return exitCode !== undefined ? `process exited (${exitCode})` : '—';
  }
  return JSON.stringify(output ?? {}).slice(0, 200);
}

function highlightSearch(text: string, search: string): React.ReactNode {
  if (!search) return text;
  const idx = text.toLowerCase().indexOf(search.toLowerCase());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-yellow-400/30 text-yellow-200 rounded-sm px-0.5">{text.slice(idx, idx + search.length)}</mark>
      {text.slice(idx + search.length)}
    </>
  );
}

// ── Component ────────────────────────────────────────────────────────────────

export function LogsView({ agentId }: { agentId: string }) {
  const [filter, setFilter] = useState<Filter>('default');
  const [search, setSearch] = useState('');
  const [searchDebounced, setSearchDebounced] = useState('');
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [limit, setLimit] = useState(100);
  const [live, setLive] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const applySearch = () => setSearchDebounced(search);

  const load = useCallback(() => {
    fetchLogs({
      agentId,
      type: filter === 'default' || filter === 'all' ? undefined : filter,
      search: searchDebounced || undefined,
      limit,
    })
      .then((r) => {
        let entries = (r.items as unknown as RawLogEntry[]).map(normalizeEntry);
        if (filter === 'default') entries = entries.filter(e => e.type !== 'system');
        setLogs(entries);
        setTotal(r.total);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [agentId, filter, searchDebounced, limit]);

  // Initial load + polling
  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  useEffect(() => {
    if (!live) return;
    const interval = setInterval(load, 3000);
    return () => clearInterval(interval);
  }, [live, load]);

  const toggle = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // Newest first (DESC from API)
  const sorted = logs;

  return (
    <div className="flex flex-col h-full w-full min-w-0 rounded-lg overflow-hidden" style={{ background: '#0c0d12' }}>

      {/* ── Search + controls bar ── */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-outline-variant/30 bg-background">
        {/* Search */}
        <div className="flex-1 flex items-center gap-1.5">
          <div className="flex-1 relative">
            <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-on-surface-variant/60" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.452 4.391l3.328 3.329a.75.75 0 11-1.06 1.06l-3.329-3.328A7 7 0 012 9z" clipRule="evenodd" />
            </svg>
            <input
              className="w-full bg-surface-container-lowest rounded pl-8 pr-7 py-1.5 text-[11px] text-on-surface font-mono placeholder:text-on-surface-variant/25 outline-none focus:ring-1 focus:ring-primary/30 transition-shadow"
              placeholder="Search logs..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && applySearch()}
            />
            {search && (
              <button
                onClick={() => { setSearch(''); setSearchDebounced(''); }}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-on-surface-variant/60 hover:text-on-surface-variant/60 text-xs"
              >
                x
              </button>
            )}
          </div>
          <button
            onClick={applySearch}
            disabled={search === searchDebounced}
            className="px-2.5 py-1.5 rounded bg-primary/20 text-[10px] font-mono text-primary transition-colors hover:bg-primary/30 disabled:opacity-30 disabled:cursor-default flex-shrink-0"
          >
            Apply
          </button>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-0.5">
          {FILTERS.map(({ label, value, color }) => (
            <button
              key={value}
              onClick={() => setFilter(value)}
              className={`flex items-center gap-1 px-2 py-1 rounded text-[9px] font-mono transition-colors ${
                filter === value
                  ? 'bg-white/10 text-on-surface'
                  : 'text-on-surface-variant/70 hover:text-on-surface-variant/70 hover:surface-container/50'
              }`}
            >
              {color && <span className={`w-1.5 h-1.5 rounded-full ${color}`} />}
              {label}
            </button>
          ))}
        </div>

        {/* Live toggle */}
        <button
          onClick={() => setLive(l => !l)}
          className={`flex items-center gap-1.5 px-2 py-1 rounded text-[9px] font-mono transition-colors ${
            live ? 'bg-emerald-500/15 text-success' : 'text-on-surface-variant/70 hover:text-on-surface-variant/60'
          }`}
        >
          <span className={`w-1.5 h-1.5 rounded-full ${live ? 'bg-emerald-400 animate-pulse' : 'bg-gray-600'}`} />
          Live
        </button>

        {/* Count */}
        <span className="font-mono text-[9px] text-on-surface-variant/25 tabular-nums">
          {logs.length}/{total}
        </span>
      </div>

      {/* ── Log stream ── */}
      <div ref={containerRef} className="flex-1 overflow-y-auto scrollbar-thin font-mono text-[11px]">
        {loading && logs.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <span className="text-on-surface-variant/20 text-[10px]">loading...</span>
          </div>
        ) : sorted.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <span className="text-on-surface-variant/20 text-[10px]">
              {search ? `no results for "${search}"` : 'no log entries'}
            </span>
          </div>
        ) : (
          <div className="py-1">
            {sorted.map((entry) => {
              const isExpanded = expanded.has(entry._id);
              const summary = summarise(entry);

              return (
                <div
                  key={entry._id}
                  onClick={() => toggle(entry._id)}
                  className={`group px-3 py-[5px] cursor-pointer transition-colors hover:bg-white/[0.03] ${levelBg(entry.type)} ${isExpanded ? 'bg-white/[0.02]' : ''}`}
                >
                  {/* Single log line */}
                  <div className="flex items-start gap-2 leading-relaxed">
                    {/* Dot */}
                    <span className={`mt-[6px] w-[5px] h-[5px] rounded-full flex-shrink-0 ${levelDot(entry.type)}`} />

                    {/* Timestamp */}
                    <span className="text-on-surface-variant/25 flex-shrink-0 w-[70px] tabular-nums">
                      {formatTs(entry.createdAt)}
                    </span>

                    {/* Type badge */}
                    <span className={`flex-shrink-0 w-[52px] uppercase text-[9px] ${levelColor(entry.type)}`}>
                      {entry.type === 'tool_call' ? 'tool' : entry.type === 'tool_result' ? 'result' : entry.type}
                    </span>

                    {/* Message */}
                    <span className={`flex-1 min-w-0 ${isExpanded ? '' : 'truncate'} ${
                      entry.type === 'error' ? 'text-error' : 'text-on-surface-variant/60'
                    }`}>
                      {highlightSearch(summary, searchDebounced)}
                    </span>

                    {/* Duration */}
                    {entry.durationMs != null && (
                      <span className="flex-shrink-0 text-[9px] text-on-surface-variant/20 tabular-nums">
                        {entry.durationMs > 1000 ? `${(entry.durationMs / 1000).toFixed(1)}s` : `${entry.durationMs}ms`}
                      </span>
                    )}

                    {/* Expand indicator */}
                    <span className="flex-shrink-0 text-[8px] text-on-surface-variant/15 opacity-0 group-hover:opacity-100 transition-opacity">
                      {isExpanded ? '−' : '+'}
                    </span>
                  </div>

                  {/* Expanded detail */}
                  {isExpanded && (
                    <div className="ml-[79px] mt-1.5 mb-1 space-y-1.5">
                      {!!entry.input && entry.input !== 'null' && (
                        <div>
                          <span className="text-[8px] uppercase text-on-surface-variant/20">input</span>
                          <pre className="text-[10px] text-on-surface-variant/70 mt-0.5 bg-black/30 rounded px-2.5 py-1.5 overflow-auto max-h-48 whitespace-pre-wrap break-words">
                            {JSON.stringify(parse(entry.input), null, 2)}
                          </pre>
                        </div>
                      )}
                      {!!entry.output && entry.output !== 'null' && (
                        <div>
                          <span className="text-[8px] uppercase text-on-surface-variant/20">output</span>
                          <pre className="text-[10px] text-on-surface-variant/70 mt-0.5 bg-black/30 rounded px-2.5 py-1.5 overflow-auto max-h-48 whitespace-pre-wrap break-words">
                            {JSON.stringify(parse(entry.output), null, 2)}
                          </pre>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            {/* Load older */}
            {logs.length < total && (
              <div className="px-3 py-2 text-center">
                <button
                  onClick={() => setLimit(l => l + 100)}
                  className="text-[9px] text-primary/40 hover:text-primary/70 transition-colors"
                >
                  Load {Math.min(100, total - logs.length)} older entries...
                </button>
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        )}
      </div>
    </div>
  );
}
