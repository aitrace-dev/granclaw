/**
 * lib/flatten-markdown-tables.ts
 *
 * Telegram's MarkdownV2 parse mode has no table support. When the LLM
 * returns a markdown table and we pass it through telegramify-markdown,
 * the library treats every cell as plain-text-with-unknowns and escapes
 * every special character inside — including the brackets and parens of
 * links. Worse, `\|` (escaped pipe) is NOT a valid MarkdownV2 escape
 * sequence per Telegram's parser spec, so the whole message gets
 * rejected, the adapter falls back to plain text, and users see the
 * raw escape-soup: `\|Precio\|\-\-\-\|\[Ver en...\]\(https://...\)`.
 *
 * This helper detects pipe-delimited markdown tables and rewrites each
 * row as a set of `*Header*: cell` lines separated by blank lines. That
 * renders cleanly in Telegram and preserves any markdown links inside
 * the cells (they were never actually inside a table syntactically —
 * telegramify-markdown just didn't know that).
 *
 * Non-table content passes through unchanged.
 */

interface TableBlock {
  startLine: number;
  endLine: number; // inclusive
  headers: string[];
  rows: string[][];
}

const TABLE_ROW_RE = /^\s*\|(.+)\|\s*$/;
// A separator row is a table row whose cells only contain `-` / `:` / spaces.
const SEPARATOR_ROW_RE = /^\s*\|?[\s:|\-]+\|?\s*$/;

function parseRow(line: string): string[] | null {
  const m = line.match(TABLE_ROW_RE);
  if (!m) return null;
  return m[1].split('|').map((c) => c.trim());
}

function isSeparatorLine(line: string): boolean {
  if (!SEPARATOR_ROW_RE.test(line)) return false;
  // At least one `-` in the line — excludes blank `| | |` rows.
  return /-/.test(line);
}

function findTableAt(lines: string[], start: number): TableBlock | null {
  const header = parseRow(lines[start]);
  if (!header) return null;
  if (start + 1 >= lines.length) return null;
  if (!isSeparatorLine(lines[start + 1])) return null;
  const separatorCells = parseRow(lines[start + 1]);
  if (!separatorCells || separatorCells.length !== header.length) return null;

  const rows: string[][] = [];
  let i = start + 2;
  while (i < lines.length) {
    const row = parseRow(lines[i]);
    if (!row) break;
    // Pad or truncate to the header width so missing trailing cells don't
    // blow us up.
    const normalised = header.map((_, idx) => row[idx]?.trim() ?? '');
    rows.push(normalised);
    i++;
  }
  // A table with only a header and separator but no data rows is still a
  // table — we'll render it as an empty list, which is rare enough that
  // it's not worth special-casing.
  return { startLine: start, endLine: i - 1, headers: header, rows };
}

function renderTableAsLines(table: TableBlock): string[] {
  const out: string[] = [];
  for (const row of table.rows) {
    if (out.length > 0) out.push(''); // blank line between entries
    for (let j = 0; j < table.headers.length; j++) {
      const header = table.headers[j];
      const cell = row[j] ?? '';
      if (!header && !cell) continue;
      if (!cell) {
        out.push(`**${header}**:`);
      } else if (!header) {
        out.push(cell);
      } else {
        out.push(`**${header}**: ${cell}`);
      }
    }
  }
  return out;
}

export function flattenMarkdownTables(md: string): string {
  if (!md.includes('|')) return md; // fast path
  const lines = md.split('\n');
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const table = findTableAt(lines, i);
    if (table) {
      out.push(...renderTableAsLines(table));
      i = table.endLine + 1;
    } else {
      out.push(lines[i]);
      i++;
    }
  }
  return out.join('\n');
}
