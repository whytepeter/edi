import { z } from 'zod';

/**
 * Content Edi shows instead of reading out. Structured kinds are plain data drawn by Edi's own
 * components. `html` is the exception for interaction or visuals those kinds cannot express:
 * it is untrusted, served by main with a strict sandbox, and never rendered inside Edi's UI.
 * A summary travels with the conversation; the full content is fetched when it is opened.
 */
export const artifactKindSchema = z.enum(['document', 'note', 'checklist', 'table', 'html']);
export type ArtifactKind = z.infer<typeof artifactKindSchema>;

const title = z.string().trim().min(1).max(120);

/** What Edi may display. Notes are shown by id and read from the Library at open time. */
export const artifactContentSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('document'),
      title,
      markdown: z.string().trim().min(1).max(40_000).describe('The content, in Markdown'),
    })
    .strict(),
  z
    .object({
      kind: z.literal('checklist'),
      title,
      items: z
        .array(z.object({ text: z.string().trim().min(1).max(300), done: z.boolean() }).strict())
        .min(1)
        .max(100),
    })
    .strict(),
  z
    .object({
      kind: z.literal('table'),
      title,
      columns: z.array(z.string().trim().min(1).max(60)).min(1).max(8),
      rows: z
        .array(z.array(z.string().max(300)).max(8))
        .min(1)
        .max(100),
    })
    .strict(),
  z
    .object({
      kind: z.literal('html'),
      title,
      html: z
        .string()
        .trim()
        .min(1)
        .max(120_000)
        .describe('A complete, self-contained HTML page: inline CSS and JavaScript only'),
    })
    .strict(),
]);
export type ArtifactContent = z.infer<typeof artifactContentSchema>;

/** A shown artifact in the conversation: enough to render a compact card. */
export const artifactSummarySchema = z
  .object({
    /** The tool call that showed it. */
    id: z.string().uuid(),
    kind: artifactKindSchema,
    title,
    preview: z.string().max(280),
    /** Set when the artifact is a saved Library note. */
    noteId: z.string().uuid().optional(),
  })
  .strict();
export type ArtifactSummary = z.infer<typeof artifactSummarySchema>;

/** Full content for the expanded view. A note is resolved to Markdown by main. */
export const artifactSchema = z.discriminatedUnion('kind', [
  ...artifactContentSchema.options,
  z
    .object({
      kind: z.literal('note'),
      title,
      markdown: z.string().max(64_000),
      noteId: z.string().uuid(),
    })
    .strict(),
]);
export type Artifact = z.infer<typeof artifactSchema>;

/** Open a shown artifact by its call id, or a Library note by its id. */
export const artifactRefSchema = z.union([
  z.object({ callId: z.string().uuid() }).strict(),
  z.object({ noteId: z.string().uuid() }).strict(),
]);
export type ArtifactRef = z.infer<typeof artifactRefSchema>;

function csvCell(value: string) {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

const markdownCell = (value: string) => value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

/**
 * The portable forms of shown content, from its structured data: what Copy puts on the
 * clipboard (Markdown) and what Download or the workspace saves (Markdown, or CSV for tables).
 */
export function artifactExport(content: ArtifactContent | Artifact) {
  if (content.kind === 'checklist') {
    const items = content.items.map(item => `- [${item.done ? 'x' : ' '}] ${item.text}`);
    const markdown = `# ${content.title}\n\n${items.join('\n')}\n`;
    return { copy: markdown, extension: 'md', file: markdown } as const;
  }
  if (content.kind === 'table') {
    const row = (cells: readonly string[]) =>
      `| ${content.columns.map((_, i) => markdownCell(cells[i] ?? '')).join(' | ')} |`;
    const copy = [
      row(content.columns),
      `| ${content.columns.map(() => '---').join(' | ')} |`,
      ...content.rows.map(row),
    ].join('\n');
    const file = [content.columns, ...content.rows]
      .map(cells => cells.map(csvCell).join(','))
      .join('\n')
      .concat('\n');
    return { copy: `${copy}\n`, extension: 'csv', file } as const;
  }
  if (content.kind === 'html')
    return { copy: content.html, extension: 'html', file: content.html } as const;
  return { copy: content.markdown, extension: 'md', file: `${content.markdown}\n` } as const;
}

/**
 * Served with every interactive page. `sandbox allow-scripts` gives the page an opaque origin
 * (no storage, no access to Edi's window); everything that could load or send data is refused.
 */
export const ARTIFACT_HTML_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  'img-src data: blob:',
  'font-src data:',
  'media-src data: blob:',
  "form-action 'none'",
  "base-uri 'none'",
  "frame-src 'none'",
  'sandbox allow-scripts',
].join('; ');

/**
 * Page defaults that keep a generated page legible on Edi's glass in light and dark mode. They
 * are added before the page's own markup, so the page's styles still win.
 */
export function withArtifactDefaults(html: string) {
  const defaults =
    '<meta charset="utf-8"><meta name="color-scheme" content="light dark">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<style>:where(html){color-scheme:light dark;font:14px/1.5 -apple-system,BlinkMacSystemFont,system-ui,sans-serif}' +
    ':where(body){margin:0;padding:20px 24px}</style>';
  const head = /<head(\s[^>]*)?>/i.exec(html);
  if (head)
    return (
      html.slice(0, head.index + head[0].length) +
      defaults +
      html.slice(head.index + head[0].length)
    );
  const root = /<html(\s[^>]*)?>/i.exec(html);
  if (root)
    return `${html.slice(0, root.index + root[0].length)}<head>${defaults}</head>${html.slice(root.index + root[0].length)}`;
  const body = html.replace(/^\s*<!doctype[^>]*>/i, '');
  return `<!doctype html><html><head>${defaults}</head><body>${body}</body></html>`;
}

/** Plain text for a compact preview: first lines of Markdown, items or rows. */
export function artifactPreview(content: ArtifactContent | { kind: 'note'; markdown: string }) {
  let text: string;
  if (content.kind === 'html')
    text = content.html
      .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  else if (content.kind === 'checklist')
    text = content.items.map(item => `${item.done ? '☑' : '☐'} ${item.text}`).join('\n');
  else if (content.kind === 'table')
    text = [content.columns.join(' · '), ...content.rows.map(row => row.join(' · '))].join('\n');
  else
    text = content.markdown
      .split('\n')
      .map(line =>
        line
          .replace(/^#{1,6}\s+/, '')
          .replace(/^\s*[-*+]\s+\[( |x)\]\s+/i, '• ')
          .replace(/^\s*[-*+]\s+/, '• ')
          .replace(/[*_`~]/g, '')
          .trim(),
      )
      .filter(Boolean)
      .join('\n');
  return text.slice(0, 280);
}
