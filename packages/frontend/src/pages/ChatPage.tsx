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
import { IntegrationsView } from '../components/IntegrationsView.tsx';

type MainView = 'chat' | 'files' | 'tasks' | 'browser' | 'workflows' | 'schedules' | 'monitor' | 'usage' | 'logs' | 'integrations';

const VALID_VIEWS: MainView[] = ['chat', 'files', 'tasks', 'browser', 'workflows', 'schedules', 'monitor', 'usage', 'logs', 'integrations'];

// ── Types ─────────────────────────────────────────────────────────────────

type MessageRole = 'user' | 'agent';

interface ChatMessage {
  id: string;
  role: MessageRole;
  text: string;
  isStreaming?: boolean;
  toolCalls?: string[];
}

// ── Typing indicator ──────────────────────────────────────────────────────

function TypingDots() {
  return (
    <span className="inline-flex items-end gap-[3px] h-4">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="block w-1.5 h-1.5 rounded-full bg-current"
          style={{ animation: `heartbeat-dot 1.2s ease-in-out ${i * 0.2}s infinite` }}
        />
      ))}
    </span>
  );
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
        className="flex items-center gap-2 px-2 py-1 rounded hover:bg-surface-dim/50 transition-colors w-full text-left"
      >
        {isStreaming ? (
          <span className="h-3 w-3 rounded-full border-2 border-primary/40 border-t-primary animate-spin flex-shrink-0" />
        ) : (
          <span className="text-[10px] text-primary/60 flex-shrink-0">⚙</span>
        )}
        <span className="font-mono text-[10px] text-on-surface-variant flex-1 truncate">
          {isStreaming ? `Running ${latestTool}…` : `${count} tool call${count !== 1 ? 's' : ''}`}
        </span>
        <svg
          className="w-2.5 h-2.5 text-on-surface-variant/60 transition-transform duration-150 flex-shrink-0"
          style={{ transform: expanded ? 'rotate(90deg)' : 'none' }}
          viewBox="0 0 16 16"
          fill="currentColor"
        >
          <path d="M6 3l5 5-5 5V3z" />
        </svg>
      </button>

      {expanded && (
        <div
          className="mt-1 rounded bg-surface-dim/50 overflow-y-auto scrollbar-thin"
          style={{ maxHeight: '10rem' }}
        >
          {toolCalls.map((tc, i) => (
            <div
              key={i}
              className="font-mono text-[9px] text-on-surface-variant/70 px-2.5 py-1 border-b border-white/[0.03] last:border-0 truncate hover:text-on-surface-variant/60 transition-colors"
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
  // Single splat route (see App.tsx) means this component stays mounted
  // across view switches — WebSocket + streaming state survive navigation.
  // The splat captures everything after /agents/:id/, so we parse the
  // view out of it rather than using a named param.
  const { id: agentId = '', '*': rest = '' } = useParams();
  const navigate = useNavigate();
  const mainView: MainView = (() => {
    if (!rest || rest === 'chat') return 'chat';
    const match = rest.match(/^view\/([\w-]+)$/);
    if (match && VALID_VIEWS.includes(match[1] as MainView)) return match[1] as MainView;
    return 'chat';
  })();
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

  // Big Brother (guardian) is partially wired up. Only the pieces that
  // the current render actually uses are kept here; the rest was removed
  // to keep the strict build clean.
  const [bbPanelOpen /* setter not wired up yet */] = useState(true);
  const [bbMessages, setBbMessages] = useState<ChatMessage[]>([]);
  const [, setBbGuardianName] = useState<string | null>(null);
  const [, setBbGuardrailsActive] = useState(false);
  const bbBottomRef = useRef<HTMLDivElement>(null);

  // NOTE: no `handleReconnect` callback. Brief WS hiccups used to clear
  // isSending and stamp streaming messages as "(connection lost)", which
  // let the user start a second concurrent turn while the agent was
  // still running. Now useAgentSocket keeps the handler and state intact
  // across reconnects — long outages fall through to the 90s stream
  // timeout in useAgentSocket itself. See regression A spec.
  const { sendMessage, stopMessage, connected } = useAgentSocket(agent?.id);

  function handleStop() {
    stopMessage();
    setMessages(prev => prev.map(m => m.isStreaming ? { ...m, isStreaming: false, text: m.text + '\n\n*(stopped)*' } : m));
    setIsSending(false);
  }
  // Track whether we're in the middle of a user-initiated BB send.
  // Always false today (guardian send UI is not wired up); kept so the
  // server-initiated BB message handler below can easily gate on it
  // when the feature lands.
  const bbSendingRef = useRef(false);

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

  // Big Brother (guardian) WS is not wired up yet — bbPort is always null in
  // agent-manager. Pass undefined so the hook stays a no-op.
  useAgentSocket(undefined, handleBbServerMessage);

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

      // If the agent is mid-turn, mark the last agent message as
      // streaming so the "..." indicator pulses and the Stop button
      // renders. Without this, returning to a busy agent after a
      // /dashboard round trip showed tool calls (thanks to the A fix)
      // but no streaming indicator — the chat looked idle even though
      // the agent was still working.
      fetchAgent(agentId).then((a) => {
        if (!a.busy) return;
        setIsSending(true);
        setMessages((prev) => {
          let idx = -1;
          for (let i = prev.length - 1; i >= 0; i--) {
            if (prev[i].role === 'agent') { idx = i; break; }
          }
          if (idx === -1) return prev;
          return prev.map((m, i) =>
            i === idx ? { ...m, isStreaming: true } : m,
          );
        });
      }).catch(() => {});
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
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="flex h-full gap-0 md:gap-5 relative">

      {/* Mobile backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Left panel — agent settings (overlay on mobile, inline on desktop) */}
      <div className={`
        fixed md:static top-14 bottom-0 left-0 z-40
        w-72 flex-shrink-0 flex flex-col
        bg-background md:bg-transparent
        transition-transform duration-300 ease-in-out
        ${sidebarOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full md:translate-x-0'}
      `}>
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
            onViewChange={(view) => { setMainView(view); setSidebarOpen(false); }}
          />
        ) : (
          <aside className="w-full h-full rounded-md bg-surface-container-lowest border border-outline-variant/40 p-4">
            <p className="font-mono text-xs text-on-surface-variant">loading…</p>
          </aside>
        )}
      </div>

      {/* Right column: mobile toggle bar + main content */}
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">

        {/* Mobile sidebar toggle bar — only visible on mobile */}
        <div className="md:hidden flex-shrink-0 flex items-center gap-2 px-3 py-2 bg-surface-container-lowest border-b border-outline-variant/20">
          <button
            type="button"
            onClick={() => setSidebarOpen(o => !o)}
            className="flex items-center gap-2 text-on-surface-variant hover:text-on-surface transition-colors"
          >
            <span className="material-symbols-outlined text-[18px]">menu</span>
            <span className="font-mono text-[11px] truncate max-w-[160px]">
              {agentDisplayName ?? agent?.name ?? agentId}
            </span>
          </button>
          <div className="ml-auto flex items-center gap-1.5">
            <span className={`h-1.5 w-1.5 rounded-full ${connected ? 'bg-success animate-pulse' : 'bg-outline/50'}`} />
            <span className="font-mono text-[9px] text-on-surface-variant/60">{connected ? 'live' : 'off'}</span>
          </div>
        </div>

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
        ) : mainView === 'integrations' ? (
          <div className="flex-1 overflow-y-auto p-4 sm:p-6">
            <IntegrationsView agentId={agentId} secretNames={secretNames} setSecretNames={setSecretNames} />
          </div>
        ) : (
      <div className="flex flex-1 flex-col rounded-lg bg-surface-container-lowest overflow-hidden min-w-0">
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
                    ? 'bg-red-950/40 border border-red-800/50 text-error font-mono text-xs'
                    : m.role === 'user'
                      ? 'bg-primary/20 text-on-surface font-mono whitespace-pre-wrap break-words'
                      : 'bg-surface-container text-on-surface'
                  }
                  ${m.isStreaming ? 'animate-pulse' : ''}
                `}
              >
                {m.text.startsWith('🛡 Blocked:')
                  ? m.text
                  : m.role === 'user'
                    ? (m.text || '…')
                    : m.text
                      ? <div className="prose prose-sm dark:prose-invert max-w-none text-on-surface
                          prose-p:my-1 prose-headings:mt-3 prose-headings:mb-1
                          prose-code:bg-surface-dim prose-code:px-1 prose-code:rounded prose-code:text-xs
                          prose-pre:bg-surface-dim prose-pre:text-xs
                          prose-ul:my-1 prose-ol:my-1 prose-li:my-0
                          prose-a:text-secondary prose-strong:text-on-surface
                          prose-table:border-collapse prose-table:text-xs prose-table:w-full
                          prose-th:border prose-th:border-outline-variant/40 prose-th:px-2 prose-th:py-1 prose-th:bg-surface-dim prose-th:text-left prose-th:font-medium
                          prose-td:border prose-td:border-outline-variant/40 prose-td:px-2 prose-td:py-1">
                          <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>{m.text}</ReactMarkdown>
                        </div>
                      : <TypingDots />
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
            <ShieldIcon className="h-5 w-5 text-warning flex-shrink-0 animate-pulse" />
            <div className="flex-1 min-w-0">
              <p className="font-mono text-xs text-warning font-semibold">Awaiting approval</p>
              <p className="font-mono text-[11px] text-warning/80 mt-0.5">{pendingApproval.reason}</p>
              <p className="font-mono text-[10px] text-amber-500/60 mt-1">Respond in the guardian panel →</p>
            </div>
          </div>
        )}

        {/* Input */}
        <div className="flex gap-2 border-t border-outline-variant/20 p-3">
          <textarea
            className="flex-1 rounded bg-surface-container-high px-3 py-2 text-sm text-on-surface placeholder-on-surface-variant outline-none focus:ring-1 focus:ring-primary/40 font-mono resize-none"
            placeholder={`Message ${agentDisplayName ?? agent?.name ?? 'agent'}…`}
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
              className="rounded bg-red-500/20 px-4 py-2 text-sm font-medium text-error transition-opacity hover:bg-red-500/30"
            >
              Stop
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={!input.trim() || !connected}
              className="rounded bg-primary px-4 py-2 text-sm font-medium text-on-primary transition-opacity disabled:opacity-40 hover:opacity-90"
            >
              Send
            </button>
          )}
        </div>
        <p className="hidden md:block px-3 pb-1.5 font-mono text-[9px] text-on-surface-variant/30 -mt-1">
          Enter to send · Shift+Enter for new line
        </p>
      </div>
      )}

      </div>{/* end right column */}

      {/* Big Brother panel — only visible in chat view, hidden on mobile */}
      {bbEnabled && mainView === 'chat' && (
        <div data-testid="bb-panel" className={`hidden md:flex relative flex-shrink-0 flex-col rounded-lg bg-surface-container-lowest overflow-hidden transition-all duration-200 ${bbPanelOpen ? 'w-96' : 'w-10'}`}>

          {/* Coming Soon overlay */}
          <div
            data-testid="guardian-coming-soon-overlay"
            className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-surface-container-lowest/90 backdrop-blur-sm rounded-lg"
          >
            <ShieldIcon className="h-12 w-12 text-warning/30 mb-4" />
            {bbPanelOpen && (
              <>
                <p className="font-headline text-lg font-semibold text-on-surface tracking-tight mb-2">
                  Guardian
                </p>
                <span className="rounded-full bg-warning/10 border border-warning/30 px-3 py-1 font-label text-[10px] font-semibold text-warning uppercase tracking-widest mb-4">
                  Coming Soon
                </span>
                <p className="max-w-[260px] text-center font-mono text-[10px] text-on-surface-variant leading-relaxed px-4">
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
                  <p className="font-headline text-xs font-semibold text-on-surface truncate">
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
