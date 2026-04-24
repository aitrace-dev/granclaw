import { useState, useCallback, useEffect, useRef } from 'react';
import {
  ReactFlow,
  addEdge,
  useNodesState,
  useEdgesState,
  Controls,
  MiniMap,
  Background,
  BackgroundVariant,
  type Connection,
  type Edge,
  type Node,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { nodeTypes } from './nodes';
import { NodeConfigPanel } from './NodeConfigPanel';
import {
  fetchWorkflowGraph,
  saveWorkflowGraph as saveGraphApi,
  type WorkflowNode,
  type WorkflowEdge,
  type NodeType,
} from '../../lib/api';
import { buttonGhost } from '../../ui/primitives';

interface Props {
  agentId: string;
  workflowId: string;
}

const PALETTE_ITEMS: { type: NodeType; label: string; icon: string; color: string }[] = [
  { type: 'trigger', label: 'Trigger',     icon: '▶', color: 'bg-error/15 text-error' },
  { type: 'agent',   label: 'Agent',       icon: 'A', color: 'bg-primary/15 text-primary' },
  { type: 'foreach', label: 'For Each',    icon: '↺', color: 'bg-secondary/15 text-secondary' },
  { type: 'conditional', label: 'Conditional', icon: '?', color: 'bg-warning/15 text-warning' },
  { type: 'merge',   label: 'Merge',       icon: '⇥', color: 'bg-success/15 text-success' },
  { type: 'end',     label: 'End',         icon: '■', color: 'bg-surface-container text-on-surface-variant' },
];

function toReactFlowNode(n: WorkflowNode): Node {
  return {
    id: n.id,
    type: n.nodeType,
    position: { x: n.positionX, y: n.positionY },
    data: {
      label: n.name,
      prompt: n.config.prompt,
      expression: n.config.expression,
      handles: n.config.handles,
      ...n.config,
      _nodeType: n.nodeType,
    },
  };
}

function toReactFlowEdge(e: WorkflowEdge): Edge {
  return {
    id: e.id,
    source: e.sourceId,
    target: e.targetId,
    sourceHandle: e.sourceHandle === 'default' ? undefined : e.sourceHandle,
    type: 'smoothstep',
    animated: false,
    style: { stroke: '#555', strokeWidth: 1.5 },
  };
}

function fromReactFlowNodes(nodes: Node[]): Omit<WorkflowNode, 'workflowId'>[] {
  return nodes.map(n => ({
    id: n.id,
    nodeType: (n.type ?? 'agent') as NodeType,
    name: (n.data.label as string) ?? 'Untitled',
    config: extractConfig(n),
    positionX: n.position.x,
    positionY: n.position.y,
  }));
}

function extractConfig(n: Node): Record<string, unknown> {
  const { label, _nodeType, ...rest } = n.data as Record<string, unknown>;
  return rest;
}

function fromReactFlowEdges(edges: Edge[]): Omit<WorkflowEdge, 'workflowId'>[] {
  return edges.map(e => ({
    id: e.id,
    sourceId: e.source,
    targetId: e.target,
    sourceHandle: e.sourceHandle ?? 'default',
    condition: null,
  }));
}

let nodeIdCounter = 0;

export function WorkflowCanvas({ agentId, workflowId }: Props) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const loaded = useRef(false);

  // Load graph
  useEffect(() => {
    fetchWorkflowGraph(agentId, workflowId).then(graph => {
      if (graph.nodes.length > 0) {
        setNodes(graph.nodes.map(toReactFlowNode));
        setEdges(graph.edges.map(toReactFlowEdge));
      } else {
        // Empty graph — seed with trigger + end
        const triggerId = crypto.randomUUID();
        const endId = crypto.randomUUID();
        setNodes([
          { id: triggerId, type: 'trigger', position: { x: 300, y: 50 }, data: { label: 'Start', _nodeType: 'trigger' } },
          { id: endId, type: 'end', position: { x: 300, y: 300 }, data: { label: 'End', _nodeType: 'end' } },
        ]);
        setEdges([
          { id: crypto.randomUUID(), source: triggerId, target: endId, type: 'smoothstep', style: { stroke: '#555', strokeWidth: 1.5 } },
        ]);
        setDirty(true);
      }
      loaded.current = true;
    });
  }, [agentId, workflowId]);

  const onConnect = useCallback((connection: Connection) => {
    setEdges(eds => addEdge({ ...connection, type: 'smoothstep', style: { stroke: '#555', strokeWidth: 1.5 } }, eds));
    setDirty(true);
  }, []);

  const handleNodesChange: typeof onNodesChange = useCallback((changes) => {
    onNodesChange(changes);
    if (loaded.current) setDirty(true);
  }, [onNodesChange]);

  const handleEdgesChange: typeof onEdgesChange = useCallback((changes) => {
    onEdgesChange(changes);
    if (loaded.current) setDirty(true);
  }, [onEdgesChange]);

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    setSelectedNode(node);
  }, []);

  const onPaneClick = useCallback(() => {
    setSelectedNode(null);
  }, []);

  // Add node from palette
  const addNodeFromPalette = useCallback((type: NodeType) => {
    const id = crypto.randomUUID();
    const defaultNames: Record<NodeType, string> = {
      trigger: 'Start',
      agent: 'Agent Step',
      foreach: 'For Each',
      conditional: 'Condition',
      merge: 'Merge',
      end: 'End',
    };
    const defaultConfigs: Record<NodeType, Record<string, unknown>> = {
      trigger: {},
      agent: { prompt: '', timeout_ms: 300000 },
      foreach: { expression: 'input' },
      conditional: { prompt: '', handles: ['true', 'false'], timeout_ms: 120000 },
      merge: {},
      end: {},
    };
    const newNode: Node = {
      id,
      type,
      position: { x: 200 + (nodeIdCounter++ * 30) % 200, y: 150 + (nodeIdCounter * 20) % 300 },
      data: { label: defaultNames[type], _nodeType: type, ...defaultConfigs[type] },
    };
    setNodes(nds => [...nds, newNode]);
    setDirty(true);
    setSelectedNode(newNode);
  }, []);

  // Save graph
  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const graphNodes = fromReactFlowNodes(nodes);
      const graphEdges = fromReactFlowEdges(edges);
      await saveGraphApi(agentId, workflowId, { nodes: graphNodes, edges: graphEdges });
      setDirty(false);
    } catch (err) {
      console.error('Failed to save graph:', err);
      alert(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }, [agentId, workflowId, nodes, edges]);

  // Update node from config panel
  const handleUpdateNode = useCallback((data: { name?: string; config?: Record<string, unknown> }) => {
    if (!selectedNode) return;
    setNodes(nds => nds.map(n => {
      if (n.id !== selectedNode.id) return n;
      const updated = { ...n, data: { ...n.data } };
      if (data.name) updated.data.label = data.name;
      if (data.config) {
        Object.assign(updated.data, data.config);
      }
      return updated;
    }));
    setDirty(true);
  }, [selectedNode]);

  // Delete node
  const handleDeleteNode = useCallback(() => {
    if (!selectedNode) return;
    setNodes(nds => nds.filter(n => n.id !== selectedNode.id));
    setEdges(eds => eds.filter(e => e.source !== selectedNode.id && e.target !== selectedNode.id));
    setSelectedNode(null);
    setDirty(true);
  }, [selectedNode]);

  return (
    <div className="relative h-full flex flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-outline-variant/30 bg-surface-container-lowest z-10">
        <span className="text-xs text-on-surface-variant mr-auto">
          {nodes.length} nodes · {edges.length} edges
          {dirty && <span className="text-warning ml-2">• unsaved</span>}
        </span>
        <button
          className={buttonGhost + ' !text-[10px]'}
          onClick={handleSave}
          disabled={saving || !dirty}
        >
          {saving ? 'Saving...' : 'Save Graph'}
        </button>
      </div>

      <div className="flex-1 relative">
        {/* Node palette */}
        <div className="absolute left-3 top-3 z-10 bg-surface-container-lowest border border-outline-variant/40 rounded-lg p-1.5 flex flex-col gap-0.5 shadow-sm">
          {PALETTE_ITEMS.map(item => (
            <button
              key={item.type}
              onClick={() => addNodeFromPalette(item.type)}
              className="flex items-center gap-2 px-2.5 py-1.5 rounded text-xs text-on-surface-variant hover:bg-surface-container hover:text-on-surface transition-colors"
            >
              <span className={`w-5 h-5 rounded flex items-center justify-center text-[10px] font-bold ${item.color}`}>{item.icon}</span>
              {item.label}
            </button>
          ))}
        </div>

        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={handleNodesChange}
          onEdgesChange={handleEdgesChange}
          onConnect={onConnect}
          onNodeClick={onNodeClick}
          onPaneClick={onPaneClick}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          deleteKeyCode="Delete"
          className="bg-surface-container"
        >
          <Controls className="!bg-surface-container-lowest !border-outline-variant/40 !shadow-sm" />
          <MiniMap
            className="!bg-surface-container-lowest !border-outline-variant/40"
            nodeStrokeWidth={3}
            zoomable
            pannable
          />
          <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#333" />
        </ReactFlow>

        {/* Config panel */}
        {selectedNode && (
          <NodeConfigPanel
            nodeId={selectedNode.id}
            nodeType={(selectedNode.data._nodeType as NodeType) ?? (selectedNode.type as NodeType) ?? 'agent'}
            name={(selectedNode.data.label as string) ?? ''}
            config={extractConfig(selectedNode)}
            onUpdate={handleUpdateNode}
            onDelete={handleDeleteNode}
            onClose={() => setSelectedNode(null)}
          />
        )}
      </div>
    </div>
  );
}
