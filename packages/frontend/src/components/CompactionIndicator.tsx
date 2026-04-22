import { useT } from '../lib/i18n.tsx';

/**
 * CompactionIndicator
 *
 * Tool-call-ish status row inside an assistant message. Fires when the
 * backend emits compaction_start/compaction_end chunks around a pi
 * session.compact() call. Gives the user visible feedback that the
 * agent is doing real work (shrinking context) rather than hanging.
 *
 * Dual-purpose: this row is the ONLY UI affordance for compaction, AND
 * its chunks are what reset useAgentSocket's 90s stream timer — without
 * them a long compaction fires the generic "agent took too long" error
 * (the Hernan/Bluggie regression from 2026-04).
 */
export function CompactionIndicator({ active, completed }: { active?: boolean; completed?: number }) {
  const { t } = useT();
  if (!active && !completed) return null;
  const label = active
    ? t('chat.compactingContext')
    : completed && completed > 1
      ? `${completed}× ${t('chat.compactedContext')}`
      : t('chat.compactedContext');
  return (
    <div
      data-testid={active ? 'compaction-active' : 'compaction-done'}
      className="flex items-center gap-2 px-2 py-1 rounded w-full max-w-xl text-left"
    >
      {active ? (
        <span className="h-3 w-3 rounded-full border-2 border-primary/40 border-t-primary animate-spin flex-shrink-0" />
      ) : (
        <span className="text-[10px] text-primary/60 flex-shrink-0">🗜</span>
      )}
      <span className="font-mono text-[10px] text-on-surface-variant flex-1 truncate">
        {label}
      </span>
    </div>
  );
}
