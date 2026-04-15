import { describe, it, expect } from 'vitest';
import { flattenMarkdownTables } from './flatten-markdown-tables.js';

/**
 * Regression tests for the pipe-table flattener the Telegram adapter pipes
 * its outgoing messages through. The bug that inspired this helper: an
 * LLM-generated markdown table in a Spanish housing-listing reply was
 * passing through telegramify-markdown, which escaped every pipe/bracket/
 * paren inside each cell. Telegram rejected the message (`\|` is not a
 * valid MarkdownV2 escape sequence), the adapter fell back to plain text,
 * and users saw a literal wall of backslashes in their chat.
 */

describe('flattenMarkdownTables', () => {
  it('passes non-table markdown through unchanged', () => {
    const input = 'Hello **world**!\n\n- one\n- two\n\nSee [the docs](https://example.com).';
    expect(flattenMarkdownTables(input)).toBe(input);
  });

  it('fast-paths text with no pipes at all', () => {
    const input = 'A plain paragraph with no special markup.';
    expect(flattenMarkdownTables(input)).toBe(input);
  });

  it('does not flatten a lone pipe (not a table)', () => {
    const input = 'use | as a separator in this list';
    expect(flattenMarkdownTables(input)).toBe(input);
  });

  it('flattens a basic 2-column table into bolded key/value lines', () => {
    const input = [
      '| Name  | Value |',
      '| ----- | ----- |',
      '| foo   | 1     |',
      '| bar   | 2     |',
    ].join('\n');
    const out = flattenMarkdownTables(input);
    expect(out).toContain('**Name**: foo');
    expect(out).toContain('**Value**: 1');
    expect(out).toContain('**Name**: bar');
    expect(out).toContain('**Value**: 2');
    // Pipes must be gone
    expect(out).not.toMatch(/^\s*\|/m);
    // Separator line must be gone
    expect(out).not.toMatch(/^[\s|-]+$/m);
  });

  it('preserves markdown links inside table cells', () => {
    // The exact shape from the housing-listing screenshot.
    const input = [
      '| Vivienda | Enlace |',
      '| :--- | :--- |',
      '| Piso Alameda (Novedad) | [Ver en Milanuncios](https://www.milanuncios.com/x.htm) |',
    ].join('\n');
    const out = flattenMarkdownTables(input);
    // The link survives as a clean markdown link, NOT escaped.
    expect(out).toContain('[Ver en Milanuncios](https://www.milanuncios.com/x.htm)');
    // The value with parens survives unchanged.
    expect(out).toContain('Piso Alameda (Novedad)');
    // No pipes, no separator row.
    expect(out).not.toMatch(/^\s*\|/m);
  });

  it('separates rows with a blank line so each entry is visually grouped', () => {
    const input = [
      '| A | B |',
      '| - | - |',
      '| 1 | 2 |',
      '| 3 | 4 |',
    ].join('\n');
    const out = flattenMarkdownTables(input);
    const lines = out.split('\n');
    // Find the blank between the two rows.
    const firstEntryEnd = lines.findIndex((l, i) => i > 0 && l === '' && lines.slice(0, i).some((x) => x.includes('**A**: 1')));
    expect(firstEntryEnd).toBeGreaterThan(-1);
  });

  it('does not touch prose surrounding the table', () => {
    const input = [
      'Intro paragraph.',
      '',
      '| A | B |',
      '| - | - |',
      '| 1 | 2 |',
      '',
      'Footer paragraph.',
    ].join('\n');
    const out = flattenMarkdownTables(input);
    expect(out.startsWith('Intro paragraph.\n')).toBe(true);
    expect(out.endsWith('Footer paragraph.')).toBe(true);
    expect(out).toContain('**A**: 1');
  });

  it('handles tables with alignment markers in the separator row (`:---:`, `---:`, etc.)', () => {
    const input = [
      '| Col1 | Col2 | Col3 |',
      '| :--- | :---: | ---: |',
      '| a    | b     | c    |',
    ].join('\n');
    const out = flattenMarkdownTables(input);
    expect(out).toContain('**Col1**: a');
    expect(out).toContain('**Col2**: b');
    expect(out).toContain('**Col3**: c');
  });

  it('handles multiple tables in one message', () => {
    const input = [
      '| X | Y |',
      '| - | - |',
      '| 1 | 2 |',
      '',
      'between',
      '',
      '| P | Q |',
      '| - | - |',
      '| 3 | 4 |',
    ].join('\n');
    const out = flattenMarkdownTables(input);
    expect(out).toContain('**X**: 1');
    expect(out).toContain('between');
    expect(out).toContain('**P**: 3');
  });

  it('keeps the separator if it does not actually precede a table row', () => {
    // A lone separator-ish line with no table header before it should NOT
    // be swallowed. False-positive guard.
    const input = 'Just some text\n| - | - |\nmore text';
    const out = flattenMarkdownTables(input);
    expect(out).toBe(input);
  });
});
