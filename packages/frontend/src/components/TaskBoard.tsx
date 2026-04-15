import { useState, useEffect, useCallback } from 'react';
import {
  fetchTasks,
  fetchTask,
  createTaskApi,
  updateTaskApi,
  deleteTaskApi,
  addTaskComment,
  type Task,
  type TaskStatus,
  type TaskWithComments,
} from '../lib/api.ts';
import { TaskDetailPanel } from './TaskDetailPanel.tsx';
import { useT } from '../lib/i18n.tsx';

/* ═══════════════════════════════════════════════════════════════════════════
 *  TaskBoard
 *  ─────────
 *  Kanban board with 5 columns. Native HTML5 drag-and-drop. Inline task
 *  creation. Polls every 4 s. Clicking a card opens TaskDetailPanel.
 * ═══════════════════════════════════════════════════════════════════════════ */

const COLUMN_ORDER: { status: TaskStatus; labelKey: string }[] = [
  { status: 'backlog', labelKey: 'tasks.columns.backlog' },
  { status: 'in_progress', labelKey: 'tasks.columns.inProgress' },
  { status: 'scheduled', labelKey: 'tasks.columns.scheduled' },
  { status: 'to_review', labelKey: 'tasks.columns.toReview' },
  { status: 'done', labelKey: 'tasks.columns.done' },
];

function useRelativeTime() {
  const { t } = useT();
  return (unixSeconds: number): string => {
    const diffMs = Date.now() - unixSeconds * 1000;
    const diffSec = Math.floor(diffMs / 1000);
    if (diffSec < 60) return t('tasks.relativeNow');
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return t('tasks.relativeMinutes', { n: diffMin });
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return t('tasks.relativeHours', { n: diffHr });
    const diffDay = Math.floor(diffHr / 24);
    return t('tasks.relativeDays', { n: diffDay });
  };
}

function stripMarkdown(text: string): string {
  return text
    .replace(/#{1,6}\s/g, '')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    .replace(/`{1,3}[^`]*`{1,3}/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/^\s*[-*+]\s/gm, '')
    .replace(/^\s*\d+\.\s/gm, '')
    .replace(/\n+/g, ' ')
    .trim();
}

// ── Task card ────────────────────────────────────────────────────────────────

function TaskCard({
  task,
  onDragStart,
  onClick,
}: {
  task: Task;
  onDragStart: (id: string) => void;
  onClick: (task: Task) => void;
}) {
  const { t } = useT();
  const relativeTime = useRelativeTime();
  const preview = stripMarkdown(task.description).slice(0, 120);
  const showEditedBy = task.updatedBy !== null && task.updatedBy !== task.source;

  return (
    <div
      draggable
      onDragStart={() => onDragStart(task.id)}
      onClick={() => onClick(task)}
      className="rounded-md p-3 cursor-pointer transition-colors hover:brightness-110 select-none bg-surface-container-high"
    >
      {/* ID + source badge */}
      <div className="flex items-center justify-between mb-1.5 gap-1">
        <span className="font-mono text-[9px] text-primary/40 truncate">{task.id}</span>
        <span
          className={`flex-shrink-0 rounded-full px-1.5 py-[2px] text-[8px] font-semibold uppercase tracking-[0.08em] ${
            task.source === 'agent'
              ? 'bg-secondary-container text-on-primary'
              : 'bg-primary text-on-surface'
          }`}
        >
          {task.source}
        </span>
      </div>

      {/* Title */}
      <p className="text-[12px] font-semibold text-on-surface leading-tight mb-1">{task.title}</p>

      {/* Description preview */}
      {preview && (
        <p className="font-mono text-[10px] text-on-surface-variant leading-snug line-clamp-2 mb-2">
          {preview}
        </p>
      )}

      {/* Footer: time + edited-by */}
      <div className="flex items-center justify-between gap-1 mt-1">
        <span className="font-mono text-[9px] text-on-surface-variant/60">
          {relativeTime(task.createdAt)}
        </span>
        {showEditedBy && (
          <span className="font-mono text-[8px] text-warning/50 truncate">
            {t('tasks.editedBy', { name: task.updatedBy ?? '' })}
          </span>
        )}
      </div>
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

export function TaskBoard({ agentId }: { agentId: string }) {
  const { t } = useT();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedTask, setSelectedTask] = useState<TaskWithComments | null>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [addingColumn, setAddingColumn] = useState<TaskStatus | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [newDesc, setNewDesc] = useState('');

  const loadTasks = useCallback(async () => {
    try {
      const data = await fetchTasks(agentId);
      setTasks(data);
    } catch {
      // silently ignore polling errors
    }
  }, [agentId]);

  // Initial load + polling
  useEffect(() => {
    void loadTasks();
    const id = setInterval(() => { void loadTasks(); }, 4000);
    return () => clearInterval(id);
  }, [loadTasks]);

  // Open detail panel — fetch with comments
  const handleCardClick = useCallback(async (task: Task) => {
    try {
      const full = await fetchTask(agentId, task.id);
      setSelectedTask(full);
    } catch {
      // fall back to task without comments
      setSelectedTask({ ...task, comments: [] });
    }
  }, [agentId]);

  // Drag-and-drop
  const handleDrop = useCallback(async (newStatus: TaskStatus) => {
    if (!draggedId) return;
    const task = tasks.find((t) => t.id === draggedId);
    if (!task || task.status === newStatus) { setDraggedId(null); return; }
    try {
      const updated = await updateTaskApi(agentId, draggedId, { status: newStatus });
      setTasks((prev) => prev.map((t) => (t.id === draggedId ? updated : t)));
      // If the detail panel is showing this task, update it too
      setSelectedTask((prev) => prev && prev.id === draggedId ? { ...prev, ...updated } : prev);
    } catch {
      // revert handled by next poll
    }
    setDraggedId(null);
  }, [agentId, draggedId, tasks]);

  // Inline task creation (lifted from Column for agentId access)
  const handleCreateTask = useCallback(async (status: TaskStatus, title: string, description: string) => {
    if (!title.trim()) return;
    try {
      const task = await createTaskApi(agentId, { title: title.trim(), description: description.trim() || undefined, status });
      setTasks((prev) => [...prev, task]);
    } catch {
      // ignored
    }
    setAddingColumn(null);
    setNewTitle('');
    setNewDesc('');
  }, [agentId]);

  // Panel callbacks
  const handleUpdate = useCallback(async (taskId: string, data: { title?: string; description?: string; status?: TaskStatus }) => {
    const updated = await updateTaskApi(agentId, taskId, data);
    setTasks((prev) => prev.map((t) => (t.id === taskId ? updated : t)));
    setSelectedTask((prev) => prev && prev.id === taskId ? { ...prev, ...updated } : prev);
  }, [agentId]);

  const handleAddComment = useCallback(async (taskId: string, body: string) => {
    const comment = await addTaskComment(agentId, taskId, body);
    setSelectedTask((prev) =>
      prev && prev.id === taskId ? { ...prev, comments: [...prev.comments, comment] } : prev
    );
  }, [agentId]);

  const handleDelete = useCallback(async (taskId: string) => {
    await deleteTaskApi(agentId, taskId);
    setTasks((prev) => prev.filter((t) => t.id !== taskId));
    setSelectedTask(null);
  }, [agentId]);

  return (
    <div className="flex flex-1 gap-2 overflow-x-auto p-3 relative">
      {COLUMN_ORDER.map(({ status, labelKey }) => {
        const colTasks = tasks.filter((tk) => tk.status === status);
        return (
          <ColumnWrapper
            key={status}
            status={status}
            label={t(labelKey)}
            tasks={colTasks}
            addingTask={addingColumn === status}
            newTitle={addingColumn === status ? newTitle : ''}
            newDesc={addingColumn === status ? newDesc : ''}
            onNewTitleChange={(v) => setNewTitle(v)}
            onNewDescChange={(v) => setNewDesc(v)}
            onStartAdding={() => { setAddingColumn(status); setNewTitle(''); setNewDesc(''); }}
            onCancelAdding={() => { setAddingColumn(null); setNewTitle(''); setNewDesc(''); }}
            onConfirmAdding={() => handleCreateTask(status, newTitle, newDesc)}
            onDragStart={(id) => setDraggedId(id)}
            onDrop={handleDrop}
            onCardClick={handleCardClick}
          />
        );
      })}

      {/* Detail panel */}
      {selectedTask && (
        <TaskDetailPanel
          task={selectedTask}
          onClose={() => setSelectedTask(null)}
          onUpdate={handleUpdate}
          onAddComment={handleAddComment}
          onDelete={handleDelete}
        />
      )}
    </div>
  );
}

// ── ColumnWrapper ─ lifts inline-creation state to parent ────────────────────

function ColumnWrapper({
  status,
  label,
  tasks,
  addingTask,
  newTitle,
  newDesc,
  onNewTitleChange,
  onNewDescChange,
  onStartAdding,
  onCancelAdding,
  onConfirmAdding,
  onDragStart,
  onDrop,
  onCardClick,
}: {
  status: TaskStatus;
  label: string;
  tasks: Task[];
  addingTask: boolean;
  newTitle: string;
  newDesc: string;
  onNewTitleChange: (v: string) => void;
  onNewDescChange: (v: string) => void;
  onStartAdding: () => void;
  onCancelAdding: () => void;
  onConfirmAdding: () => void;
  onDragStart: (id: string) => void;
  onDrop: (status: TaskStatus) => Promise<void>;
  onCardClick: (task: Task) => void;
}) {
  const { t } = useT();
  const [isDragOver, setIsDragOver] = useState(false);

  return (
    <div
      className="w-56 flex-shrink-0 flex flex-col gap-0 rounded-md overflow-hidden bg-surface-container"
      onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={() => { setIsDragOver(false); void onDrop(status); }}
    >
      {/* Column header */}
      <div
        className="flex items-center justify-between px-3 py-2.5 flex-shrink-0"
        style={{
          borderBottom: isDragOver ? '1px solid rgba(160,120,255,0.25)' : '1px solid rgba(255,255,255,0.04)',
          background: isDragOver ? 'rgba(160,120,255,0.05)' : undefined,
          transition: 'background 0.15s, border-color 0.15s',
        }}
      >
        <div className="flex items-center gap-2">
          <span className="font-mono text-[9px] uppercase tracking-[0.15em] text-on-surface-variant">
            {label}
          </span>
          <span className="font-mono text-[9px] text-on-surface-variant/25 tabular-nums">
            {tasks.length}
          </span>
        </div>
        <button
          onClick={onStartAdding}
          className="text-[12px] text-on-surface-variant/60 hover:text-primary/70 transition-colors leading-none w-5 h-5 flex items-center justify-center rounded hover:bg-primary/10"
        >
          +
        </button>
      </div>

      {/* Cards area */}
      <div className="flex flex-col gap-1.5 p-2 overflow-y-auto flex-1">
        {tasks.map((t) => (
          <TaskCard key={t.id} task={t} onDragStart={onDragStart} onClick={onCardClick} />
        ))}

        {addingTask && (
          <div className="rounded-md p-2.5 flex flex-col gap-2 bg-surface-container-high">
            <input
              autoFocus
              className="rounded bg-surface-container px-2.5 py-[7px] text-[11px] text-on-surface placeholder:text-on-surface-variant/60 outline-none focus:ring-1 focus:ring-primary/25 w-full"
              placeholder={t('tasks.titlePlaceholder')}
              value={newTitle}
              onChange={(e) => onNewTitleChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') onCancelAdding();
              }}
            />
            <textarea
              className="rounded bg-surface-container px-2.5 py-[7px] text-[11px] text-on-surface placeholder:text-on-surface-variant/60 outline-none focus:ring-1 focus:ring-primary/25 w-full resize-y min-h-[48px] font-mono"
              placeholder={t('tasks.descPlaceholder')}
              value={newDesc}
              onChange={(e) => onNewDescChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') onCancelAdding();
              }}
              rows={2}
            />
            <div className="flex gap-1.5">
              <button
                disabled={!newTitle.trim()}
                onClick={onConfirmAdding}
                className="flex-1 rounded bg-primary/15 px-2 py-1 text-[10px] text-primary/70 hover:bg-primary/25 transition-colors disabled:opacity-30"
              >
                {t('tasks.add')}
              </button>
              <button
                onClick={onCancelAdding}
                className="rounded bg-surface-container px-2 py-1 text-[10px] text-on-surface-variant/70 hover:text-on-surface-variant/70 transition-colors"
              >
                {t('tasks.cancel')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
