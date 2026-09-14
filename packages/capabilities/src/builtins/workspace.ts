import { randomUUID } from 'node:crypto';
import { access, link, mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { z } from 'zod';
import {
  artifactContentSchema,
  artifactExport,
  artifactPreview,
  type ArtifactContent,
  type ArtifactSummary,
} from '@edi/contracts';
import { defineCapability, OutcomeUnknownError } from '../types';
import { locate, readLibraryNote, slugify, type NoteStore } from './notes';

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

export type WorkspaceKind = ArtifactContent['kind'];

/** Generated workspace content as Edi records it. `content` is the structured data. */
export interface WorkspaceArtifact {
  id: string;
  kind: WorkspaceKind;
  title: string;
  content: unknown;
  /** Relative to the workspace root, always inside Artifacts/. */
  path: string;
  bytes: number;
  createdAt: number;
  updatedAt: number;
}

export interface ArtifactStore {
  add(record: WorkspaceArtifact): void;
  get(id: string): WorkspaceArtifact | undefined;
  list(limit: number): WorkspaceArtifact[];
  update(record: {
    id: string;
    title: string;
    content: unknown;
    bytes: number;
    updatedAt: number;
  }): void;
  remove(id: string): void;
}

export interface WorkspaceDependencies {
  /** Trusted, host-chosen workspace root (Documents/Edi). Never taken from model input. */
  directory: () => string;
  shown(artifact: ArtifactSummary): void | Promise<void>;
  artifacts: ArtifactStore;
  notes: { store: NoteStore; directory: () => string };
  /** Move a file to the system Trash (recoverable), never unlink it. */
  trash(path: string): Promise<void>;
  now?: () => number;
}

const itemId = z.string().uuid().describe('Id from workspace.search');
const MAX_READ_CHARS = 40_000;

/** Stored content back to the validated artifact (older records hold the flattened tool input). */
function contentOf(record: WorkspaceArtifact): ArtifactContent {
  return toArtifactContent(record.content as z.infer<typeof showInput>);
}

/** A generated file's absolute path, refusing anything outside Documents/Edi/Artifacts. */
function artifactFilePath(directory: () => string, relativePath: string) {
  const root = resolve(directory());
  const path = resolve(root, relativePath);
  const inside = relative(resolve(root, 'Artifacts'), path);
  if (!inside || inside.startsWith('..') || isAbsolute(inside))
    throw new Error('Refusing to touch a file outside the Edi workspace.');
  return path;
}

/** Write next to the file, then rename over it, so a failed write never leaves half a file. */
async function replaceFile(path: string, body: string) {
  await mkdir(dirname(path), { recursive: true });
  const temp = join(dirname(path), `.edi-${randomUUID()}.tmp`);
  await writeFile(temp, body, { flag: 'wx', mode: 0o644 });
  try {
    await rename(temp, path);
  } catch (error) {
    await unlink(temp).catch(() => {});
    throw error;
  }
}

function locateWorkspaceItem(deps: WorkspaceDependencies, id: string) {
  const record = deps.artifacts.get(id);
  if (record) {
    return {
      kind: record.kind,
      title: record.title,
      path: artifactFilePath(deps.directory, record.path),
    };
  }
  if (!deps.notes.store.get(id))
    throw new Error('Edi has nothing in its workspace with that id. Search the workspace first.');
  const { note, path } = locate(deps.notes.store, deps.notes.directory, id);
  return { kind: 'note' as const, title: note.title, path };
}

/**
 * Move a workspace item's file to the Trash and forget its record. Used by workspace.delete
 * (after review) and by the Library's own Delete, where the person's confirmation is consent.
 */
export async function deleteWorkspaceItem(deps: WorkspaceDependencies, id: string) {
  const target = locateWorkspaceItem(deps, id);
  const present = await access(target.path).then(
    () => true,
    () => false,
  );
  if (present) await deps.trash(target.path);
  try {
    if (target.kind === 'note') deps.notes.store.remove(id);
    else deps.artifacts.remove(id);
  } catch {
    throw new OutcomeUnknownError(
      `Moved ${target.path} to the Trash, but Edi could not update its Library.`,
    );
  }
  return { title: target.title, path: target.path, kind: target.kind };
}

/** Full text of a workspace item, for the model to read. */
export async function readWorkspaceItem(deps: WorkspaceDependencies, id: string) {
  const record = deps.artifacts.get(id);
  if (record) {
    const content = contentOf(record);
    return {
      id,
      kind: content.kind,
      title: content.title,
      text: artifactExport(content).copy.slice(0, MAX_READ_CHARS),
    };
  }
  const { note, markdown } = await readLibraryNote(deps.notes.store, deps.notes.directory, id);
  return { id, kind: 'note' as const, title: note.title, text: markdown.slice(0, MAX_READ_CHARS) };
}

/** Every query word must appear in the title or content; newest first. */
export async function searchWorkspace(
  deps: WorkspaceDependencies,
  options: { query?: string; kind?: WorkspaceKind | 'note'; limit: number },
) {
  const terms = (options.query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  const candidates = [
    ...deps.artifacts.list(500).map(record => ({
      id: record.id,
      kind: record.kind as WorkspaceKind | 'note',
      title: record.title,
      at: record.updatedAt,
      text: async () => {
        try {
          return artifactExport(contentOf(record)).copy;
        } catch {
          return '';
        }
      },
    })),
    ...deps.notes.store.list(500).map(note => ({
      id: note.id,
      kind: 'note' as WorkspaceKind | 'note',
      title: note.title,
      at: note.createdAt,
      text: async () => {
        try {
          return (await readLibraryNote(deps.notes.store, deps.notes.directory, note.id)).markdown;
        } catch {
          return '';
        }
      },
    })),
  ]
    .filter(item => !options.kind || item.kind === options.kind)
    .sort((a, b) => b.at - a.at);

  const results: { id: string; kind: string; title: string; updated: string; snippet: string }[] =
    [];
  for (const item of candidates) {
    if (results.length >= options.limit) break;
    const text = terms.length ? await item.text() : '';
    const haystack = `${item.title}\n${text}`.toLowerCase();
    if (!terms.every(term => haystack.includes(term))) continue;
    const at = terms.length ? Math.max(0, text.toLowerCase().indexOf(terms[0]!)) : 0;
    const snippet = text
      .slice(Math.max(0, at - 60), at + 140)
      .replace(/\s+/g, ' ')
      .trim();
    results.push({
      id: item.id,
      kind: item.kind,
      title: item.title,
      updated: new Date(item.at).toISOString(),
      snippet,
    });
  }
  return results;
}

/** Generated content is both shown and placed in Edi's workspace as one operation. */
export function workspaceCapabilities(deps: WorkspaceDependencies) {
  const now = deps.now ?? Date.now;
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
          const at = now();
          try {
            deps.artifacts.add({
              id: callId,
              kind: content.kind,
              title: content.title,
              content,
              path: file.relativePath,
              bytes: file.bytes,
              createdAt: at,
              updatedAt: at,
            });
          } catch {
            throw new OutcomeUnknownError(
              `Created ${file.relativePath}, but Edi could not record it in its workspace.`,
            );
          }
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

  const search = defineCapability({
    id: 'workspace.search',
    title: 'Search the workspace',
    description:
      'Find things in the Edi workspace (Documents/Edi): saved notes and generated documents, ' +
      'checklists, tables and interactive pages. Matches every word of the query in the title or ' +
      'content; with no query, lists the most recent items. Returns ids for workspace.read, ' +
      'workspace.update, workspace.delete, notes.edit and notes.show.',
    effect: 'read',
    timeoutMs: 10_000,
    input: z
      .object({
        query: z.string().trim().max(200).optional().describe('Words to look for'),
        kind: z
          .enum(['note', 'document', 'checklist', 'table', 'html'])
          .optional()
          .describe('Only this kind'),
        limit: z.number().int().min(1).max(50).optional().describe('At most this many (20)'),
      })
      .strict(),
    prepare({ query, kind, limit }) {
      return {
        preview: {
          title: 'Search the workspace',
          action: 'Search',
          summary: query ? `Search for “${query}”.` : 'List recent items.',
          fields: [],
        },
        async execute() {
          const results = await searchWorkspace(deps, { query, kind, limit: limit ?? 20 });
          return {
            summary: results.length === 1 ? 'Found 1 item.' : `Found ${results.length} items.`,
            output: { results },
          };
        },
      };
    },
  });

  const read = defineCapability({
    id: 'workspace.read',
    title: 'Read from the workspace',
    description:
      'Read the full text of one workspace item by id from workspace.search: Markdown for ' +
      'documents, checklists and notes, a Markdown table for tables, HTML for interactive pages. ' +
      'Use it to answer from or edit an item; to let the user see it, show it instead.',
    effect: 'read',
    timeoutMs: 10_000,
    input: z.object({ id: itemId }).strict(),
    prepare({ id }) {
      return {
        preview: {
          title: 'Read from the workspace',
          action: 'Read',
          summary: 'Read an item.',
          fields: [],
        },
        async execute() {
          const item = await readWorkspaceItem(deps, id);
          return { summary: `Read “${item.title}”.`, output: item };
        },
      };
    },
  });

  const update = defineCapability({
    id: 'workspace.update',
    title: 'Update generated content',
    description:
      'Replace a generated document, checklist, table or interactive page with a new version, ' +
      'keeping its place in the workspace. Pass its id from workspace.search and the complete new ' +
      'content with the same kind. The user reviews the change first, and Edi opens the result. ' +
      'For saved notes use notes.edit.',
    effect: 'write',
    timeoutMs: 10_000,
    input: showInput.extend({ id: itemId }),
    prepare(input) {
      const record = deps.artifacts.get(input.id);
      if (!record) {
        if (deps.notes.store.get(input.id))
          throw new Error('That is a note. Use notes.edit instead.');
        throw new Error('Edi has no generated content with that id. Search the workspace first.');
      }
      const { id, ...fields } = input;
      const content = toArtifactContent(fields);
      if (content.kind !== record.kind)
        throw new Error(
          `That item is a ${record.kind}. Keep the kind, or show new content instead.`,
        );
      const path = artifactFilePath(deps.directory, record.path);
      return {
        preview: {
          title: 'Update content',
          action: 'Update',
          summary: `Replace “${record.title}” with a new version.`,
          fields: [
            { label: 'Title', value: content.title },
            { label: 'Location', value: path },
          ],
        },
        async execute() {
          const { file } = artifactExport(content);
          await replaceFile(path, file);
          try {
            deps.artifacts.update({
              id,
              title: content.title,
              content,
              bytes: Buffer.byteLength(file),
              updatedAt: now(),
            });
          } catch {
            throw new OutcomeUnknownError(
              `Updated ${path}, but Edi could not update its workspace.`,
            );
          }
          await deps.shown({
            id,
            kind: content.kind,
            title: content.title,
            preview: artifactPreview(content),
          });
          return { summary: `Updated “${content.title}” at ${path}.`, output: { id, path } };
        },
      };
    },
  });

  const remove = defineCapability({
    id: 'workspace.delete',
    title: 'Delete from the workspace',
    description:
      'Move a note or generated item to the macOS Trash and remove it from Edi’s Library. Pass ' +
      'its id from workspace.search. The user reviews the exact file first; it stays recoverable ' +
      'from the Trash.',
    effect: 'write',
    timeoutMs: 15_000,
    input: z.object({ id: itemId }).strict(),
    prepare({ id }) {
      const target = locateWorkspaceItem(deps, id);
      return {
        preview: {
          title: 'Move to Trash',
          action: 'Move to Trash',
          summary: 'Move this to the Trash. You can put it back from the Trash in Finder.',
          fields: [
            { label: 'Title', value: target.title },
            { label: 'Location', value: target.path },
          ],
        },
        async execute() {
          const deleted = await deleteWorkspaceItem(deps, id);
          return {
            summary: `Moved “${deleted.title}” to the Trash.`,
            output: { id, path: deleted.path },
          };
        },
      };
    },
  });

  return [show, search, read, update, remove] as const;
}
