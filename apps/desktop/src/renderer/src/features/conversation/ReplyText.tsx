import { Fragment, type ReactNode } from 'react';

/**
 * An assistant reply: plain text, bold, and web links. Links (Markdown `[title](url)` or a bare
 * address) open in the person's default browser through main, never inside Edi, and only for
 * http(s). Everything is built as React elements, so reply text can never inject HTML.
 */
export function ReplyText({ text }: { text: string }) {
  return <>{parts(text)}</>;
}

const pattern =
  /\[([^\]\n]{1,300})\]\((https?:\/\/[^)\s]{1,2000})\)|(https?:\/\/[^\s<>()]{1,2000}[^\s<>().,;:!?'"])|\*\*([^*\n]{1,300})\*\*/g;

function host(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function parts(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > last) out.push(text.slice(last, index));
    const [, label, linked, bare, bold] = match;
    if (bold) out.push(<strong key={key++}>{bold}</strong>);
    else {
      const url = (linked ?? bare)!;
      const site = host(url);
      out.push(
        <a
          key={key++}
          className="reply-link"
          href={url}
          title={site ? `Open ${site} in your browser` : url}
          onClick={event => {
            event.preventDefault();
            void window.edi?.command({ type: 'open-link', url }).catch(() => {});
          }}
        >
          {label || site || url}
        </a>,
      );
    }
    last = index + match[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out.map((part, index) => <Fragment key={`p${index}`}>{part}</Fragment>);
}
