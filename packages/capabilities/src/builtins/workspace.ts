import { randomUUID } from 'node:crypto';
import { link, mkdir, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { z } from 'zod';
import {
  artifactContentSchema,
  artifactExport,
  artifactPreview,
  type ArtifactContent,
  type ArtifactSummary,
} from '@edi/contracts';
import { defineCapability } from '../types';
import { slugify } from './notes';

/**
 * Tool providers need a plain object at the root of an input schema, so the discriminated
 * artifact contract is flattened here and re-validated strictly before anything is shown.
 */
const showInput = z
  .object({
    kind: z
      .enum(['document', 'checklist', 'table', 'html'])
      .describe(
        'document: Markdown text · checklist: items to tick · table: rows and columns · ' +
          'html: an interactive page, only when the others cannot express it',
      ),
    title: z.string().trim().min(1).max(120).describe('Short title'),
    markdown: z.string().max(40_000).optional().describe('For document: the content in Markdown'),
    items: z
      .array(z.object({ text: z.string().max(300), done: z.boolean() }).strict())
      .max(100)
      .optional()
      .describe('For checklist'),
    columns: z.array(z.string().max(60)).max(8).optional().describe('For table: column names'),
    rows: z
      .array(z.array(z.string().max(300)).max(8))
      .max(100)
      .optional()
      .describe('For table'),
    html: z
      .string()
      .max(120_000)
      .optional()
      .describe(
        'For html: one complete, self-contained page with inline <style> and <script>. It runs ' +
          'sandboxed: no network, external files, fonts, storage, pop-ups or alerts. Design for a ' +
          '560px-wide resizable window and support light and dark (prefers-color-scheme).',
      ),
  })
  .strict();

export function toArtifactContent(input: z.infer<typeof showInput>): ArtifactContent {
  const candidate =
    input.kind === 'document'
      ? { kind: input.kind, title: input.title, markdown: input.markdown }
      : input.kind === 'checklist'
        ? { kind: input.kind, title: input.title, items: input.items }
        : input.kind === 'html'
          ? { kind: input.kind, title: input.title, html: input.html }
          : { kind: input.kind, title: input.title, columns: input.columns, rows: input.rows };
  const parsed = artifactContentSchema.safeParse(candidate);
  if (!parsed.success)
    throw new Error(
      input.kind === 'document'
        ? 'A document needs Markdown content.'
        : input.kind === 'checklist'
          ? 'A checklist needs at least one item.'
          : input.kind === 'html'
            ? 'An interactive page needs its HTML.'
            : 'A table needs columns and at least one row.',
    );
  return parsed.data;
}

const artifactFolder = {
  document: 'Reports',
  checklist: 'Checklists',
  table: 'Tables',
  html: 'Interactive',
} as const;

/** The same representation Download produces, placed in the folder for its kind. */
function artifactFile(content: ArtifactContent) {
  const { extension, file } = artifactExport(content);
  return { folder: join('Artifacts', artifactFolder[content.kind]), extension, body: file };
}

/**
 * Store the visible representation of generated content in the Edi workspace. The structured
 * tool input remains canonical; this file is the useful, editable copy the person can find.
 */
export async function writeWorkspaceArtifact(directory: () => string, content: ArtifactContent) {
  const root = resolve(directory());
  const file = artifactFile(content);
  const folder = resolve(root, file.folder);
  if (dirname(folder) !== resolve(root, 'Artifacts'))
    throw new Error('Refusing to write outside the Edi workspace.');
  await mkdir(folder, { recursive: true });

  const base = slugify(content.title) || 'artifact';
  const bytes = Buffer.byteLength(file.body);
  const temp = join(folder, `.edi-${randomUUID()}.tmp`);
  await writeFile(temp, file.body, { flag: 'wx', mode: 0o644 });
  try {
    for (let n = 1; n <= 100; n++) {
      const name = `${base}${n === 1 ? '' : `-${n}`}.${file.extension}`;
      const path = join(folder, name);
      try {
        await link(temp, path);
        return { path, relativePath: relative(root, path), bytes };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      }
    }
  } finally {
    await unlink(temp).catch(() => {});
  }
  throw new Error('Too many artifacts share this title. Try a different title.');
}

/** Generated content is both shown and placed in Edi's workspace as one operation. */
export function workspaceCapabilities(deps: {
  directory: () => string;
  shown(artifact: ArtifactSummary): void | Promise<void>;
}) {
  const show = defineCapability({
    id: 'workspace.show',
    title: 'Show content',
    description:
      'Display content in Edi’s card instead of putting it in the reply: a document (Markdown), a ' +
      'checklist, or a table. Use whenever the user asks to see, show, draft, write, list, plan, ' +
      'compare or organize something, and for anything longer than a few sentences. After showing ' +
      'it, reply in one short sentence and do not repeat or read out the content. Edi automatically ' +
      'places the generated file under Documents/Edi/Artifacts; do not ask the user to save it.',
    effect: 'read',
    timeoutMs: 5_000,
    input: showInput,
    prepare(input, { callId }) {
      const content = toArtifactContent(input);
      return {
        preview: {
          title: 'Show content',
          action: 'Show',
          summary: `Show “${content.title}”.`,
          fields: [],
        },
        async execute() {
          const file = await writeWorkspaceArtifact(deps.directory, content);
          const artifact: ArtifactSummary = {
            id: callId,
            kind: content.kind,
            title: content.title,
            preview: artifactPreview(content),
          };
          await deps.shown(artifact);
          return {
            summary: `Showed “${content.title}” and created ${file.relativePath}.`,
            output: {
              shown: true,
              kind: content.kind,
              title: content.title,
              path: file.relativePath,
              bytes: file.bytes,
            },
          };
        },
      };
    },
  });
  return [show] as const;
}
