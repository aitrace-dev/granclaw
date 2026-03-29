import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { fetchAgent, type Agent } from '../lib/api.ts';
import { useAgentSocket } from '../hooks/useAgentSocket.ts';

// ── Types ─────────────────────────────────────────────────────────────────

type MessageRole = 'user' | 'agent';

interface ChatMessage {
  id: string;
  role: MessageRole;
  text: string;
  isStreaming?: boolean;
  toolCalls?: string[];
}

// ── Component ─────────────────────────────────────────────────────────────

export function ChatPage() {
  const { id: agentId = '' } = useParams<{ id: string }>();
  const [agent, setAgent] = useState<Agent | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const { sendMessage } = useAgentSocket();

  useEffect(() => {
    if (agentId) fetchAgent(agentId).then(setAgent).catch(console.error);
  }, [agentId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  function handleSend() {
    const text = input.trim();
    if (!text || isSending) return;

    const userMsg: ChatMessage = { id: crypto.randomUUID(), role: 'user', text };
    const agentMsgId = crypto.randomUUID();
    const agentMsg: ChatMessage = { id: agentMsgId, role: 'agent', text: '', isStreaming: true, toolCalls: [] };

    setMessages((prev) => [...prev, userMsg, agentMsg]);
    setInput('');
    setIsSending(true);

    sendMessage(agentId, text, (chunk) => {
      if (chunk.type === 'text') {
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
      } else if (chunk.type === 'done' || chunk.type === 'error') {
        const errorText = chunk.type === 'error' ? `\n\n⚠ ${chunk.message}` : '';
        setMessages((prev) =>
          prev.map((m) =>
            m.id === agentMsgId ? { ...m, isStreaming: false, text: m.text + errorText } : m
          )
        );
        setIsSending(false);
      }
    });
  }

  return (
    <div className="flex h-full gap-5">
      {/* Left panel — agent info */}
      <aside className="w-64 flex-shrink-0 rounded-lg bg-surface-card p-4 flex flex-col gap-4">
        {agent ? (
          <>
            <div>
              <p className="font-display font-semibold text-on-surface">{agent.name}</p>
              <p className="font-mono text-xs text-secondary mt-0.5">{agent.model}</p>
            </div>

            <span
              className={`w-fit rounded-full px-2 py-0.5 text-xs font-medium uppercase tracking-wide
                ${agent.status === 'active'
                  ? 'bg-secondary-container text-[#002113]'
                  : 'bg-surface-highest text-on-surface-variant'
                }`}
            >
              {agent.status}
            </span>

            <div>
              <p className="text-xs uppercase tracking-widest text-on-surface-variant mb-2 font-medium">
                MCP Tools
              </p>
              <ul className="flex flex-col gap-1.5">
                {agent.allowedTools.map((t) => (
                  <li key={t} className="flex items-center justify-between">
                    <span className="font-mono text-xs text-on-surface">{t}</span>
                    <span className="h-1.5 w-1.5 rounded-full bg-secondary" />
                  </li>
                ))}
              </ul>
            </div>
          </>
        ) : (
          <p className="font-mono text-xs text-on-surface-variant">loading…</p>
        )}
      </aside>

      {/* Chat area */}
      <div className="flex flex-1 flex-col rounded-lg bg-surface-card overflow-hidden">
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

              {/* Tool calls badge */}
              {(m.toolCalls?.length ?? 0) > 0 && (
                <div className="flex flex-col gap-0.5 w-full max-w-xl">
                  {m.toolCalls!.map((tc, i) => (
                    <span key={i} className="font-mono text-[10px] text-primary bg-surface-lowest rounded px-2 py-1 break-all">
                      ⚙ {tc}
                    </span>
                  ))}
                </div>
              )}

              <div
                className={`max-w-xl rounded-lg px-3 py-2 font-mono text-sm leading-relaxed whitespace-pre-wrap break-words
                  ${m.role === 'user'
                    ? 'bg-primary-container/20 text-on-surface'
                    : 'bg-surface-high text-on-surface'
                  }
                  ${m.isStreaming ? 'animate-pulse' : ''}
                `}
              >
                {m.text || (m.isStreaming ? '…' : '')}
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="flex gap-2 border-t border-outline-variant/20 p-3">
          <input
            className="flex-1 rounded bg-surface-highest px-3 py-2 text-sm text-on-surface placeholder-on-surface-variant outline-none focus:ring-1 focus:ring-primary/40 font-mono"
            placeholder={`Message ${agent?.name ?? 'agent'}…`}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
            disabled={isSending}
          />
          <button
            onClick={handleSend}
            disabled={isSending || !input.trim()}
            className="rounded bg-primary-container px-4 py-2 text-sm font-medium text-[#3c0091] transition-opacity disabled:opacity-40 hover:opacity-90"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
