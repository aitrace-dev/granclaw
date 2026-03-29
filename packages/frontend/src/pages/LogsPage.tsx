import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { fetchLogs, type LogEntry } from '../lib/api.ts';

type Filter = 'all' | 'message' | 'tool_call' | 'tool_result' | 'error';

const FILTERS: { label: string; value: Filter }[] = [
  { label: 'ALL', value: 'all' },
  { label: 'MESSAGE', value: 'message' },
  { label: 'TOOL CALL', value: 'tool_call' },
  { label: 'TOOL RESULT', value: 'tool_result' },
  { label: 'ERROR', value: 'error' },
];

function rowTint(type: string) {
  if (type === 'error') return 'bg-error/5';
  return '';
}

function typeBadge(type: string) {
  const map: Record<string, string> = {
    message: 'text-secondary',
    tool_call: 'text-primary',
    tool_result: 'text-primary/70',
    error: 'text-error',
    system: 'text-on-surface-variant',
  };
  return map[type] ?? 'text-on-surface-variant';
}

function formatTime(iso: string) {
  const d = new Date(iso);
  const hms = d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  return `${hms}.${ms}`;
}

function summarise(entry: LogEntry): string {
  if (entry.type === 'message') {
    const text = (entry.input as { text?: string })?.text ?? '';
    return text.length > 80 ? text.slice(0, 80) + '…' : text;
  }
  if (entry.type === 'tool_call') {
    return JSON.stringify(entry.input ?? {}).slice(0, 80);
  }
  if (entry.type === 'tool_result') {
    return JSON.stringify(entry.output ?? {}).slice(0, 80);
  }
  if (entry.type === 'error') {
    return String((entry.output as { message?: string })?.message ?? entry.output ?? '');
  }
  return JSON.stringify(entry.output ?? {}).slice(0, 60);
}

export function LogsPage() {
  const [searchParams] = useSearchParams();
  const agentIdParam = searchParams.get('agentId') ?? undefined;

  const [filter, setFilter] = useState<Filter>('all');
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetchLogs({
      agentId: agentIdParam,
      type: filter === 'all' ? undefined : filter,
      limit: 50,
    })
      .then((r) => { setLogs(r.items); setTotal(r.total); })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [filter, agentIdParam]);

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-semibold text-on-surface">
          Logs {agentIdParam && <span className="font-mono text-base text-secondary ml-2">{agentIdParam}</span>}
        </h1>
        <span className="font-mono text-xs text-on-surface-variant">
          showing {logs.length} of {total}
        </span>
      </div>

      {/* Filter chips */}
      <div className="flex gap-2">
        {FILTERS.map(({ label, value }) => (
          <button
            key={value}
            onClick={() => setFilter(value)}
            className={`rounded-full px-3 py-1 text-xs font-medium uppercase tracking-wide transition-colors
              ${filter === value
                ? 'bg-secondary text-[#002113]'
                : 'bg-surface-high text-on-surface-variant hover:bg-surface-highest'
              }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="rounded-lg bg-surface-card overflow-hidden">
        {loading ? (
          <p className="p-4 font-mono text-sm text-on-surface-variant">loading…</p>
        ) : logs.length === 0 ? (
          <p className="p-4 font-mono text-sm text-on-surface-variant">no log entries found</p>
        ) : (
          <table className="w-full text-left">
            <thead>
              <tr className="bg-surface-lowest text-[10px] uppercase tracking-widest text-on-surface-variant">
                <th className="px-3 py-2 font-medium w-36">Timestamp</th>
                <th className="px-3 py-2 font-medium w-28">Agent</th>
                <th className="px-3 py-2 font-medium w-24">Type</th>
                <th className="px-3 py-2 font-medium">Details</th>
                <th className="px-3 py-2 font-medium w-16 text-right">ms</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((entry) => (
                <tr key={entry._id} className={`border-t border-outline-variant/10 ${rowTint(entry.type)}`}>
                  <td className="px-3 py-1.5 font-mono text-xs text-on-surface-variant whitespace-nowrap">
                    {formatTime(entry.createdAt)}
                  </td>
                  <td className="px-3 py-1.5 font-mono text-xs text-secondary">
                    {entry.agentId}
                  </td>
                  <td className={`px-3 py-1.5 font-mono text-xs ${typeBadge(entry.type)}`}>
                    {entry.type}
                  </td>
                  <td className="px-3 py-1.5 font-mono text-xs text-on-surface-variant truncate max-w-xs">
                    {summarise(entry)}
                  </td>
                  <td className="px-3 py-1.5 font-mono text-xs text-on-surface-variant text-right">
                    {entry.durationMs != null ? entry.durationMs : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
