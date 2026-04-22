import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  fetchTasks,
  fetchTask,
  fetchColumns,
  createTaskApi,
  createColumnApi,
  updateTaskApi,
  deleteTaskApi,
  deleteColumnApi,
  clearTasksApi,
  addTaskComment,
  type Task,
  type TaskColumn,
  type TaskWithComments,
} from '../lib/api.ts';
import { TaskDetailPanel } from './TaskDetailPanel.tsx';
import { useT } from '../lib/i18n.tsx';

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

      {/* Tags */}
      {task.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-1.5">
          {task.tags.map((tag) => (
            <span
              key={tag}
              className="rounded-full bg-primary/10 px-1.5 py-[1px] text-[8px] font-mono text-primary/60"
            >
              {tag}
            </span>
          ))}
        </div>
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
  const [columns, setColumns] = useState<TaskColumn[]>([]);
  const [selectedTask, setSelectedTask] = useState<TaskWithComments | null>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [addingColumn, setAddingColumn] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [addingNewColumn, setAddingNewColumn] = useState(false);
  const [newColumnLabel, setNewColumnLabel] = useState('');

  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const tk of tasks) for (const tag of tk.tags) set.add(tag);
    return Array.from(set).sort();
  }, [tasks]);

  const filteredTasks = useMemo(() => {
    let result = tasks;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (tk) => tk.title.toLowerCase().includes(q) || tk.description.toLowerCase().includes(q),
      );
    }
    if (activeTag) {
      result = result.filter((tk) => tk.tags.includes(activeTag));
    }
    return result;
  }, [tasks, searchQuery, activeTag]);

  const loadTasks = useCallback(async () => {
    try {
      setTasks(await fetchTasks(agentId));
    } catch {
      // silently ignore polling errors
    }
  }, [agentId]);

  const loadColumns = useCallback(async () => {
    try {
      setColumns(await fetchColumns(agentId));
    } catch {
      // silently ignore
    }
  }, [agentId]);

  useEffect(() => {
    void loadTasks();
    void loadColumns();
    const id = setInterval(() => {
      void loadTasks();
    }, 4000);
    return () => clearInterval(id);
  }, [loadTasks, loadColumns]);

  const handleCardClick = useCallback(
    async (task: Task) => {
      try {
        const full = await fetchTask(agentId, task.id);
        setSelectedTask(full);
      } catch {
        setSelectedTask({ ...task, comments: [] });
      }
    },
    [agentId],
  );

  const handleDrop = useCallback(
    async (newStatus: string) => {
      if (!draggedId) return;
      const task = tasks.find((tk) => tk.id === draggedId);
      if (!task || task.status === newStatus) {
        setDraggedId(null);
        return;
      }
      try {
        const updated = await updateTaskApi(agentId, draggedId, { status: newStatus });
        setTasks((prev) => prev.map((tk) => (tk.id === draggedId ? updated : tk)));
        setSelectedTask((prev) =>
          prev && prev.id === draggedId ? { ...prev, ...updated } : prev,
        );
      } catch {
        // revert handled by next poll
      }
      setDraggedId(null);
    },
    [agentId, draggedId, tasks],
  );

  const handleCreateTask = useCallback(
    async (status: string, title: string, description: string) => {
      if (!title.trim()) return;
      try {
        const task = await createTaskApi(agentId, {
          title: title.trim(),
          description: description.trim() || undefined,
          status,
        });
        setTasks((prev) => [...prev, task]);
      } catch {
        // ignored
      }
      setAddingColumn(null);
      setNewTitle('');
      setNewDesc('');
    },
    [agentId],
  );

  const handleUpdate = useCallback(
    async (taskId: string, data: { title?: string; description?: string; status?: string; tags?: string[] }) => {
      const updated = await updateTaskApi(agentId, taskId, data);
      setTasks((prev) => prev.map((tk) => (tk.id === taskId ? updated : tk)));
      setSelectedTask((prev) =>
        prev && prev.id === taskId ? { ...prev, ...updated } : prev,
      );
    },
    [agentId],
  );

  const handleAddComment = useCallback(
    async (taskId: string, body: string) => {
      const comment = await addTaskComment(agentId, taskId, body);
      setSelectedTask((prev) =>
        prev && prev.id === taskId ? { ...prev, comments: [...prev.comments, comment] } : prev,
      );
    },
    [agentId],
  );

  const handleDelete = useCallback(
    async (taskId: string) => {
      await deleteTaskApi(agentId, taskId);
      setTasks((prev) => prev.filter((tk) => tk.id !== taskId));
      setSelectedTask(null);
    },
    [agentId],
  );

  const handleClearAll = useCallback(async () => {
    if (!confirm(t('tasks.clearConfirm'))) return;
    try {
      await clearTasksApi(agentId);
      setTasks([]);
      setSelectedTask(null);
    } catch {
      // ignored
    }
  }, [agentId, t]);

  const handleAddColumn = useCallback(async () => {
    if (!newColumnLabel.trim()) return;
    try {
      const col = await createColumnApi(agentId, newColumnLabel.trim());
      setColumns((prev) => [...prev, col]);
      setNewColumnLabel('');
      setAddingNewColumn(false);
    } catch {
      // ignored
    }
  }, [agentId, newColumnLabel]);

  const handleDeleteColumn = useCallback(
    async (columnId: string) => {
      if (!confirm(t('tasks.deleteColumnConfirm'))) return;
      try {
        await deleteColumnApi(agentId, columnId);
        setColumns((prev) => prev.filter((c) => c.id !== columnId));
        void loadTasks();
      } catch {
        // ignored
      }
    },
    [agentId, t, loadTasks],
  );

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Search + filter bar */}
      <div className="flex items-center gap-2 px-3 pt-3 pb-1 flex-shrink-0 flex-wrap">
        <input
          className="rounded bg-surface-container px-2.5 py-[6px] text-[11px] text-on-surface placeholder:text-on-surface-variant/60 outline-none focus:ring-1 focus:ring-primary/25 w-48 font-mono"
          placeholder={t('tasks.searchPlaceholder')}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        {allTags.length > 0 && (
          <div className="flex gap-1 flex-wrap">
            {allTags.map((tag) => (
              <button
                key={tag}
                onClick={() => setActiveTag(activeTag === tag ? null : tag)}
                className={`rounded-full px-2 py-[2px] text-[9px] font-mono transition-colors ${
                  activeTag === tag
                    ? 'bg-primary/25 text-primary'
                    : 'bg-surface-container text-on-surface-variant/60 hover:text-on-surface-variant'
                }`}
              >
                {tag}
              </button>
            ))}
          </div>
        )}
        <div className="flex-1" />
        <button
          onClick={handleClearAll}
          className="rounded bg-red-950/15 px-2.5 py-[5px] text-[9px] font-mono text-error/50 hover:bg-red-950/30 hover:text-error/70 transition-colors"
        >
          {t('tasks.clearAll')}
        </button>
      </div>

      {/* Columns */}
      <div className="flex flex-1 gap-2 overflow-x-auto p-3 relative">
        {columns.map((col) => {
          const colTasks = filteredTasks.filter((tk) => tk.status === col.id);
          return (
            <ColumnWrapper
              key={col.id}
              columnId={col.id}
              label={col.label}
              tasks={colTasks}
              canDelete={columns.length > 1}
              addingTask={addingColumn === col.id}
              newTitle={addingColumn === col.id ? newTitle : ''}
              newDesc={addingColumn === col.id ? newDesc : ''}
              onNewTitleChange={(v) => setNewTitle(v)}
              onNewDescChange={(v) => setNewDesc(v)}
              onStartAdding={() => {
                setAddingColumn(col.id);
                setNewTitle('');
                setNewDesc('');
              }}
              onCancelAdding={() => {
                setAddingColumn(null);
                setNewTitle('');
                setNewDesc('');
              }}
              onConfirmAdding={() => handleCreateTask(col.id, newTitle, newDesc)}
              onDragStart={(id) => setDraggedId(id)}
              onDrop={handleDrop}
              onCardClick={handleCardClick}
              onDeleteColumn={() => handleDeleteColumn(col.id)}
            />
          );
        })}

        {/* Add column */}
        {addingNewColumn ? (
          <div className="w-56 flex-shrink-0 flex flex-col gap-2 rounded-md p-3 bg-surface-container">
            <input
              autoFocus
              className="rounded bg-surface-container-high px-2.5 py-[7px] text-[11px] text-on-surface placeholder:text-on-surface-variant/60 outline-none focus:ring-1 focus:ring-primary/25 w-full"
              placeholder={t('tasks.columnLabelPlaceholder')}
              value={newColumnLabel}
              onChange={(e) => setNewColumnLabel(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleAddColumn();
                if (e.key === 'Escape') {
                  setAddingNewColumn(false);
                  setNewColumnLabel('');
                }
              }}
            />
            <div className="flex gap-1.5">
              <button
                disabled={!newColumnLabel.trim()}
                onClick={handleAddColumn}
                className="flex-1 rounded bg-primary/15 px-2 py-1 text-[10px] text-primary/70 hover:bg-primary/25 transition-colors disabled:opacity-30"
              >
                {t('tasks.add')}
              </button>
              <button
                onClick={() => {
                  setAddingNewColumn(false);
                  setNewColumnLabel('');
                }}
                className="rounded bg-surface-container-high px-2 py-1 text-[10px] text-on-surface-variant/70 hover:text-on-surface-variant transition-colors"
              >
                {t('tasks.cancel')}
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setAddingNewColumn(true)}
            className="w-10 flex-shrink-0 rounded-md flex items-center justify-center text-on-surface-variant/30 hover:text-on-surface-variant/60 hover:bg-surface-container transition-colors text-[16px]"
          >
            +
          </button>
        )}
      </div>

      {/* Detail panel */}
      {selectedTask && (
        <TaskDetailPanel
          task={selectedTask}
          columns={columns}
          onClose={() => setSelectedTask(null)}
          onUpdate={handleUpdate}
          onAddComment={handleAddComment}
          onDelete={handleDelete}
        />
      )}
    </div>
  );
}

// ── ColumnWrapper ─────────────────────────────────────────────────────────────

function ColumnWrapper({
  columnId,
  label,
  tasks,
  canDelete,
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
  onDeleteColumn,
}: {
  columnId: string;
  label: string;
  tasks: Task[];
  canDelete: boolean;
  addingTask: boolean;
  newTitle: string;
  newDesc: string;
  onNewTitleChange: (v: string) => void;
  onNewDescChange: (v: string) => void;
  onStartAdding: () => void;
  onCancelAdding: () => void;
  onConfirmAdding: () => void;
  onDragStart: (id: string) => void;
  onDrop: (status: string) => Promise<void>;
  onCardClick: (task: Task) => void;
  onDeleteColumn: () => void;
}) {
  const { t } = useT();
  const [isDragOver, setIsDragOver] = useState(false);

  return (
    <div
      className="w-56 flex-shrink-0 flex flex-col gap-0 rounded-md overflow-hidden bg-surface-container"
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragOver(true);
      }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={() => {
        setIsDragOver(false);
        void onDrop(columnId);
      }}
    >
      {/* Column header */}
      <div
        className="flex items-center justify-between px-3 py-2.5 flex-shrink-0"
        style={{
          borderBottom: isDragOver
            ? '1px solid rgba(160,120,255,0.25)'
            : '1px solid rgba(255,255,255,0.04)',
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
        <div className="flex items-center gap-0.5">
          <button
            onClick={onStartAdding}
            className="text-[12px] text-on-surface-variant/60 hover:text-primary/70 transition-colors leading-none w-5 h-5 flex items-center justify-center rounded hover:bg-primary/10"
          >
            +
          </button>
          {canDelete && (
            <button
              onClick={onDeleteColumn}
              className="text-[10px] text-on-surface-variant/30 hover:text-error/60 transition-colors leading-none w-5 h-5 flex items-center justify-center rounded hover:bg-red-950/20"
            >
              ×
            </button>
          )}
        </div>
      </div>

      {/* Cards area */}
      <div className="flex flex-col gap-1.5 p-2 overflow-y-auto flex-1">
        {tasks.map((tk) => (
          <TaskCard key={tk.id} task={tk} onDragStart={onDragStart} onClick={onCardClick} />
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
