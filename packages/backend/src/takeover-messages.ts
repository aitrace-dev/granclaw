/**
 * takeover-messages.ts
 *
 * System messages sent back to the agent when a human browser takeover
 * finishes. Two paths:
 *
 *   1. User clicked Completed — may include an optional note describing
 *      what they did. Built by `formatTakeoverResumeMessage`.
 *   2. 10-minute timeout — user never clicked Done. See TAKEOVER_TIMEOUT_MESSAGE
 *      re-exported here for a single "where takeover messages live" home.
 *
 * Extracted so tests can pin the exact wire format — agents parse these
 * strings (or their prompts do), so format drift is a silent regression.
 */

export { TAKEOVER_TIMEOUT_MESSAGE } from './takeover-timeout.js';

/** Hard cap on note length — prevents abuse from a long submission. */
const MAX_NOTE_LENGTH = 2000;

/**
 * Build the system message sent to the agent when the user clicks
 * "Completed" on the takeover page.
 *
 * The agent sees this message in its conversation stream and can decide
 * what to do next. The format is:
 *
 *   [User completed browser takeover. Note: "they typed this"]
 *
 * or, if no note:
 *
 *   [User completed browser takeover with no note]
 *
 * The note is JSON-encoded so quote characters inside the note can't
 * confuse prompt parsing.
 */
export function formatTakeoverResumeMessage(rawNote: unknown): string {
  const stringNote = typeof rawNote === 'string' ? rawNote.trim() : '';
  const note = stringNote.slice(0, MAX_NOTE_LENGTH);
  return note
    ? `[User completed browser takeover. Note: ${JSON.stringify(note)}]`
    : '[User completed browser takeover with no note]';
}
