import { useState, useEffect } from 'react';
import { inputCls, buttonPrimary, buttonGhost, buttonDanger } from '../../ui/primitives';
import type { NodeType } from '../../lib/api';

interface Props {
  nodeId: string;
  nodeType: NodeType;
  name: string;
  config: Record<string, unknown>;
  onUpdate: (data: { name?: string; config?: Record<string, unknown> }) => void;
  onDelete: () => void;
  onClose: () => void;
}

export function NodeConfigPanel({ nodeId, nodeType, name, config, onUpdate, onDelete, onClose }: Props) {
  const [localName, setLocalName] = useState(name);
  const [localConfig, setLocalConfig] = useState(config);

  useEffect(() => { setLocalName(name); setLocalConfig(config); }, [nodeId, name, config]);

  const handleSave = () => {
    onUpdate({ name: localName, config: localConfig });
  };

  const updateConfig = (key: string, value: unknown) => {
    setLocalConfig(prev => ({ ...prev, [key]: value }));
  };

  const typeLabels: Record<NodeType, string> = {
    trigger: 'Trigger',
    agent: 'Agent Executor',
    foreach: 'For Each',
    conditional: 'Conditional',
    merge: 'Merge',
    end: 'End',
  };

  return (
    <div className="absolute right-0 top-0 bottom-0 w-72 bg-surface-container-lowest border-l border-outline-variant/40 z-20 flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-outline-variant/30">
        <h4 className="text-sm font-semibold text-on-surface">{typeLabels[nodeType]}</h4>
        <button onClick={onClose} className="text-on-surface-variant hover:text-on-surface text-lg leading-none">&times;</button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-3">
        <div>
          <label className="block text-[10px] font-semibold uppercase tracking-widest text-on-surface-variant mb-1">Name</label>
          <input className={inputCls} value={localName} onChange={e => setLocalName(e.target.value)} />
        </div>

        {nodeType === 'agent' && (
          <>
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-widest text-on-surface-variant mb-1">Prompt</label>
              <textarea
                className={`${inputCls} font-mono text-xs min-h-[120px]`}
                value={(localConfig.prompt as string) ?? ''}
                onChange={e => updateConfig('prompt', e.target.value)}
                placeholder="Describe what the agent should do..."
              />
            </div>
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-widest text-on-surface-variant mb-1">Timeout (seconds)</label>
              <input
                type="number"
                className={inputCls}
                value={((localConfig.timeout_ms as number) ?? 300000) / 1000}
                onChange={e => updateConfig('timeout_ms', Number(e.target.value) * 1000)}
              />
            </div>
          </>
        )}

        {nodeType === 'foreach' && (
          <>
            <p className="text-xs text-on-surface-variant/60">
              Iterates over the array from the upstream node and runs the body subgraph once per item.
            </p>
            <details className="group">
              <summary className="text-[10px] font-semibold uppercase tracking-widest text-on-surface-variant/50 cursor-pointer select-none hover:text-on-surface-variant">
                Advanced
              </summary>
              <div className="mt-2">
                <label className="block text-[10px] font-semibold uppercase tracking-widest text-on-surface-variant mb-1">Expression</label>
                <input
                  className={`${inputCls} font-mono text-xs`}
                  value={(localConfig.expression as string) ?? 'input'}
                  onChange={e => updateConfig('expression', e.target.value || 'input')}
                  placeholder="input"
                />
                <p className="text-[10px] text-on-surface-variant/60 mt-1">
                  JS expression evaluated against upstream output. Defaults to <code className="bg-surface-container px-1 rounded">input</code> (the entire output). Use <code className="bg-surface-container px-1 rounded">input.items</code> to access a nested array.
                </p>
              </div>
            </details>
          </>
        )}

        {nodeType === 'conditional' && (
          <>
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-widest text-on-surface-variant mb-1">Prompt</label>
              <textarea
                className={`${inputCls} font-mono text-xs min-h-[100px]`}
                value={(localConfig.prompt as string) ?? ''}
                onChange={e => updateConfig('prompt', e.target.value)}
                placeholder="Evaluate whether... and route accordingly."
              />
            </div>
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-widest text-on-surface-variant mb-1">Route handles</label>
              <input
                className={`${inputCls} font-mono text-xs`}
                value={((localConfig.handles as string[]) ?? ['true', 'false']).join(', ')}
                onChange={e => updateConfig('handles', e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
              />
              <p className="text-[10px] text-on-surface-variant/60 mt-1">Comma-separated branch names.</p>
            </div>
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-widest text-on-surface-variant mb-1">Timeout (seconds)</label>
              <input
                type="number"
                className={inputCls}
                value={((localConfig.timeout_ms as number) ?? 120000) / 1000}
                onChange={e => updateConfig('timeout_ms', Number(e.target.value) * 1000)}
              />
            </div>
          </>
        )}

        {(nodeType === 'trigger' || nodeType === 'end' || nodeType === 'merge') && (
          <p className="text-xs text-on-surface-variant/60">
            {nodeType === 'trigger' && 'This node starts the workflow. It has no configuration.'}
            {nodeType === 'end' && 'This node marks the workflow as complete. The input becomes the final output.'}
            {nodeType === 'merge' && 'This node waits for all incoming edges, then combines their outputs.'}
          </p>
        )}

        <div className="text-[10px] text-on-surface-variant/40 font-mono mt-2">
          ID: {nodeId}
        </div>
      </div>

      <div className="px-4 py-3 border-t border-outline-variant/30 flex items-center gap-2">
        <button className={buttonPrimary + ' text-xs !py-1.5 !px-3'} onClick={handleSave}>Save</button>
        <button className={buttonGhost} onClick={onClose}>Cancel</button>
        <button className={buttonDanger + ' ml-auto'} onClick={onDelete}>Delete</button>
      </div>
    </div>
  );
}
