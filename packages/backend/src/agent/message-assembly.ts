/**
 * agent/message-assembly.ts
 *
 * Helper for stitching an assistant turn's streamed chunks into the final
 * text that gets persisted to the `messages` table with role='assistant'.
 *
 * Lives in its own module (not inline in agent/process.ts) for two reasons:
 *   1. agent/process.ts self-executes on load — it reads AGENT_ID / AGENT_PORT
 *      from the environment and calls process.exit(1) if missing. That makes
 *      it unsafe to `require()` into a vitest worker, so unit tests need a
 *      self-contained module.
 *   2. The assembly logic has one subtle invariant (see below) that deserves
 *      to be testable in isolation from the rest of runAgent.
 *
 * The invariant:
 *
 *   When a turn interleaves text and tool_call chunks, the persisted string
 *   must preserve the narrative break between pre-tool and post-tool text.
 *   Streaming chunks arrive like this:
 *
 *     { type: 'text', text: '…let me try logging in explicitly first.' }
 *     { type: 'tool_call', tool: 'browser', input: { command: 'open', … } }
 *     { type: 'text', text: 'I can see the Reddit login form now.' }
 *
 *   The previous code did `fullResponse += chunk.text` for each text chunk
 *   and ignored tool_call chunks entirely, fusing the two sentences into
 *   "first.I can see the Reddit login form now." with no separator — that's
 *   the exact run-on paragraph observed on bluggie.
 *
 *   The fix: insert a paragraph break between text blocks that bracket at
 *   least one tool_call. No break within an uninterrupted run of text
 *   chunks (the model streams one sentence as many small chunks; re-fusing
 *   those back into a paragraph is the correct thing to do).
 */

export type AssistantChunk =
  | { type: 'text'; text: string }
  | { type: 'tool_call'; tool: string; input?: unknown };

/**
 * Fold streamed chunks into the canonical assistant-message string.
 *
 * Rules:
 *   - Consecutive text chunks concatenate without a separator.
 *   - A tool_call between two text runs produces `\n\n` between those runs.
 *   - Leading/trailing tool_calls are ignored (no empty separators).
 *   - Empty text chunks are no-ops.
 */
export function assembleAssistantMessage(chunks: readonly AssistantChunk[]): string {
  let out = '';
  let textRunHasContent = false;
  let pendingToolSeparator = false;

  for (const chunk of chunks) {
    if (chunk.type === 'text') {
      if (!chunk.text) continue;
      if (pendingToolSeparator && textRunHasContent) {
        out += '\n\n';
      }
      out += chunk.text;
      textRunHasContent = true;
      pendingToolSeparator = false;
    } else if (chunk.type === 'tool_call') {
      if (textRunHasContent) pendingToolSeparator = true;
    }
  }

  return out;
}
