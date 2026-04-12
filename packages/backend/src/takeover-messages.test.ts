import { describe, it, expect } from 'vitest';
import { formatTakeoverResumeMessage } from './takeover-messages.js';

/**
 * Unit tests for the resume-message formatter.
 *
 * The agent receives this string after the user clicks "Completed" on the
 * takeover page. The format is effectively a prompt contract: format drift
 * means the agent either loses the user's note or starts behaving oddly
 * (e.g. re-running the task from scratch because it didn't understand the
 * resume message). This test pins the exact wire format.
 */

describe('formatTakeoverResumeMessage — resume prompt sent to agent', () => {
  it('includes the note when the user provided one', () => {
    const msg = formatTakeoverResumeMessage('solved the hCaptcha');
    expect(msg).toBe('[User completed browser takeover. Note: "solved the hCaptcha"]');
  });

  it('falls back to a no-note variant when the note is empty', () => {
    expect(formatTakeoverResumeMessage('')).toBe(
      '[User completed browser takeover with no note]',
    );
  });

  it('treats whitespace-only notes as empty', () => {
    expect(formatTakeoverResumeMessage('   \t\n  ')).toBe(
      '[User completed browser takeover with no note]',
    );
  });

  it('trims leading and trailing whitespace from real notes', () => {
    const msg = formatTakeoverResumeMessage('  logged in successfully  ');
    expect(msg).toBe('[User completed browser takeover. Note: "logged in successfully"]');
  });

  it('JSON-encodes the note so quotes inside cannot break prompt parsing', () => {
    const msg = formatTakeoverResumeMessage('clicked "Allow" on the popup');
    expect(msg).toBe(
      '[User completed browser takeover. Note: "clicked \\"Allow\\" on the popup"]',
    );
  });

  it('caps the note at 2000 characters to prevent abuse', () => {
    const huge = 'a'.repeat(5000);
    const msg = formatTakeoverResumeMessage(huge);
    // The inner note portion should be exactly 2000 chars (before JSON encoding)
    const match = /^\[User completed browser takeover\. Note: "(.+)"\]$/.exec(msg);
    expect(match).not.toBeNull();
    expect(match![1].length).toBe(2000);
  });

  it('treats non-string input as no-note (defensive for bad JSON bodies)', () => {
    expect(formatTakeoverResumeMessage(undefined)).toBe(
      '[User completed browser takeover with no note]',
    );
    expect(formatTakeoverResumeMessage(null)).toBe(
      '[User completed browser takeover with no note]',
    );
    expect(formatTakeoverResumeMessage(42)).toBe(
      '[User completed browser takeover with no note]',
    );
    expect(formatTakeoverResumeMessage({ note: 'nope' })).toBe(
      '[User completed browser takeover with no note]',
    );
  });
});
