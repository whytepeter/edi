import { Fragment, type ReactNode } from 'react';

/**
 * A deliberately small Markdown renderer for content Edi shows: headings, paragraphs, lists,
 * task items, quotes, rules, code blocks, tables, bold, italic, inline code and links as text.
 * It builds React elements only, so model-written content can never inject HTML.
 */
export function Markdown({ source }: { source: string }) {
  return <div className="md">{blocks(source)}</div>;
}

function inline(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const pattern =
    /(`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|\*[^*\s][^*]*\*|_[^_\s][^_]*_|\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  let key = 0;
  for (const match of text.matchAll(pattern)) {
    const token = match[0];
    const index = match.index ?? 0;
    if (index > last) parts.push(text.slice(last, index));
    if (token.startsWith('`')) parts.push(<code key={key++}>{token.slice(1, -1)}</code>);
    else if (token.startsWith('**') || token.startsWith('__'))
      parts.push(<strong key={key++}>{token.slice(2, -2)}</strong>);
    else if (token.startsWith('['))
      // Links render as their text: nothing in shown content navigates anywhere.
      parts.push(
        <span key={key++} className="md-link">
          {token.slice(1, token.indexOf(']'))}
        </span>,
      );
    else parts.push(<em key={key++}>{token.slice(1, -1)}</em>);
    last = index + token.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

const tableRow = (line: string) =>
  line
    .trim()
    .replace(/^\||\|$/g, '')
    .split(/(?<!\\)\|/)
    .map(cell => cell.trim().replace(/\\\|/g, '|'));

function blocks(source: string): ReactNode[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const out: ReactNode[] = [];
  let i = 0;
  let key = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    if (!line.trim()) {
      i++;
      continue;
    }
    if (line.startsWith('```')) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !(lines[i] ?? '').startsWith('```')) code.push(lines[i++] ?? '');
      i++;
      out.push(
        <pre key={key++}>
          <code>{code.join('\n')}</code>
        </pre>,
      );
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      out.push(<hr key={key++} />);
      i++;
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      const level = Math.min(3, heading[1]!.length);
      const Tag = `h${level + 1}` as 'h2' | 'h3' | 'h4';
      out.push(<Tag key={key++}>{inline(heading[2] ?? '')}</Tag>);
      i++;
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line) && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1] ?? '')) {
      const head = tableRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i] ?? ''))
        rows.push(tableRow(lines[i++] ?? ''));
      out.push(
        <div className="md-table" key={key++}>
          <table>
            <thead>
              <tr>
                {head.map((cell, c) => (
                  <th key={c}>{inline(cell)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, r) => (
                <tr key={r}>
                  {head.map((_, c) => (
                    <td key={c}>{inline(row[c] ?? '')}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }
    if (/^\s*>/.test(line)) {
      const quote: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i] ?? ''))
        quote.push((lines[i++] ?? '').replace(/^\s*>\s?/, ''));
      out.push(<blockquote key={key++}>{inline(quote.join(' '))}</blockquote>);
      continue;
    }
    if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]/.test(line);
      const items: ReactNode[] = [];
      while (i < lines.length && /^\s*([-*+]|\d+[.)])\s+/.test(lines[i] ?? '')) {
        const text = (lines[i++] ?? '').replace(/^\s*([-*+]|\d+[.)])\s+/, '');
        const task = /^\[( |x|X)\]\s+(.*)$/.exec(text);
        items.push(
          task ? (
            <li key={items.length} className="md-task" data-done={task[1] !== ' ' || undefined}>
              <span className="md-check" aria-hidden="true" />
              <span>{inline(task[2] ?? '')}</span>
            </li>
          ) : (
            <li key={items.length}>{inline(text)}</li>
          ),
        );
      }
      const List = ordered ? 'ol' : 'ul';
      out.push(<List key={key++}>{items}</List>);
      continue;
    }
    const paragraph: string[] = [];
    while (
      i < lines.length &&
      (lines[i] ?? '').trim() &&
      !/^(#{1,6}\s|```|\s*>|\s*([-*+]|\d+[.)])\s+|\s*\||\s*([-*_])(\s*\3){2,}\s*$)/.test(
        lines[i] ?? '',
      )
    )
      paragraph.push(lines[i++] ?? '');
    out.push(
      <p key={key++}>
        {paragraph.map((text, n) => (
          <Fragment key={n}>
            {n > 0 && <br />}
            {inline(text)}
          </Fragment>
        ))}
      </p>,
    );
  }
  return out;
}
