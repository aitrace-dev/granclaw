import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import { fetchAgent, fetchMessages, resetAgent, fetchSecrets, type Agent } from '../lib/api.ts';
import { AgentSettingsPanel } from '../components/AgentSettingsPanel.tsx';
import { WorkspaceExplorer } from '../components/WorkspaceExplorer.tsx';
import { TaskBoard } from '../components/TaskBoard.tsx';
import { BrowserView } from '../components/BrowserView.tsx';
import { useAgentSocket } from '../hooks/useAgentSocket.ts';
import { WorkflowList } from '../components/WorkflowList.tsx';
import { ScheduleList } from '../components/ScheduleList.tsx';
import { MonitorView } from '../components/MonitorView.tsx';
import { UsageView } from '../components/UsageView.tsx';
import { LogsView } from '../components/LogsView.tsx';

type MainView = 'chat' | 'files' | 'tasks' | 'browser' | 'workflows' | 'schedules' | 'monitor' | 'usage' | 'logs';

const VALID_VIEWS: MainView[] = ['chat', 'files', 'tasks', 'browser', 'workflows', 'schedules', 'monitor', 'usage', 'logs'];

// ── Types ─────────────────────────────────────────────────────────────────

type MessageRole = 'user' | 'agent';

interface ChatMessage {
  id: string;
  role: MessageRole;
  text: string;
  isStreaming?: boolean;
  toolCalls?: string[];
}

// ── Shield icon ───────────────────────────────────────────────────────────

function ShieldIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2L3 7v5c0 5.25 3.75 10.15 9 11.25C17.25 22.15 21 17.25 21 12V7L12 2z" />
    </svg>
  );
}

// ── Tool calls block (ChatGPT-style collapsible) ─────────────────────────

function ToolCallsBlock({ toolCalls, isStreaming }: { toolCalls: string[]; isStreaming?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const count = toolCalls.length;

  // Extract just the tool name from "ToolName({...})"
  const formatTool = (tc: string) => {
    const match = tc.match(/^([^(]+)/);
    return match ? match[1] : tc;
  };

  // Latest tool for the collapsed summary
  const latestTool = formatTool(toolCalls[count - 1] ?? '');

  return (
    <div className="w-full max-w-xl">
      <button
        onClick={() => setExpanded(e => !e)}
        className="flex items-center gap-2 px-2 py-1 rounded hover:bg-surface-lowest/50 transition-colors w-full text-left"
      >
        {isStreaming ? (
          <span className="h-3 w-3 rounded-full border-2 border-primary/40 border-t-primary animate-spin flex-shrink-0" />
        ) : (
          <span className="text-[10px] text-primary/60 flex-shrink-0">⚙</span>
        )}
        <span className="font-mono text-[10px] text-on-surface-variant/50 flex-1 truncate">
          {isStreaming ? `Running ${latestTool}…` : `${count} tool call${count !== 1 ? 's' : ''}`}
        </span>
        <svg
          className="w-2.5 h-2.5 text-on-surface-variant/30 transition-transform duration-150 flex-shrink-0"
          style={{ transform: expanded ? 'rotate(90deg)' : 'none' }}
          viewBox="0 0 16 16"
          fill="currentColor"
        >
          <path d="M6 3l5 5-5 5V3z" />
        </svg>
      </button>

      {expanded && (
        <div
          className="mt-1 rounded bg-surface-lowest/50 overflow-y-auto scrollbar-thin"
          style={{ maxHeight: '10rem' }}
        >
          {toolCalls.map((tc, i) => (
            <div
              key={i}
              className="font-mono text-[9px] text-on-surface-variant/40 px-2.5 py-1 border-b border-white/[0.03] last:border-0 truncate hover:text-on-surface-variant/60 transition-colors"
              title={tc}
            >
              <span className="text-primary/50">{formatTool(tc)}</span>
              <span className="text-on-surface-variant/20 ml-1">
                {tc.slice(formatTool(tc).length)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────

export function ChatPage() {
  const { id: agentId = '', view: viewParam } = useParams<{ id: string; view: string }>();
  const navigate = useNavigate();
  const mainView: MainView = viewParam && VALID_VIEWS.includes(viewParam as MainView) ? (viewParam as MainView) : 'chat';
  const setMainView = (view: MainView) => {
    if (view === 'chat') navigate(`/agents/${agentId}/chat`, { replace: true });
    else navigate(`/agents/${agentId}/view/${view}`, { replace: true });
  };

  const [agent, setAgent] = useState<Agent | null>(null);
  const [agentDisplayName, setAgentDisplayName] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isWiping, setIsWiping] = useState(false);
  const [pendingApproval, setPendingApproval] = useState<{ reason: string } | null>(null);

  // Secrets + env state (managed by AgentSettingsPanel)
  const [secretNames, setSecretNames] = useState<string[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Big Brother state
  const [bbPanelOpen, setBbPanelOpen] = useState(true);
  const [bbMessages, setBbMessages] = useState<ChatMessage[]>([]);
  const [bbInput, setBbInput] = useState('');
  const [isBbSending, setIsBbSending] = useState(false);
  const [bbGuardianName, setBbGuardianName] = useState<string | null>(null);
  const [bbGuardrailsActive, setBbGuardrailsActive] = useState(false);
  const bbBottomRef = useRef<HTMLDivElement>(null);

  // Clear stale streaming state when WS reconnects after a drop
  const handleReconnect = useCallback(() => {
    setMessages(prev => prev.map(m => m.isStreaming ? { ...m, isStreaming: false, text: m.text || '(connection lost)' } : m));
    setIsSending(false);
    setPendingApproval(null);
  }, []);

  const { sendMessage, stopMessage, connected } = useAgentSocket(agent?.wsPort, undefined, handleReconnect);

  function handleStop() {
    stopMessage();
    setMessages(prev => prev.map(m => m.isStreaming ? { ...m, isStreaming: false, text: m.text + '\n\n*(stopped)*' } : m));
    setIsSending(false);
  }
  // Track whether we're in the middle of a user-initiated BB send
  const bbSendingRef = useRef(false);
  bbSendingRef.current = isBbSending;

  // Server-initiated BB messages (e.g. approval questions from guardian)
  const bbServerMsgRef = useRef<string | null>(null);
  const handleBbServerMessage = useCallback((chunk: import('../hooks/useAgentSocket.ts').StreamChunk) => {
    if (bbSendingRef.current) return; // user send handler takes priority
    if (chunk.type === 'text') {
      if (!bbServerMsgRef.current) {
        const id = crypto.randomUUID();
        bbServerMsgRef.current = id;
        setBbMessages((prev) => [...prev, { id, role: 'agent', text: chunk.text, isStreaming: true }]);
      } else {
        const msgId = bbServerMsgRef.current;
        setBbMessages((prev) => prev.map((m) => m.id === msgId ? { ...m, text: m.text + chunk.text } : m));
      }
    } else if (chunk.type === 'done') {
      if (bbServerMsgRef.current) {
        const msgId = bbServerMsgRef.current;
        setBbMessages((prev) => prev.map((m) => m.id === msgId ? { ...m, isStreaming: false } : m));
        bbServerMsgRef.current = null;
      }
    }
  }, []);

  const { sendMessage: sendBbMessage, connected: bbConnected } = useAgentSocket(
    agent?.bbPort ?? undefined,
    handleBbServerMessage
  );

  // Poll agent state every 30s so sidebar reflects live changes
  useEffect(() => {
    if (!agentId) return;
    const poll = setInterval(() => {
      fetchAgent(agentId).then(setAgent).catch(console.error);
    }, 30_000);
    return () => clearInterval(poll);
  }, [agentId]);

  useEffect(() => {
    if (!agentId) return;
    fetchAgent(agentId).then(setAgent).catch(console.error);
    fetchSecrets(agentId).then((s) => setSecretNames(s.names)).catch(console.error);
    fetchMessages(agentId, 'ui').then((msgs) => {
      // Group tool_call rows into the following assistant message's toolCalls array
      const grouped: ChatMessage[] = [];
      let pendingToolCalls: string[] = [];
      for (const m of msgs) {
        if (m.role === 'tool_call') {
          pendingToolCalls.push(m.content);
        } else if (m.role === 'assistant') {
          // Skip empty assistant messages (ghost messages from interrupted streams)
          if (!m.content && pendingToolCalls.length === 0) continue;
          grouped.push({ id: m.id, role: 'agent', text: m.content, toolCalls: pendingToolCalls.length > 0 ? pendingToolCalls : undefined });
          pendingToolCalls = [];
        } else {
          // Flush any orphaned tool calls before a user message
          if (pendingToolCalls.length > 0) {
            grouped.push({ id: crypto.randomUUID(), role: 'agent', text: '', toolCalls: pendingToolCalls });
            pendingToolCalls = [];
          }
          grouped.push({ id: m.id, role: 'user', text: m.content });
        }
      }
      // Flush any remaining orphaned tool calls at the end
      if (pendingToolCalls.length > 0) {
        grouped.push({ id: crypto.randomUUID(), role: 'agent', text: '', toolCalls: pendingToolCalls });
      }
      setMessages(grouped);
    }).catch(console.error);
    fetchMessages(agentId, 'bb').then((msgs) =>
      setBbMessages(msgs.map((m) => ({ id: m.id, role: m.role === 'user' ? 'user' : 'agent', text: m.content })))
    ).catch(console.error);
  }, [agentId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, mainView]);

  useEffect(() => {
    bbBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [bbMessages]);

  // ── Agent send ─────────────────────────────────────────────────────────

  function handleSend() {
    const text = input.trim();
    if (!text || isSending) return;

    const userMsg: ChatMessage = { id: crypto.randomUUID(), role: 'user', text };
    const agentMsgId = crypto.randomUUID();
    const agentMsg: ChatMessage = { id: agentMsgId, role: 'agent', text: '', isStreaming: true, toolCalls: [] };

    setMessages((prev) => [...prev, userMsg, agentMsg]);
    setInput('');
    setIsSending(true);

    let agentReply = '';

    sendMessage(text, (chunk) => {
      if (chunk.type === 'text') {
        agentReply += chunk.text;
        setMessages((prev) =>
          prev.map((m) => m.id === agentMsgId ? { ...m, text: m.text + chunk.text } : m)
        );
      } else if (chunk.type === 'tool_call') {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === agentMsgId
              ? { ...m, toolCalls: [...(m.toolCalls ?? []), `${chunk.tool}(${JSON.stringify(chunk.input)})`] }
              : m
          )
        );
      } else if (chunk.type === 'pending_approval') {
        setPendingApproval({ reason: chunk.reason });
        setMessages((prev) =>
          prev.map((m) =>
            m.id === agentMsgId ? { ...m, text: `⏳ Awaiting approval: ${chunk.reason}` } : m
          )
        );
      } else if (chunk.type === 'blocked') {
        const blockedText = `🛡 Blocked: ${chunk.reason}`;
        setPendingApproval(null);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === agentMsgId ? { ...m, isStreaming: false, text: blockedText } : m
          )
        );
        setIsSending(false);
      } else if (chunk.type === 'agent_ready') {
        setAgentDisplayName(chunk.name);
      } else if (chunk.type === 'done' || chunk.type === 'error') {
        const errorText = chunk.type === 'error' ? `⚠ ${chunk.message}` : '';
        const finalText = agentReply + (errorText ? `\n\n${errorText}` : '');
        setPendingApproval(null);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === agentMsgId ? { ...m, isStreaming: false, text: finalText } : m
          )
        );
        setIsSending(false);
      }
    });
  }

  // ── Big Brother send ───────────────────────────────────────────────────

  function handleBbSend() {
    const text = bbInput.trim();
    if (!text || isBbSending) return;

    const userMsg: ChatMessage = { id: crypto.randomUUID(), role: 'user', text };
    const bbMsgId = crypto.randomUUID();
    const bbMsg: ChatMessage = { id: bbMsgId, role: 'agent', text: '', isStreaming: true };

    setBbMessages((prev) => [...prev, userMsg, bbMsg]);
    setBbInput('');
    setIsBbSending(true);

    let bbReply = '';

    sendBbMessage(text, (chunk) => {
      if (chunk.type === 'text') {
        bbReply += chunk.text;
        setBbMessages((prev) =>
          prev.map((m) => m.id === bbMsgId ? { ...m, text: m.text + chunk.text } : m)
        );
      } else if (chunk.type === 'agent_ready') {
        setBbGuardianName(chunk.name);
        setBbGuardrailsActive(true);
      } else if (chunk.type === 'done' || chunk.type === 'error') {
        const errorText = chunk.type === 'error' ? `⚠ ${chunk.message}` : '';
        const finalText = bbReply + (errorText ? `\n\n${errorText}` : '');
        setBbMessages((prev) =>
          prev.map((m) =>
            m.id === bbMsgId ? { ...m, isStreaming: false, text: finalText } : m
          )
        );
        setIsBbSending(false);
      }
    });
  }

  // ── Wipe ───────────────────────────────────────────────────────────────

  async function handleWipe() {
    if (!window.confirm('[DANGEROUS] Wipe out agent?\n\nThis will permanently delete:\n• All chat history\n• Claude session memory\n• Workspace files\n\nThis cannot be undone.')) return;
    setIsWiping(true);
    try {
      await resetAgent(agentId);
      setMessages([]);
      setBbMessages([]);
      setAgentDisplayName(null);
      setBbGuardianName(null);
      setBbGuardrailsActive(false);
    } catch (err) {
      console.error('wipe failed', err);
    } finally {
      setIsWiping(false);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────

  const bbEnabled = agent?.bigBrother?.enabled && agent.bbPort !== null;

  return (
    <div className="flex h-full gap-5">

      {/* Left panel — agent settings */}
      {agent ? (
        <AgentSettingsPanel
          agentId={agentId}
          agent={agent}
          agentDisplayName={agentDisplayName}
          connected={connected}
          secretNames={secretNames}
          setSecretNames={setSecretNames}
          isWiping={isWiping}
          isSending={isSending}
          onWipe={handleWipe}
          mainView={mainView}
          onViewChange={setMainView}
        />
      ) : (
        <aside className="w-80 flex-shrink-0 rounded-md bg-[#1e1f26] p-4">
          <p className="font-mono text-xs text-on-surface-variant">loading…</p>
        </aside>
      )}

      {/* Main content — chat or filesystem or browser or tasks */}
      {mainView === 'files' ? (
        <WorkspaceExplorer agentId={agentId} />
      ) : mainView === 'browser' ? (
        <BrowserView agentId={agentId} />
      ) : mainView === 'tasks' ? (
        <TaskBoard agentId={agentId} />
      ) : mainView === 'workflows' ? (
        <WorkflowList agentId={agentId} />
      ) : mainView === 'schedules' ? (
        <ScheduleList agentId={agentId} />
      ) : mainView === 'monitor' ? (
        <MonitorView agentId={agentId} />
      ) : mainView === 'usage' ? (
        <UsageView agentId={agentId} />
      ) : mainView === 'logs' ? (
        <LogsView agentId={agentId} />
      ) : (
      <div className="flex flex-1 flex-col rounded-lg bg-surface-card overflow-hidden min-w-0">
        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
          {messages.length === 0 && (
            <p className="font-mono text-xs text-on-surface-variant m-auto">
              Send a message to start the conversation…
            </p>
          )}

          {messages.map((m) => (
            <div key={m.id} className={`flex flex-col gap-1 ${m.role === 'user' ? 'items-end' : 'items-start'}`}>
              <span className="text-[10px] uppercase tracking-widest text-on-surface-variant font-medium">
                {m.role === 'user' ? 'you' : agent?.name ?? 'agent'}
              </span>

              {/* Tool calls — collapsible fixed-height container */}
              {(m.toolCalls?.length ?? 0) > 0 && (
                <ToolCallsBlock toolCalls={m.toolCalls!} isStreaming={m.isStreaming} />
              )}

              {/* Only render text bubble if there's text or it's streaming */}
              {(m.text || m.isStreaming) && (
              <div
                className={`max-w-xl rounded-lg px-3 py-2 text-sm leading-relaxed
                  ${m.text.startsWith('🛡 Blocked:')
                    ? 'bg-red-950/40 border border-red-800/50 text-red-300 font-mono text-xs'
                    : m.role === 'user'
                      ? 'bg-primary-container/20 text-on-surface font-mono whitespace-pre-wrap break-words'
                      : 'bg-surface-high text-on-surface'
                  }
                  ${m.isStreaming ? 'animate-pulse' : ''}
                `}
              >
                {m.text.startsWith('🛡 Blocked:')
                  ? m.text
                  : m.role === 'user'
                    ? (m.text || '…')
                    : m.text
                      ? <div className="prose prose-invert prose-sm max-w-none
                          prose-p:my-1 prose-headings:mt-3 prose-headings:mb-1
                          prose-code:bg-surface-lowest prose-code:px-1 prose-code:rounded prose-code:text-xs
                          prose-pre:bg-surface-lowest prose-pre:text-xs
                          prose-ul:my-1 prose-ol:my-1 prose-li:my-0
                          prose-a:text-secondary prose-strong:text-on-surface
                          prose-table:border-collapse prose-table:text-xs prose-table:w-full
                          prose-th:border prose-th:border-white/10 prose-th:px-2 prose-th:py-1 prose-th:bg-surface-lowest prose-th:text-left prose-th:font-medium
                          prose-td:border prose-td:border-white/10 prose-td:px-2 prose-td:py-1">
                          <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>{m.text}</ReactMarkdown>
                        </div>
                      : '…'
                }
              </div>
              )}
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        {/* Pending approval banner — user responds via guardian chat */}
        {pendingApproval && (
          <div data-testid="pending-approval" className="flex items-center gap-3 border-t border-amber-800/50 bg-amber-950/40 px-4 py-3">
            <ShieldIcon className="h-5 w-5 text-amber-400 flex-shrink-0 animate-pulse" />
            <div className="flex-1 min-w-0">
              <p className="font-mono text-xs text-amber-300 font-semibold">Awaiting approval</p>
              <p className="font-mono text-[11px] text-amber-400/80 mt-0.5">{pendingApproval.reason}</p>
              <p className="font-mono text-[10px] text-amber-500/60 mt-1">Respond in the guardian panel →</p>
            </div>
          </div>
        )}

        {/* Input */}
        <div className="flex gap-2 border-t border-outline-variant/20 p-3">
          <textarea
            className="flex-1 rounded bg-surface-highest px-3 py-2 text-sm text-on-surface placeholder-on-surface-variant outline-none focus:ring-1 focus:ring-primary/40 font-mono resize-none"
            placeholder={`Message ${agentDisplayName ?? agent?.name ?? 'agent'}… (Shift+Enter for new line)`}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
            disabled={isSending}
            rows={Math.min(input.split('\n').length, 8)}
            style={{ minHeight: '2.5rem', maxHeight: '12rem', overflow: 'auto' }}
          />
          {isSending ? (
            <button
              onClick={handleStop}
              className="rounded bg-red-500/20 px-4 py-2 text-sm font-medium text-red-400 transition-opacity hover:bg-red-500/30"
            >
              Stop
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={!input.trim() || !connected}
              className="rounded bg-primary-container px-4 py-2 text-sm font-medium text-[#3c0091] transition-opacity disabled:opacity-40 hover:opacity-90"
            >
              Send
            </button>
          )}
        </div>
      </div>
      )}

      {/* Big Brother panel — only visible in chat view */}
      {bbEnabled && mainView === 'chat' && (
        <div data-testid="bb-panel" className={`relative flex-shrink-0 flex flex-col rounded-lg bg-surface-card overflow-hidden transition-all duration-200 ${bbPanelOpen ? 'w-96' : 'w-10'}`}>

          {/* Coming Soon overlay */}
          <div
            data-testid="guardian-coming-soon-overlay"
            className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-surface-card/90 backdrop-blur-sm rounded-lg"
          >
            <ShieldIcon className="h-12 w-12 text-amber-400/30 mb-4" />
            {bbPanelOpen && (
              <>
                <p className="font-display text-lg font-semibold text-on-surface tracking-tight mb-2">
                  Guardian
                </p>
                <span className="rounded-full bg-amber-400/10 border border-amber-400/20 px-3 py-1 font-mono text-[10px] text-amber-400 uppercase tracking-widest mb-4">
                  Coming Soon
                </span>
                <p className="max-w-[260px] text-center font-mono text-[10px] text-on-surface-variant/50 leading-relaxed px-4">
                  Set up a Guardian agent to control what your main agent can do.
                  Define guardrails, block actions, and require approval before sensitive operations.
                </p>
              </>
            )}
          </div>

          {/* Header — always visible (behind overlay) */}
          <div
            className="flex items-center gap-2 px-3 py-3 border-b border-outline-variant/20"
          >
            <ShieldIcon className="h-4 w-4 flex-shrink-0 text-on-surface-variant" />
            {bbPanelOpen && (
              <>
                <div className="flex-1 min-w-0">
                  <p className="font-display text-xs font-semibold text-on-surface truncate">
                    Guardian
                  </p>
                  <p className="font-mono text-[9px] text-on-surface-variant">
                    ○ offline
                  </p>
                </div>
              </>
            )}
          </div>

          {/* Placeholder content behind overlay */}
          {bbPanelOpen && (
            <div className="flex-1 overflow-hidden p-3 flex flex-col gap-2">
              <p className="font-mono text-[10px] text-on-surface-variant/20 m-auto text-center leading-relaxed">
                Guardian chat.<br />Configure guardrails here.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
