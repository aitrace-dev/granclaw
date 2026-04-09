import { useState, useEffect } from 'react';
import { fetchSchedules, updateScheduleApi, deleteScheduleApi, triggerScheduleApi, type Schedule } from '../lib/api.ts';

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

export function ScheduleList({ agentId }: { agentId: string }) {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [loading, setLoading] = useState(true);

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

  async function handleTrigger(s: Schedule) {
    await triggerScheduleApi(agentId, s.id);
    load();
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

      {schedules.map(s => (
        <div
          key={s.id}
          className="rounded-md bg-[#1e1f26] p-3 space-y-2"
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

          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={() => toggleStatus(s)}
              className="text-[9px] px-2 py-0.5 rounded bg-[#33343b] text-on-surface-variant/60 hover:text-on-surface transition-colors"
            >
              {s.status === 'active' ? 'Pause' : 'Resume'}
            </button>
            <button
              onClick={() => handleTrigger(s)}
              className="text-[9px] px-2 py-0.5 rounded bg-[#33343b] text-on-surface-variant/60 hover:text-on-surface transition-colors"
            >
              Run now
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
