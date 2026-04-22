import { useState } from 'react';
import { buttonPrimary, buttonGhost, inputCls, inputMono } from '../ui/primitives';
import { useT } from '../lib/i18n.tsx';
import type { StepType, CodeConfig, LlmConfig, WorkflowStep, StepInput } from '../lib/api.ts';

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
  const [type, setType] = useState<StepType>(initial?.type ?? 'agent');
  const [script, setScript] = useState<string>((init?.script as string) ?? '');
  const [shell, setShell] = useState<string>((init?.shell as string) ?? 'bash');
  const [prompt, setPrompt] = useState<string>((init?.prompt as string) ?? '');
  const [model, setModel] = useState<string>((init?.model as string) ?? '');
  const [timeoutSeconds, setTimeoutSeconds] = useState<string>(
    init?.timeout_ms ? String((init.timeout_ms as number) / 1000) : '',
  );
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || saving) return;

    let config: CodeConfig | LlmConfig;
    const timeout_ms = timeoutSeconds ? Math.round(Number(timeoutSeconds) * 1000) : undefined;

    if (type === 'code') {
      if (!script.trim()) return;
      config = { script, shell: shell || undefined, timeout_ms };
    } else {
      if (!prompt.trim()) return;
      config = { prompt, model: model || undefined };
    }

    setSaving(true);
    try {
      await onSave({ name: name.trim(), type, config });
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
            <div className="grid grid-cols-1 sm:grid-cols-[1fr,180px] gap-3">
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
                  {t('workflows.stepTypeLabel')}
                </label>
                <select
                  className={inputCls}
                  value={type}
                  onChange={(e) => setType(e.target.value as StepType)}
                >
                  <option value="agent">agent</option>
                  <option value="llm">llm</option>
                  <option value="code">code</option>
                </select>
              </div>
            </div>

            {type === 'code' ? (
              <>
                <div>
                  <label className="font-label text-[11px] font-semibold uppercase tracking-widest text-on-surface-variant block mb-1">
                    {t('workflows.stepScriptLabel')}
                  </label>
                  <textarea
                    rows={8}
                    className={inputMono}
                    value={script}
                    onChange={(e) => setScript(e.target.value)}
                    placeholder={t('workflows.stepScriptPlaceholder')}
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="font-label text-[11px] font-semibold uppercase tracking-widest text-on-surface-variant block mb-1">
                      {t('workflows.stepShellLabel')}
                    </label>
                    <input
                      className={inputCls}
                      value={shell}
                      onChange={(e) => setShell(e.target.value)}
                      placeholder="bash"
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
                      placeholder="30"
                    />
                  </div>
                </div>
              </>
            ) : (
              <>
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
                    {t('workflows.stepModelLabel')}
                  </label>
                  <input
                    className={inputCls}
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    placeholder={t('workflows.stepModelPlaceholder')}
                  />
                </div>
              </>
            )}
          </div>

          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={onCancel} className={buttonGhost}>
              {t('workflows.cancel')}
            </button>
            <button type="submit" disabled={!name.trim() || saving} className={buttonPrimary}>
              {saving ? t('workflows.saving') : t('workflows.save')}
            </button>
          </div>
        </div>
      </form>
    </>
  );
}
