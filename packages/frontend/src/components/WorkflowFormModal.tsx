import { useState } from 'react';
import { buttonPrimary, buttonGhost, inputCls } from '../ui/primitives';
import { useT } from '../lib/i18n.tsx';
import type { WorkflowStatus } from '../lib/api.ts';

interface Props {
  title: string;
  initial?: { name: string; description: string; status?: WorkflowStatus };
  allowStatus?: boolean;
  onSave: (data: { name: string; description: string; status?: WorkflowStatus }) => Promise<void>;
  onCancel: () => void;
}

export function WorkflowFormModal({ title, initial, allowStatus, onSave, onCancel }: Props) {
  const { t } = useT();
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [status, setStatus] = useState<WorkflowStatus>(initial?.status ?? 'active');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || saving) return;
    setSaving(true);
    try {
      await onSave({ name: name.trim(), description: description.trim(), status: allowStatus ? status : undefined });
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
        className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none"
      >
        <div className="bg-surface-container-lowest border border-outline-variant/40 rounded-xl shadow-callout p-5 w-full max-w-md pointer-events-auto">
          <h3 className="font-headline text-lg font-bold text-on-surface mb-4">{title}</h3>

          <div className="flex flex-col gap-3 mb-5">
            <div>
              <label className="font-label text-[11px] font-semibold uppercase tracking-widest text-on-surface-variant block mb-1">
                {t('workflows.formName')}
              </label>
              <input
                autoFocus
                className={inputCls}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('workflows.formNamePlaceholder')}
              />
            </div>

            <div>
              <label className="font-label text-[11px] font-semibold uppercase tracking-widest text-on-surface-variant block mb-1">
                {t('workflows.formDescription')}
              </label>
              <textarea
                rows={3}
                className={inputCls}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t('workflows.formDescriptionPlaceholder')}
              />
            </div>

            {allowStatus && (
              <div>
                <label className="font-label text-[11px] font-semibold uppercase tracking-widest text-on-surface-variant block mb-1">
                  {t('workflows.formStatus')}
                </label>
                <select
                  className={inputCls}
                  value={status}
                  onChange={(e) => setStatus(e.target.value as WorkflowStatus)}
                >
                  <option value="active">active</option>
                  <option value="paused">paused</option>
                  <option value="archived">archived</option>
                </select>
              </div>
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
