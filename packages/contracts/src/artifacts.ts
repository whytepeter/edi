import { z } from 'zod';

/**
 * Content Edi shows instead of reading out. Structured kinds are plain data drawn by Edi's own
 * components; a `diagram` is Mermaid text (https://mermaid.js.org) drawn by the bundled Mermaid
 * in strict mode, so a follow-up edits the same text. A `view` is generated interface: figures,
 * progress, charts, choices, fields and buttons drawn by Edi's own components, where a tap asks
 * Edi for the next step. `html` is the exception for interaction or visuals those kinds cannot express:
 * it is untrusted, served by main with a strict sandbox, and never rendered inside Edi's UI.
 * A summary travels with the conversation; the full content is fetched when it is opened.
 */
export const artifactKindSchema = z.enum([
  'document',
  'note',
  'checklist',
  'table',
  'diagram',
  'view',
  'html',
]);
export type ArtifactKind = z.infer<typeof artifactKindSchema>;

const title = z.string().trim().min(1).max(120);

/**
 * One piece of a `view`. A single flat shape (rather than one per type) keeps the tool schema
 * the model reads on every turn small; `viewBlockProblem` says what each type needs.
 *
 * - heading, text: `text`
 * - stat: `text` (label) and `value`, with an optional `detail`; stats in a row sit side by side
 * - progress: `text` and `values[0]` from 0 to 1
 * - list: `items`, with an optional `text` heading
 * - chart: `items` (labels) and `values`, as `bar`, `line` or `ring`
 * - choice: `items` (options to tap), with an optional `text` question
 * - input: `text` (label), with an optional `value` to start from
 * - button: `text` (label)
 * - divider: nothing
 *
 * `ask` on a choice or button is what the person is asking Edi when they tap it.
 */
export const viewBlockTypes = [
  'heading',
  'text',
  'stat',
  'progress',
  'list',
  'chart',
  'choice',
  'input',
  'button',
  'divider',
] as const;
export const viewBlockSchema = z
  .object({
    type: z.enum(viewBlockTypes),
    text: z.string().trim().max(400).optional(),
    value: z.string().trim().max(60).optional(),
    detail: z.string().trim().max(200).optional(),
    items: z.array(z.string().trim().min(1).max(160)).max(12).optional(),
    values: z.array(z.number().finite()).max(12).optional(),
    style: z.enum(['bar', 'line', 'ring']).optional(),
    ask: z.string().trim().min(1).max(500).optional(),
  })
  .strict();
export type ViewBlock = z.infer<typeof viewBlockSchema>;

/** Why a block can't be drawn, in words the model can act on; null when it can. */
export function viewBlockProblem(block: ViewBlock): string | null {
  const { type, text, value, items = [], values = [] } = block;
  if ((type === 'heading' || type === 'text' || type === 'button' || type === 'input') && !text)
    return `A ${type} needs \`text\`.`;
  if (type === 'stat' && (!text || !value)) return 'A stat needs `text` (its label) and `value`.';
  if (type === 'progress' && (!text || !(values[0]! >= 0 && values[0]! <= 1)))
    return 'A progress bar needs `text` and `values: [fraction]` between 0 and 1.';
  if ((type === 'list' || type === 'choice') && !items.length) return `A ${type} needs \`items\`.`;
  if (type === 'chart' && (!items.length || items.length !== values.length))
    return 'A chart needs `items` (labels) and the same number of `values`.';
  if (type === 'chart' && values.some(number => number < 0))
    return 'Chart values cannot be negative.';
  return null;
}

/**
 * What a tap asks Edi: the block's `ask` (or its own words), the option tapped, and whatever
 * the person typed into the view's fields. It is sent as their next message.
 */
export function viewAsk(
  block: ViewBlock,
  option: string | null,
  fields: readonly { label: string; value: string }[] = [],
): string {
  const base = block.ask ?? block.text ?? '';
  const asked = option === null ? base : block.ask ? `${block.ask} ${option}` : option;
  const filled = fields
    .filter(field => field.value.trim())
    .map(field => `${field.label}: ${field.value.trim()}`)
    .join('; ');
  return `${asked}${filled ? ` (${filled})` : ''}`.trim().slice(0, 8_000);
}

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
      kind: z.literal('diagram'),
      title,
      mermaid: z.string().trim().min(1).max(20_000).describe('The diagram, in Mermaid syntax'),
    })
    .strict(),
  z
    .object({
      kind: z.literal('view'),
      title,
      blocks: z
        .array(viewBlockSchema)
        .min(1)
        .max(40)
        .superRefine((blocks, context) => {
          blocks.forEach((block, index) => {
            const problem = viewBlockProblem(block);
            if (problem) context.addIssue({ code: 'custom', path: [index], message: problem });
          });
        }),
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
  if (content.kind === 'view') {
    const markdown = `# ${content.title}\n\n${viewMarkdown(content.blocks)}\n`;
    return { copy: markdown, extension: 'md', file: markdown } as const;
  }
  // Copied as a fenced block so it renders when pasted into GitHub, Notion or Obsidian.
  if (content.kind === 'diagram')
    return {
      copy: `\`\`\`mermaid\n${content.mermaid}\n\`\`\`\n`,
      extension: 'mmd',
      file: `${content.mermaid}\n`,
    } as const;
  return { copy: content.markdown, extension: 'md', file: `${content.markdown}\n` } as const;
}

/** A view as Markdown: what it says, without what could be tapped. */
export function viewMarkdown(blocks: readonly ViewBlock[]) {
  return blocks
    .flatMap(block => {
      const { type, text = '', value = '', detail = '', items = [], values = [] } = block;
      if (type === 'heading') return [`## ${text}`];
      if (type === 'text') return [text];
      if (type === 'stat') return [`- **${text}:** ${value}${detail ? ` (${detail})` : ''}`];
      if (type === 'progress') return [`- ${text}: ${Math.round((values[0] ?? 0) * 100)}%`];
      if (type === 'list')
        return [...(text ? [`**${text}**`] : []), ...items.map(item => `- ${item}`)];
      if (type === 'chart') return items.map((item, index) => `- ${item}: ${values[index]}`);
      if (type === 'choice') return [...(text ? [text] : []), ...items.map(item => `- ${item}`)];
      if (type === 'input') return [`- ${text}: ${value}`];
      if (type === 'divider') return ['---'];
      return [];
    })
    .join('\n');
}

/**
 * Export is its own step, apart from the working copy Edi keeps: a file made to hand to someone,
 * written to Documents › Edi › Exports. Each kind offers the formats that suit it, first is the
 * default. PDF and pictures are drawn by Edi's own renderer; the rest are text.
 */
export const exportFormatSchema = z.enum(['pdf', 'md', 'csv', 'png', 'svg', 'mmd', 'html']);
export type ExportFormat = z.infer<typeof exportFormatSchema>;

export const exportFormats: Record<ArtifactKind, readonly ExportFormat[]> = {
  document: ['pdf', 'md'],
  note: ['pdf', 'md'],
  checklist: ['pdf', 'md'],
  table: ['csv', 'pdf', 'md'],
  diagram: ['png', 'svg', 'pdf', 'mmd'],
  view: ['md'],
  html: ['html'],
};

export const exportFormatLabel: Record<ExportFormat, string> = {
  pdf: 'PDF',
  md: 'Markdown',
  csv: 'CSV',
  png: 'PNG image',
  svg: 'SVG image',
  mmd: 'Mermaid source',
  html: 'Web page',
};

/** Formats drawn by a renderer rather than written as text. */
export const renderedExportFormats: readonly ExportFormat[] = ['pdf', 'png', 'svg'];

/** A file name from a title: no path separators or characters Finder refuses. */
export function exportFileName(title: string, format: ExportFormat) {
  const name =
    title
      .replace(/[\\/:*?"<>|]+/g, '-')
      .replace(/\p{Cc}+/gu, '-')
      .replace(/^[.\s-]+/, '')
      .trim()
      .slice(0, 100) || 'Edi';
  return `${name}.${format}`;
}

/** The text formats of shown content. Rendered formats (PDF, pictures) come from the host. */
export function artifactTextExport(content: ArtifactContent | Artifact, format: ExportFormat) {
  if (!exportFormats[content.kind].includes(format) || renderedExportFormats.includes(format))
    throw new Error(`A ${content.kind} can't be exported as ${exportFormatLabel[format]} text.`);
  const portable = artifactExport(content);
  // A table's own file is CSV; as Markdown it becomes a titled table.
  if (format === 'md' && content.kind === 'table') return `# ${content.title}\n\n${portable.copy}`;
  return portable.file;
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
  else if (content.kind === 'diagram') text = diagramPreview(content.mermaid);
  else if (content.kind === 'view')
    text = viewMarkdown(content.blocks)
      .replace(/^#+\s+|\*\*|^---$/gm, '')
      .replace(/^- /gm, '• ')
      .replace(/\n{2,}/g, '\n')
      .trim();
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

/** "Flowchart: Browser → API → Database" from Mermaid source: its type and first labels. */
export function diagramPreview(source: string) {
  const lines = source
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('%%'));
  const type = (lines[0] ?? '').split(/\s+/)[0] ?? '';
  const names: Record<string, string> = {
    flowchart: 'Flowchart',
    graph: 'Flowchart',
    sequenceDiagram: 'Sequence',
    classDiagram: 'Class diagram',
    stateDiagram: 'State diagram',
    'stateDiagram-v2': 'State diagram',
    erDiagram: 'Entity relationships',
    timeline: 'Timeline',
    mindmap: 'Mind map',
    gantt: 'Schedule',
    pie: 'Pie chart',
    journey: 'Journey',
    quadrantChart: 'Quadrant chart',
  };
  const labels: string[] = [];
  for (const match of source.matchAll(
    /\[\(?"?([^\]"()]{1,40})"?\)?\]|\(\("?([^)"]{1,40})"?\)\)|\{"?([^}"]{1,40})"?\}|participant\s+(?:\w+\s+as\s+)?([^\n]{1,40})/g,
  )) {
    const label = (match[1] ?? match[2] ?? match[3] ?? match[4] ?? '').trim();
    if (label && !labels.includes(label)) labels.push(label);
    if (labels.length >= 6) break;
  }
  const kind = names[type] ?? 'Diagram';
  return labels.length ? `${kind}: ${labels.join(' → ')}` : kind;
}
