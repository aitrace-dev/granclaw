import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import type { TaskWithComments, TaskComment, TaskStatus } from '../lib/api.ts';

/* ═══════════════════════════════════════════════════════════════════════════
 *  TaskDetailPanel
 *  ───────────────
 *  Fixed slide-over from the right. Editable title, status dropdown,
 *  markdown description, flat comment list, add comment, delete.
 * ═══════════════════════════════════════════════════════════════════════════ */

const STATUS_OPTIONS: { value: TaskStatus; label: string }[] = [
  { value: 'backlog', label: 'Pendiente' },
  { value: 'in_progress', label: 'En progreso' },
  { value: 'scheduled', label: 'Programado' },
  { value: 'to_review', label: 'En revisión' },
  { value: 'done', label: 'Completado' },
];

function relativeTime(unixSeconds: number): string {
  const diffMs = Date.now() - unixSeconds * 1000;
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return 'ahora';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `hace ${diffMin}m`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `hace ${diffHr}h`;
  const diffDay = Math.floor(diffHr / 24);
  return `hace ${diffDay}d`;
}

const inputCls =
  'rounded bg-surface-container px-2.5 py-[7px] text-[11px] text-on-surface placeholder:text-on-surface-variant/60 outline-none focus:ring-1 focus:ring-primary/25 transition-shadow w-full';

function SourceBadge({ source }: { source: 'agent' | 'human' }) {
  return (
    <span
      className={`rounded-full px-1.5 py-[2px] text-[8px] font-semibold uppercase tracking-[0.08em] ${
        source === 'agent'
          ? 'bg-secondary-container text-on-primary'
          : 'bg-primary text-on-surface'
      }`}
    >
      {source}
    </span>
  );
}

function CommentItem({ comment }: { comment: TaskComment }) {
  return (
    <div className="flex flex-col gap-1 py-3" style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
      <div className="flex items-center gap-2">
        <SourceBadge source={comment.source} />
        <span className="font-mono text-[9px] text-on-surface-variant/60">
          {relativeTime(comment.createdAt)}
        </span>
      </div>
      <div className="text-[12px] text-on-surface/80 leading-relaxed prose prose-sm dark:prose-invert max-w-none">
        <ReactMarkdown>{comment.body}</ReactMarkdown>
      </div>
    </div>
  );
}

export function TaskDetailPanel({
  task,
  onClose,
  onUpdate,
  onAddComment,
  onDelete,
}: {
  task: TaskWithComments;
  onClose: () => void;
  onUpdate: (taskId: string, data: { title?: string; description?: string; status?: TaskStatus }) => Promise<void>;
  onAddComment: (taskId: string, body: string) => Promise<void>;
  onDelete: (taskId: string) => Promise<void>;
}) {
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(task.title);

  const [editingDesc, setEditingDesc] = useState(false);
  const [descDraft, setDescDraft] = useState(task.description);

  const [commentDraft, setCommentDraft] = useState('');
  const [submittingComment, setSubmittingComment] = useState(false);

  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Sync drafts when task prop changes (e.g. after update)
  const [lastTaskId, setLastTaskId] = useState(task.id);
  if (task.id !== lastTaskId) {
    setLastTaskId(task.id);
    setTitleDraft(task.title);
    setDescDraft(task.description);
    setEditingTitle(false);
    setEditingDesc(false);
    setCommentDraft('');
  }

  const commitTitle = async () => {
    setEditingTitle(false);
    if (titleDraft.trim() && titleDraft.trim() !== task.title) {
      setSaving(true);
      try { await onUpdate(task.id, { title: titleDraft.trim() }); } finally { setSaving(false); }
    } else {
      setTitleDraft(task.title);
    }
  };

  const commitDesc = async () => {
    setEditingDesc(false);
    if (descDraft !== task.description) {
      setSaving(true);
      try { await onUpdate(task.id, { description: descDraft }); } finally { setSaving(false); }
    }
  };

  const commitStatus = async (status: TaskStatus) => {
    setSaving(true);
    try { await onUpdate(task.id, { status }); } finally { setSaving(false); }
  };

  const submitComment = async () => {
    if (!commentDraft.trim()) return;
    setSubmittingComment(true);
    try {
      await onAddComment(task.id, commentDraft.trim());
      setCommentDraft('');
    } finally {
      setSubmittingComment(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm(`¿Eliminar tarea "${task.title}"? Esta acción no se puede deshacer.`)) return;
    setDeleting(true);
    try { await onDelete(task.id); } finally { setDeleting(false); }
  };

  const showEditedBy = task.updatedBy !== null && task.updatedBy !== task.source;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40"
        style={{ background: 'rgba(0,0,0,0.35)' }}
        onClick={onClose}
      />

      {/* Panel */}
      <div
        className="fixed inset-y-0 right-0 w-96 z-50 flex flex-col overflow-hidden bg-surface-container"
        style={{
          boxShadow: '-8px 0 40px rgba(0,0,0,0.5)',
        }}
      >
        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div
          className="flex items-center justify-between px-5 py-4 flex-shrink-0"
          style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}
        >
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-mono text-[10px] text-primary/40 flex-shrink-0">{task.id}</span>
            {saving && (
              <span className="font-mono text-[9px] text-on-surface-variant/60 animate-pulse">
                guardando…
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-on-surface-variant/70 hover:text-on-surface transition-colors text-[18px] leading-none flex-shrink-0"
            aria-label="Cerrar"
          >
            ×
          </button>
        </div>

        {/* ── Scrollable body ──────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto">
          <div className="px-5 py-4 flex flex-col gap-5">

            {/* Title */}
            <div>
              {editingTitle ? (
                <input
                  autoFocus
                  className={`${inputCls} text-[15px] font-semibold font-headline`}
                  value={titleDraft}
                  onChange={(e) => setTitleDraft(e.target.value)}
                  onBlur={commitTitle}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void commitTitle();
                    if (e.key === 'Escape') { setEditingTitle(false); setTitleDraft(task.title); }
                  }}
                />
              ) : (
                <h2
                  className="font-headline text-[17px] font-semibold text-on-surface tracking-[-0.01em] cursor-pointer hover:text-primary/90 transition-colors"
                  onClick={() => setEditingTitle(true)}
                  title="Click to edit"
                >
                  {task.title}
                </h2>
              )}
            </div>

            {/* Status dropdown */}
            <div className="flex flex-col gap-1.5">
              <p className="text-[8px] uppercase tracking-[0.18em] text-on-surface-variant/35 font-semibold">
                Estado
              </p>
              <select
                value={task.status}
                onChange={(e) => void commitStatus(e.target.value as TaskStatus)}
                className="rounded bg-surface-container px-2.5 py-[7px] text-[11px] text-on-surface outline-none focus:ring-1 focus:ring-primary/25 cursor-pointer font-mono transition-shadow"
              >
                {STATUS_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Meta badges */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1.5">
                <span className="text-[8px] uppercase tracking-[0.15em] text-on-surface-variant/60">
                  fuente
                </span>
                <SourceBadge source={task.source} />
              </div>
              {showEditedBy && task.updatedBy && (
                <div className="flex items-center gap-1.5">
                  <span className="text-[8px] uppercase tracking-[0.15em] text-on-surface-variant/60">
                    editado por
                  </span>
                  <SourceBadge source={task.updatedBy} />
                </div>
              )}
            </div>

            {/* Timestamps */}
            <div className="flex flex-col gap-1">
              <p className="font-mono text-[10px] text-on-surface-variant/60">
                <span className="text-on-surface-variant/20">creado</span>{' '}
                {relativeTime(task.createdAt)}
              </p>
              <p className="font-mono text-[10px] text-on-surface-variant/60">
                <span className="text-on-surface-variant/20">actualizado</span>{' '}
                {relativeTime(task.updatedAt)}
              </p>
            </div>

            {/* Description */}
            <div className="flex flex-col gap-1.5">
              <p className="text-[8px] uppercase tracking-[0.18em] text-on-surface-variant/35 font-semibold">
                Descripción
              </p>
              {editingDesc ? (
                <div className="flex flex-col gap-1.5">
                  <textarea
                    autoFocus
                    className={`${inputCls} min-h-[120px] resize-y font-mono text-[11px] leading-relaxed`}
                    value={descDraft}
                    onChange={(e) => setDescDraft(e.target.value)}
                    placeholder="Agregar una descripción…"
                  />
                  <div className="flex gap-1.5">
                    <button
                      onClick={commitDesc}
                      className="flex-1 rounded bg-primary/15 px-2 py-1.5 text-[10px] text-primary/70 hover:bg-primary/25 transition-colors"
                    >
                      Guardar
                    </button>
                    <button
                      onClick={() => { setEditingDesc(false); setDescDraft(task.description); }}
                      className="rounded bg-surface-container px-2 py-1.5 text-[10px] text-on-surface-variant/70 hover:text-on-surface-variant/70 transition-colors"
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              ) : (
                <div
                  className="cursor-pointer group"
                  onClick={() => setEditingDesc(true)}
                  title="Click to edit"
                >
                  {task.description ? (
                    <div className="text-[12px] text-on-surface/70 leading-relaxed prose prose-sm dark:prose-invert max-w-none group-hover:text-on-surface/90 transition-colors">
                      <ReactMarkdown>{task.description}</ReactMarkdown>
                    </div>
                  ) : (
                    <p className="font-mono text-[11px] text-on-surface-variant/25 italic group-hover:text-on-surface-variant/70 transition-colors">
                      Sin descripción — clic para agregar
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* Comments */}
            <div className="flex flex-col gap-0">
              <p className="text-[8px] uppercase tracking-[0.18em] text-on-surface-variant/35 font-semibold mb-1">
                Comentarios ({task.comments.length})
              </p>
              {task.comments.length === 0 && (
                <p className="font-mono text-[10px] text-on-surface-variant/25 italic py-2">
                  Sin comentarios aún
                </p>
              )}
              {task.comments.map((c) => (
                <CommentItem key={c.id} comment={c} />
              ))}
            </div>

            {/* Add comment */}
            <div className="flex flex-col gap-1.5">
              <p className="text-[8px] uppercase tracking-[0.18em] text-on-surface-variant/35 font-semibold">
                Agregar comentario
              </p>
              <textarea
                className={`${inputCls} min-h-[72px] resize-none font-mono text-[11px] leading-relaxed`}
                placeholder="Escribe un comentario… (markdown soportado)"
                value={commentDraft}
                onChange={(e) => setCommentDraft(e.target.value)}
              />
              <button
                disabled={!commentDraft.trim() || submittingComment}
                onClick={submitComment}
                className="self-end rounded bg-primary/15 px-3 py-1.5 text-[10px] text-primary/70 hover:bg-primary/25 transition-colors disabled:opacity-30"
              >
                {submittingComment ? 'Publicando…' : 'Publicar comentario'}
              </button>
            </div>

            {/* Danger zone */}
            <div className="mt-2 pt-4" style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
              <p className="text-[8px] uppercase tracking-[0.18em] text-error/30 font-semibold mb-2">
                Zona peligrosa
              </p>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="w-full rounded bg-red-950/15 px-3 py-2 text-left font-mono text-[11px] text-error/60 transition-all hover:bg-red-950/30 hover:text-error disabled:opacity-20"
              >
                {deleting ? 'eliminando…' : '[PELIGROSO] Eliminar tarea'}
              </button>
            </div>

            {/* Bottom breathing room */}
            <div className="h-4" />
          </div>
        </div>
      </div>
    </>
  );
}
