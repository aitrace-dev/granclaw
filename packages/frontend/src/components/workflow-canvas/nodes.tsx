import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';

const handleStyle = { width: 8, height: 8, background: '#555', border: '2px solid #1e1e1e' };

// ── Agent Node ───────────────────────────────────────────────────────

export const AgentNode = memo(({ data, selected }: NodeProps) => (
  <div className={`rounded-lg border ${selected ? 'border-primary shadow-md' : 'border-outline-variant/60'} bg-surface-container-lowest min-w-[180px] transition-all`}>
    <Handle type="target" position={Position.Top} style={handleStyle} />
    <div className="flex items-center gap-2 px-3 py-2 border-b border-outline-variant/30">
      <div className="w-6 h-6 rounded bg-primary/15 text-primary flex items-center justify-center text-xs font-bold">A</div>
      <span className="text-sm font-semibold text-on-surface truncate">{data.label as string}</span>
    </div>
    <div className="px-3 py-2 text-xs text-on-surface-variant line-clamp-2">
      {(data.prompt as string)?.slice(0, 80) || 'No prompt set'}
    </div>
    <Handle type="source" position={Position.Bottom} style={handleStyle} />
  </div>
));
AgentNode.displayName = 'AgentNode';

// ── ForEach Node ─────────────────────────────────────────────────────

export const ForEachNode = memo(({ data, selected }: NodeProps) => {
  const expr = (data.expression as string) || 'input';
  const isCustom = expr !== 'input';
  return (
    <div className={`rounded-lg border ${selected ? 'border-secondary shadow-md' : 'border-outline-variant/60'} bg-surface-container-lowest min-w-[180px] transition-all`}>
      <Handle type="target" position={Position.Top} style={handleStyle} />
      <div className={`flex items-center gap-2 px-3 py-2 ${isCustom ? 'border-b border-outline-variant/30' : ''}`}>
        <div className="w-6 h-6 rounded bg-secondary/15 text-secondary flex items-center justify-center text-xs font-bold">↺</div>
        <span className="text-sm font-semibold text-on-surface truncate">{data.label as string}</span>
      </div>
      {isCustom && (
        <div className="px-3 py-1.5 text-[10px] text-on-surface-variant/60 font-mono">
          {expr}
        </div>
      )}
      <Handle type="source" position={Position.Bottom} id="body" style={{ ...handleStyle, left: '30%' }} />
      <Handle type="source" position={Position.Bottom} id="done" style={{ ...handleStyle, left: '70%' }} />
      <div className="absolute -bottom-5 text-[9px] text-on-surface-variant/60" style={{ left: '22%' }}>body</div>
      <div className="absolute -bottom-5 text-[9px] text-on-surface-variant/60" style={{ left: '64%' }}>done</div>
    </div>
  );
});
ForEachNode.displayName = 'ForEachNode';

// ── Conditional Node ─────────────────────────────────────────────────

export const ConditionalNode = memo(({ data, selected }: NodeProps) => {
  const handles = (data.handles as string[]) ?? ['true', 'false'];
  return (
    <div className={`rounded-lg border ${selected ? 'border-warning shadow-md' : 'border-outline-variant/60'} bg-surface-container-lowest min-w-[180px] transition-all`}>
      <Handle type="target" position={Position.Top} style={handleStyle} />
      <div className="flex items-center gap-2 px-3 py-2 border-b border-outline-variant/30">
        <div className="w-6 h-6 rounded bg-warning/15 text-warning flex items-center justify-center text-xs font-bold">?</div>
        <span className="text-sm font-semibold text-on-surface truncate">{data.label as string}</span>
      </div>
      <div className="px-3 py-2 text-xs text-on-surface-variant line-clamp-2">
        {(data.prompt as string)?.slice(0, 60) || 'Agent decides'}
      </div>
      {handles.map((h, i) => (
        <Handle
          key={h}
          type="source"
          position={Position.Bottom}
          id={h}
          style={{ ...handleStyle, left: `${((i + 1) / (handles.length + 1)) * 100}%` }}
        />
      ))}
      <div className="flex justify-around px-2 -mb-4">
        {handles.map(h => (
          <span key={h} className="text-[9px] text-on-surface-variant/60 relative top-1">{h}</span>
        ))}
      </div>
    </div>
  );
});
ConditionalNode.displayName = 'ConditionalNode';

// ── Merge Node ───────────────────────────────────────────────────────

export const MergeNode = memo(({ data, selected }: NodeProps) => (
  <div className={`rounded-lg border ${selected ? 'border-success shadow-md' : 'border-outline-variant/60'} bg-surface-container-lowest min-w-[140px] transition-all`}>
    <Handle type="target" position={Position.Top} style={handleStyle} />
    <div className="flex items-center gap-2 px-3 py-2.5">
      <div className="w-6 h-6 rounded bg-success/15 text-success flex items-center justify-center text-xs font-bold">⇥</div>
      <span className="text-sm font-semibold text-on-surface truncate">{data.label as string}</span>
    </div>
    <Handle type="source" position={Position.Bottom} style={handleStyle} />
  </div>
));
MergeNode.displayName = 'MergeNode';

// ── Trigger Node ─────────────────────────────────────────────────────

export const TriggerNode = memo(({ data, selected }: NodeProps) => (
  <div className={`rounded-lg border ${selected ? 'border-error shadow-md' : 'border-outline-variant/60'} bg-surface-container-lowest min-w-[140px] transition-all`}>
    <div className="flex items-center gap-2 px-3 py-2.5">
      <div className="w-6 h-6 rounded bg-error/15 text-error flex items-center justify-center text-xs font-bold">▶</div>
      <span className="text-sm font-semibold text-on-surface truncate">{data.label as string}</span>
    </div>
    <Handle type="source" position={Position.Bottom} style={handleStyle} />
  </div>
));
TriggerNode.displayName = 'TriggerNode';

// ── End Node ─────────────────────────────────────────────────────────

export const EndNode = memo(({ data, selected }: NodeProps) => (
  <div className={`rounded-lg border ${selected ? 'border-outline shadow-md' : 'border-outline-variant/60'} bg-surface-container-lowest min-w-[140px] transition-all`}>
    <Handle type="target" position={Position.Top} style={handleStyle} />
    <div className="flex items-center gap-2 px-3 py-2.5">
      <div className="w-6 h-6 rounded bg-surface-container text-on-surface-variant flex items-center justify-center text-xs font-bold">■</div>
      <span className="text-sm font-semibold text-on-surface truncate">{data.label as string}</span>
    </div>
  </div>
));
EndNode.displayName = 'EndNode';

// ── Node type registry ───────────────────────────────────────────────

export const nodeTypes = {
  agent: AgentNode,
  foreach: ForEachNode,
  conditional: ConditionalNode,
  merge: MergeNode,
  trigger: TriggerNode,
  end: EndNode,
};
