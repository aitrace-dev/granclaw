import { useState } from 'react';
import { buttonPrimary, buttonGhost, inputCls } from '../ui/primitives';
import { useT } from '../lib/i18n.tsx';
import type { WorkflowStep, StepInput } from '../lib/api.ts';

interface Props {
  title: string;
  initial?: WorkflowStep;
  onSave: (data: StepInput) => Promise<void>;
  onCancel: () => void;
}

export function StepFormModal({ title, initial, onSave, onCancel }: Props) {
  const { t } = useT();
  const init = initial?.config as Record<string, unknown> | undefined;

  const [name, setName] = useState(initial?.name ?? '');
  const [prompt, setPrompt] = useState<string>((init?.prompt as string) ?? '');
  const [timeoutSeconds, setTimeoutSeconds] = useState<string>(
    init?.timeout_ms ? String((init.timeout_ms as number) / 1000) : '',
  );
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !prompt.trim() || saving) return;

    const timeout_ms = timeoutSeconds ? Math.round(Number(timeoutSeconds) * 1000) : undefined;
    const config = { prompt, timeout_ms };

    setSaving(true);
    try {
      await onSave({ name: name.trim(), config });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div
        className="fixed inset-0 z-40"
        style={{ background: 'rgba(0,0,0,0.4)' }}
        onClick={onCancel}
      />
      <form
        onSubmit={handleSubmit}
        className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none overflow-y-auto"
      >
        <div className="bg-surface-container-lowest border border-outline-variant/40 rounded-xl shadow-callout p-5 w-full max-w-2xl pointer-events-auto my-8">
          <h3 className="font-headline text-lg font-bold text-on-surface mb-4">{title}</h3>

          <div className="flex flex-col gap-3 mb-5">
            <div>
              <label className="font-label text-[11px] font-semibold uppercase tracking-widest text-on-surface-variant block mb-1">
                {t('workflows.stepNameLabel')}
              </label>
              <input
                autoFocus
                className={inputCls}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('workflows.stepNamePlaceholder')}
              />
            </div>

            <div>
              <label className="font-label text-[11px] font-semibold uppercase tracking-widest text-on-surface-variant block mb-1">
                {t('workflows.stepPromptLabel')}
              </label>
              <textarea
                rows={10}
                className={inputCls}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder={t('workflows.stepPromptPlaceholder')}
              />
            </div>

            <div>
              <label className="font-label text-[11px] font-semibold uppercase tracking-widest text-on-surface-variant block mb-1">
                {t('workflows.stepTimeoutLabel')}
              </label>
              <input
                className={inputCls}
                type="number"
                min={0}
                value={timeoutSeconds}
                onChange={(e) => setTimeoutSeconds(e.target.value)}
                placeholder="300"
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={onCancel} className={buttonGhost}>
              {t('workflows.cancel')}
            </button>
            <button type="submit" disabled={!name.trim() || !prompt.trim() || saving} className={buttonPrimary}>
              {saving ? t('workflows.saving') : t('workflows.save')}
            </button>
          </div>
        </div>
      </form>
    </>
  );
}
