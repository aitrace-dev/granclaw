import { useState, useEffect, useCallback } from 'react';
import {
  fetchSchedules, updateScheduleApi, deleteScheduleApi, triggerScheduleApi,
  fetchScheduleRuns, fetchScheduleRunMessages,
  type Schedule, type ScheduleRun, type ChatMessage,
} from '../lib/api.ts';

// ── Helpers ────────────────────────────────────────────────────────────────

function cronToHuman(cron: string): string {
  const parts = cron.split(' ');
  if (parts.length !== 5) return cron;
  const [min, hour, dom, mon, dow] = parts;

  if (dom === '*' && mon === '*' && dow === '*') {
    if (hour !== '*' && min !== '*') return `Daily at ${hour.padStart(2, '0')}:${min.padStart(2, '0')}`;
    if (hour === '*' && min === '0') return 'Every hour';
    if (hour === '*') return `Every hour at :${min.padStart(2, '0')}`;
  }

  if (dom === '*' && mon === '*' && dow !== '*') {
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const dayNames = dow.split(',').map(d => days[Number(d)] ?? d).join(', ');
    if (hour !== '*' && min !== '*') return `${dayNames} at ${hour.padStart(2, '0')}:${min.padStart(2, '0')}`;
  }

  return cron;
}

function relativeTime(ms: number | null): string {
  if (!ms) return '—';
  const diff = ms - Date.now();
  const absDiff = Math.abs(diff);
  if (absDiff < 60_000) return diff > 0 ? 'in <1m' : '<1m ago';
  if (absDiff < 3_600_000) {
    const mins = Math.round(absDiff / 60_000);
    return diff > 0 ? `in ${mins}m` : `${mins}m ago`;
  }
  if (absDiff < 86_400_000) {
    const hours = Math.round(absDiff / 3_600_000);
    return diff > 0 ? `in ${hours}h` : `${hours}h ago`;
  }
  const days = Math.round(absDiff / 86_400_000);
  return diff > 0 ? `in ${days}d` : `${days}d ago`;
}

// ── Run detail view ────────────────────────────────────────────────────────

function RunMessages({ agentId, run, onBack }: { agentId: string; run: ScheduleRun; onBack: () => void }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const msgs = await fetchScheduleRunMessages(agentId, run.channelId);
      setMessages(msgs);
    } catch { /* ignore */ }
    setLoading(false);
  }, [agentId, run.channelId]);

  useEffect(() => {
    void load();
    // Poll while messages list is empty (run may still be in progress)
    const id = setInterval(() => { void load(); }, 2000);
    return () => clearInterval(id);
  }, [load]);

  return (
    <div className="p-4 flex flex-col gap-3">
      <button
        onClick={onBack}
        className="text-[10px] text-on-surface-variant/50 hover:text-on-surface transition-colors self-start"
      >
        ← Back to runs
      </button>

      <div className="text-[9px] font-mono text-on-surface-variant/30">
        {new Date(run.startedAt).toLocaleString()} · {run.channelId}
      </div>

      {loading && <div className="text-xs text-on-surface-variant/40">Loading...</div>}

      {!loading && messages.length === 0 && (
        <div className="text-xs text-on-surface-variant/40 animate-pulse">
          Waiting for response...
        </div>
      )}

      <div className="space-y-2">
        {messages.map((m) => (
          <div
            key={m.id}
            className={`rounded-md p-2.5 text-[11px] leading-relaxed whitespace-pre-wrap ${
              m.role === 'user'
                ? 'bg-[#1e1f26] text-on-surface-variant/70'
                : m.role === 'tool_call'
                ? 'bg-[#13141a] text-on-surface-variant/40 font-mono text-[10px]'
                : 'bg-[#1a2235] text-on-surface/90'
            }`}
          >
            {m.role === 'tool_call' && (
              <span className="text-blue-400/60 mr-1">⚙</span>
            )}
            {m.content}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Runs list view ─────────────────────────────────────────────────────────

function ScheduleRuns({
  agentId, schedule, onBack,
}: { agentId: string; schedule: Schedule; onBack: () => void }) {
  const [runs, setRuns] = useState<ScheduleRun[]>([]);
  const [selectedRun, setSelectedRun] = useState<ScheduleRun | null>(null);
  const [triggering, setTriggering] = useState(false);

  const loadRuns = useCallback(async () => {
    try {
      setRuns(await fetchScheduleRuns(agentId, schedule.id));
    } catch { /* ignore */ }
  }, [agentId, schedule.id]);

  useEffect(() => { void loadRuns(); }, [loadRuns]);

  async function handleTrigger() {
    setTriggering(true);
    try {
      await triggerScheduleApi(agentId, schedule.id);
      await loadRuns();
    } finally {
      setTriggering(false);
    }
  }

  if (selectedRun) {
    return (
      <RunMessages
        agentId={agentId}
        run={selectedRun}
        onBack={() => setSelectedRun(null)}
      />
    );
  }

  return (
    <div className="p-4 flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <button
          onClick={onBack}
          className="text-[10px] text-on-surface-variant/50 hover:text-on-surface transition-colors"
        >
          ←
        </button>
        <span className="text-xs text-on-surface font-medium flex-1 truncate">{schedule.name}</span>
        <button
          onClick={handleTrigger}
          disabled={triggering}
          className="text-[9px] px-2 py-0.5 rounded bg-[#33343b] text-on-surface-variant/60 hover:text-on-surface transition-colors disabled:opacity-40"
        >
          {triggering ? 'Starting...' : 'Run now'}
        </button>
      </div>

      <span className="text-[10px] uppercase tracking-[0.14em] text-on-surface-variant/40 font-medium">
        Run history
      </span>

      {runs.length === 0 && (
        <p className="text-[10px] text-on-surface-variant/30">
          No runs yet.
        </p>
      )}

      {runs.map((run) => (
        <button
          key={run.id}
          onClick={() => setSelectedRun(run)}
          className="text-left rounded-md bg-[#1e1f26] p-2.5 hover:bg-[#25262e] transition-colors"
        >
          <div className="text-[10px] text-on-surface/80">
            {new Date(run.startedAt).toLocaleString()}
          </div>
          <div className="text-[9px] font-mono text-on-surface-variant/30 mt-0.5">
            {run.channelId}
          </div>
        </button>
      ))}
    </div>
  );
}

// ── Main list ──────────────────────────────────────────────────────────────

export function ScheduleList({ agentId }: { agentId: string }) {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Schedule | null>(null);

  const load = () => {
    fetchSchedules(agentId).then(setSchedules).catch(console.error).finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [agentId]);

  useEffect(() => {
    const interval = setInterval(() => setSchedules(s => [...s]), 30_000);
    return () => clearInterval(interval);
  }, []);

  async function toggleStatus(s: Schedule) {
    const newStatus = s.status === 'active' ? 'paused' : 'active';
    await updateScheduleApi(agentId, s.id, { status: newStatus });
    load();
  }

  async function handleDelete(s: Schedule) {
    if (!confirm(`Delete schedule "${s.name}"?`)) return;
    await deleteScheduleApi(agentId, s.id);
    load();
  }

  if (selected) {
    return (
      <ScheduleRuns
        agentId={agentId}
        schedule={selected}
        onBack={() => setSelected(null)}
      />
    );
  }

  if (loading) {
    return <div className="text-on-surface-variant/40 text-xs p-6">Loading schedules...</div>;
  }

  if (schedules.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-6 gap-3">
        <span className="text-3xl opacity-30">⏰</span>
        <p className="text-on-surface-variant/50 text-xs">
          No schedules yet. Ask the agent to set up recurring tasks.
        </p>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-2">
      <div className="flex items-center justify-between mb-3">
        <span className="text-[11px] uppercase tracking-[0.14em] text-on-surface-variant/60 font-medium">
          Schedules
        </span>
        <span className="text-[9px] font-mono text-on-surface-variant/30">
          {schedules.filter(s => s.status === 'active').length} active
        </span>
      </div>

      {schedules.map((s) => (
        <div
          key={s.id}
          onClick={() => setSelected(s)}
          className="rounded-md bg-[#1e1f26] p-3 space-y-2 cursor-pointer hover:bg-[#25262e] transition-colors"
        >
          <div className="flex items-center gap-2">
            <span className={`h-1.5 w-1.5 rounded-full ${s.status === 'active' ? 'bg-green-500' : 'bg-yellow-500/50'}`} />
            <span className="text-xs text-on-surface font-medium flex-1 truncate">{s.name}</span>
            <span className="text-[9px] font-mono text-on-surface-variant/40">{s.id}</span>
          </div>

          <p className="text-[10px] text-on-surface-variant/50 font-mono leading-relaxed break-words" style={{ whiteSpace: 'pre-wrap' }}>
            {s.message}
          </p>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-on-surface-variant/40">
            <span title={s.cron}>{cronToHuman(s.cron)}</span>
            <span>{s.timezone}</span>
            <span title={s.nextRun ? new Date(s.nextRun).toISOString() : ''}>
              Next: {relativeTime(s.nextRun)}
            </span>
            {s.lastRun && (
              <span title={new Date(s.lastRun).toISOString()}>
                Last: {relativeTime(s.lastRun)}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 pt-1" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => toggleStatus(s)}
              className="text-[9px] px-2 py-0.5 rounded bg-[#33343b] text-on-surface-variant/60 hover:text-on-surface transition-colors"
            >
              {s.status === 'active' ? 'Pause' : 'Resume'}
            </button>
            <button
              onClick={() => handleDelete(s)}
              className="text-[9px] px-2 py-0.5 rounded bg-[#33343b] text-red-400/60 hover:text-red-400 transition-colors ml-auto"
            >
              Delete
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
