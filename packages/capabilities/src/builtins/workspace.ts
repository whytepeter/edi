import { randomUUID } from 'node:crypto';
import {
  access,
  copyFile,
  link,
  mkdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { z } from 'zod';
import {
  artifactContentSchema,
  artifactExport,
  artifactPreview,
  exportFormatLabel,
  exportFormatSchema,
  exportFormats,
  viewBlockSchema,
  type ArtifactContent,
  type ArtifactRef,
  type ArtifactSummary,
  type ExportFormat,
} from '@edi/contracts';
import { defineCapability, OutcomeUnknownError } from '../types';
import {
  formatBytes,
  freePath,
  locate,
  noteContent,
  readLibraryNote,
  replaceNote,
  slugify,
  type NoteStore,
} from './notes';

/**
 * Tool providers need a plain object at the root of an input schema, so the discriminated
 * artifact contract is flattened here and re-validated strictly before anything is shown.
 */
const showInput = z
  .object({
    kind: z
      .enum(['document', 'checklist', 'table', 'diagram', 'view', 'html'])
      .describe(
        'document: Markdown text · checklist: items to tick · table: rows and columns · ' +
          'diagram: a flowchart, architecture, sequence, timeline or mind map in Mermaid · ' +
          'view: figures, progress, charts, choices, fields and buttons the user can tap · ' +
          'html: an interactive page, only when the others cannot express it. ' +
          'Asked to visualize, mock up or show what something looks like (a game, a screen, an ' +
          'object), draw the thing itself as html. A diagram is only for a flow, structure or ' +
          'timeline the user asked to map, never a stand-in for a picture of the thing.',
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
    mermaid: z
      .string()
      .max(20_000)
      .optional()
      .describe(
        'For diagram: Mermaid source, e.g. "flowchart LR\n  app[Edi] --> api[API]". Short ' +
          'labels, left-to-right for flows; quote labels with punctuation.',
      ),
    blocks: z
      .array(viewBlockSchema)
      .max(40)
      .optional()
      .describe(
        'For view, top to bottom. heading/text: text · stat: text (label), value, detail ' +
          '(stats in a row sit side by side) · progress: text, values [0–1] · list: items · ' +
          'chart: items (labels), values, style bar|line|ring · choice: items to tap, text ' +
          '(question) · input: text (label) · button: text · divider. On a choice or button, ' +
          '`ask` is what the user asks you when they tap it; field values come with it.',
      ),
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
          ? { kind: input.kind, title: input.title, html: input.html ?? input.markdown }
          : input.kind === 'view'
            ? { kind: input.kind, title: input.title, blocks: input.blocks }
            : input.kind === 'diagram'
              ? { kind: input.kind, title: input.title, mermaid: input.mermaid ?? input.markdown }
              : { kind: input.kind, title: input.title, columns: input.columns, rows: input.rows };
  const parsed = artifactContentSchema.safeParse(candidate);
  if (!parsed.success && input.kind === 'view') {
    // Say which block is wrong and what it needs, so the same call can be corrected.
    const issue = parsed.error.issues.find(entry => entry.path[0] === 'blocks');
    const at = typeof issue?.path[1] === 'number' ? ` Block ${issue.path[1] + 1}: ` : ' ';
    throw new Error(
      issue?.message && issue.path.length > 1
        ? `That view has a block that cannot be drawn.${at}${issue.message}`
        : 'A view needs at least one block, in `blocks`.',
    );
  }
  if (!parsed.success)
    throw new Error(
      input.kind === 'document'
        ? 'A document needs Markdown content.'
        : input.kind === 'checklist'
          ? 'A checklist needs at least one item.'
          : input.kind === 'html'
            ? 'An interactive page needs the whole page, in `html`.'
            : input.kind === 'diagram'
              ? 'A diagram needs its Mermaid source, in `mermaid`.'
              : 'A table needs columns and at least one row.',
    );
  if (parsed.data.kind === 'html') {
    const external =
      /<(?:script|link|iframe|img|source|audio|video)\b[^>]*\s(?:src|href)\s*=\s*["']?https?:|@import\s+(?:url\()?["']?https?:|\bimport\s[^;]*["']https?:|\bfetch\(\s*["']https?:/i.exec(
        parsed.data.html,
      );
    if (external)
      throw new Error(
        `Interactive pages have no network, so ${external[0].slice(0, 40)}… never loads and the ` +
          'page comes up empty. Write the code inline instead: no CDN libraries (Three.js, React, ' +
          'D3), no web fonts, no fetch.',
      );
  }
  return parsed.data;
}

const artifactFolder = {
  document: 'Reports',
  checklist: 'Checklists',
  table: 'Tables',
  diagram: 'Diagrams',
  view: 'Views',
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
  /** `path` (relative to the workspace) only when a rename moved the file. */
  update(record: {
    id: string;
    title: string;
    content: unknown;
    bytes: number;
    updatedAt: number;
    path?: string;
  }): void;
  remove(id: string): void;
}

export interface WorkspaceDependencies {
  /** Trusted, host-chosen workspace root (Documents/Edi). Never taken from model input. */
  directory: () => string;
  /**
   * Content was shown, by the run named in `from`. The id of updated or reopened content is the
   * content's own, so the run is the only way to tell who is showing it: the person's
   * conversation, or a background task that must stay quiet.
   */
  shown(
    artifact: ArtifactSummary,
    /** `opened`: the person asked to open something that exists, so it opens, not previews. */
    from: { runId: string; opened?: boolean },
  ): void | Promise<void>;
  artifacts: ArtifactStore;
  notes: { store: NoteStore; directory: () => string };
  /** Move a file to the system Trash (recoverable), never unlink it. */
  trash(path: string): Promise<void>;
  /** Past conversations, searched alongside the workspace; absent in hosts without history. */
  conversations?: {
    search(
      query: string,
      options: { limit: number; after?: number; before?: number },
    ): { id: string; title: string; at: number; excerpt: string }[];
  };
  /**
   * Write an item as a file to hand to someone (PDF, Markdown, CSV, pictures) into
   * Documents/Edi/Exports under a new name; absent in hosts that cannot draw PDFs.
   */
  exportItem?(
    ref: ArtifactRef,
    format: ExportFormat,
  ): Promise<{ path: string; name: string; bytes: number }>;
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

/**
 * What is in a generated item's file when the person has changed it by hand; null when the file
 * is as Edi wrote it, or is gone. Edi's stored content is what it draws and updates from, so a
 * file edited in another app has drifted from it: that must be noticed before the file is
 * written again, and it is the person's version that should be read.
 */
async function handEdits(
  deps: Pick<WorkspaceDependencies, 'directory'>,
  record: WorkspaceArtifact,
): Promise<{ path: string; text: string } | null> {
  const path = artifactFilePath(deps.directory, record.path);
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch {
    return null;
  }
  const same = (value: string) => value.replace(/\r\n/g, '\n').trimEnd();
  return same(text) === same(artifactExport(contentOf(record)).file) ? null : { path, text };
}

/**
 * Keep the person's hand-edited version beside the file before Edi writes over it, as
 * "<name> (your edits).<ext>" (numbered when that exists). Returns the copy's name.
 */
async function keepHandEdits(path: string) {
  const extension = extname(path);
  const base = basename(path, extension);
  for (let n = 1; n <= 100; n++) {
    const copy = join(dirname(path), `${base} (your edits${n === 1 ? '' : ` ${n}`})${extension}`);
    try {
      await access(copy);
    } catch {
      await copyFile(path, copy);
      return basename(copy);
    }
  }
  throw new Error('Too many kept copies of this file. Tidy the folder, then try again.');
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

/** Write a new file under the first free `slug.ext`, `slug-2.ext`… in `folder`; never replaces. */
async function writeFree(folder: string, slug: string, extension: string, body: string) {
  await mkdir(folder, { recursive: true });
  const temp = join(folder, `.edi-${randomUUID()}.tmp`);
  await writeFile(temp, body, { flag: 'wx', mode: 0o644 });
  try {
    for (let n = 1; n <= 100; n++) {
      const path = join(folder, `${slug}${n === 1 ? '' : `-${n}`}${extension}`);
      try {
        await link(temp, path);
        return path;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      }
    }
  } finally {
    await unlink(temp).catch(() => {});
  }
  throw new Error('Too many items share this title. Try a different title.');
}

/** Does this file's name already come from `slug` (`slug.md`, `slug-2.md`)? */
const namedFor = (path: string, slug: string) =>
  new RegExp(`^${slug.replace(/[-]/g, '\\-')}(-\\d{1,3})?$`).test(basename(path, extname(path)));

/**
 * Give a workspace item a new title, and its file a matching name in the same folder. The Library's
 * own Rename; the new file is written before the old one goes, so nothing is ever half-renamed.
 */
export async function renameWorkspaceItem(deps: WorkspaceDependencies, id: string, raw: string) {
  const title = raw.replace(/\s+/g, ' ').trim();
  if (!title || title.length > 120) throw new Error('A title needs 1 to 120 characters.');
  const slug = slugify(title) || 'untitled';
  const record = deps.artifacts.get(id);
  if (record) {
    const old = artifactFilePath(deps.directory, record.path);
    const content = { ...contentOf(record), title };
    const { file } = artifactExport(content);
    // A rename rewrites the file from Edi's copy; their own edits are kept beside it first.
    if (await handEdits(deps, record)) await keepHandEdits(old);
    const path = namedFor(old, slug)
      ? (await replaceFile(old, file), old)
      : await writeFree(dirname(old), slug, extname(old), file);
    try {
      deps.artifacts.update({
        id,
        title,
        content,
        bytes: Buffer.byteLength(file),
        // A rename isn't a change to the content, so the item keeps its place in the Library.
        updatedAt: record.updatedAt,
        path: relative(resolve(deps.directory()), path),
      });
    } catch (error) {
      if (path !== old) await unlink(path).catch(() => {});
      throw error;
    }
    if (path !== old) await unlink(old).catch(() => {});
    return { kind: content.kind, title, path };
  }
  const { note, markdown } = await readLibraryNote(deps.notes.store, deps.notes.directory, id);
  const { folder, path: old } = locate(deps.notes.store, deps.notes.directory, id);
  // The note's own heading is its title; everything after it stays exactly as it was.
  const body = markdown.replace(/^\s*#[^\n]*\n+/, '').replace(/\n+$/, '');
  if (namedFor(old, slug))
    await replaceNote(deps.notes.store, deps.notes.directory, { id, title, body });
  else {
    const content = noteContent(title, body);
    const path = await freePath(folder, slug);
    await writeFile(path, content, { flag: 'wx', mode: 0o644 });
    try {
      deps.notes.store.update({ id, title, bytes: Buffer.byteLength(content), path });
    } catch (error) {
      await unlink(path).catch(() => {});
      throw error;
    }
    await unlink(old).catch(() => {});
    return { kind: 'note' as const, title, path, previous: note.title };
  }
  return { kind: 'note' as const, title, path: old, previous: note.title };
}

/** Full text of a workspace item, for the model to read. */
export async function readWorkspaceItem(deps: WorkspaceDependencies, id: string) {
  const record = deps.artifacts.get(id);
  if (record) {
    const content = contentOf(record);
    const edited = await handEdits(deps, record);
    return {
      id,
      kind: content.kind,
      title: content.title,
      // Their file as it is now, when they have changed it since Edi wrote it.
      text: (edited?.text ?? artifactExport(content).copy).slice(0, MAX_READ_CHARS),
      ...(edited
        ? {
            note:
              'The user edited this file by hand; this is their version. Keep their changes ' +
              'in anything you write back.',
          }
        : {}),
    };
  }
  const { note, markdown } = await readLibraryNote(deps.notes.store, deps.notes.directory, id);
  return { id, kind: 'note' as const, title: note.title, text: markdown.slice(0, MAX_READ_CHARS) };
}

/** Every query word must appear in the title or content; newest first. */
export async function searchWorkspace(
  deps: WorkspaceDependencies,
  options: {
    query?: string;
    kind?: WorkspaceKind | 'note';
    limit: number;
    after?: number;
    before?: number;
  },
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
    .filter(item => item.at >= (options.after ?? 0) && item.at <= (options.before ?? Infinity))
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

/**
 * Tick or untick one item of a checklist the person is looking at. It is their own mark on
 * their own list, so it needs no review: the stored checklist and its file are both updated.
 */
export async function setChecklistItem(
  deps: Pick<WorkspaceDependencies, 'artifacts' | 'directory' | 'now'>,
  id: string,
  index: number,
  done: boolean,
) {
  const record = deps.artifacts.get(id);
  if (!record) throw new Error('That checklist is no longer in the workspace.');
  const content = contentOf(record);
  if (content.kind !== 'checklist') throw new Error('Only a checklist has items to tick.');
  if (!content.items[index]) throw new Error('That item is no longer on the list.');
  const next: ArtifactContent = {
    ...content,
    items: content.items.map((item, at) => (at === index ? { ...item, done } : item)),
  };
  const { file } = artifactExport(next);
  const path = artifactFilePath(deps.directory, record.path);
  if (await handEdits(deps, record)) await keepHandEdits(path);
  await replaceFile(path, file);
  deps.artifacts.update({
    id,
    title: next.title,
    content: next,
    bytes: Buffer.byteLength(file),
    updatedAt: (deps.now ?? Date.now)(),
  });
  return next;
}

/** Generated content is both shown and placed in Edi's workspace as one operation. */
export function workspaceCapabilities(deps: WorkspaceDependencies) {
  const now = deps.now ?? Date.now;
  const show = defineCapability({
    id: 'workspace.show',
    title: 'Show content',
    description:
      'Display content in Edi’s card instead of putting it in the reply: a document (Markdown), a ' +
      'checklist, a table, or a diagram (Mermaid) for flows, architecture, sequences and timelines. Use whenever the user asks to see, show, draft, write, list, plan, ' +
      'compare or organize something, and for anything longer than a few sentences. After showing ' +
      'it, reply in one short sentence and do not repeat or read out the content. Edi automatically ' +
      'places the generated file under Documents/Edi/Artifacts; do not ask the user to save it.',
    effect: 'read',
    timeoutMs: 5_000,
    input: showInput,
    prepare(input, { callId, runId }) {
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
          await deps.shown(artifact, { runId });
          return {
            summary: `Showed “${content.title}” and created ${file.relativePath}.`,
            output: {
              shown: true,
              // So "open it" a moment later needs no search for what was just made.
              id: callId,
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
      'checklists, tables and interactive pages, plus past conversations that mention the words. ' +
      'Matches every word of the query in the title or content; with no query, lists the most ' +
      'recent items. For “last week” or “in March”, pass after/before dates. Returns ids for ' +
      'workspace.read, workspace.update, workspace.delete and (for notes) notes.show; for a ' +
      'conversation, tell the user its title and when, and quote what was said.',
    effect: 'read',
    timeoutMs: 10_000,
    input: z
      .object({
        query: z.string().trim().max(200).optional().describe('Words to look for'),
        kind: z
          .enum(['note', 'document', 'checklist', 'table', 'diagram', 'view', 'html'])
          .optional()
          .describe('Only this kind'),
        limit: z.number().int().min(1).max(50).optional().describe('At most this many (20)'),
        after: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional()
          .describe('Only from this date on (YYYY-MM-DD, local)'),
        before: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional()
          .describe('Only up to and including this date (YYYY-MM-DD, local)'),
      })
      .strict(),
    prepare({ query, kind, limit, after, before }) {
      return {
        preview: {
          title: 'Search the workspace',
          action: 'Search',
          summary: query ? `Search for “${query}”.` : 'List recent items.',
          fields: [],
        },
        async execute() {
          const day = (value: string | undefined, end: boolean) => {
            if (!value) return undefined;
            const [year, month, date] = value.split('-').map(Number) as [number, number, number];
            return end
              ? new Date(year, month - 1, date, 23, 59, 59, 999).getTime()
              : new Date(year, month - 1, date).getTime();
          };
          const range = { after: day(after, false), before: day(before, true) };
          const results = await searchWorkspace(deps, {
            query,
            kind,
            limit: limit ?? 20,
            ...range,
          });
          const conversations =
            query && !kind && deps.conversations
              ? deps.conversations.search(query, { limit: 5, ...range }).map(match => ({
                  conversation: match.title,
                  when: new Date(match.at).toISOString(),
                  excerpt: match.excerpt,
                }))
              : [];
          const found = results.length + conversations.length;
          return {
            summary:
              (results.length === 1 ? 'Found 1 item' : `Found ${results.length} items`) +
              (conversations.length
                ? ` and ${conversations.length} ${conversations.length === 1 ? 'conversation' : 'conversations'}.`
                : '.'),
            output: { results, ...(conversations.length ? { conversations } : {}), found },
          };
        },
      };
    },
  });

  const open = defineCapability({
    id: 'workspace.open',
    title: 'Open saved content',
    description:
      'Show the user something that already exists in the workspace: a document, checklist, ' +
      'table, diagram, view or interactive page, by its id from workspace.search. Use this when ' +
      'they ask to see or open something made before. Never call workspace.show for it: that ' +
      'makes a second copy. For a saved note use notes.show.',
    effect: 'read',
    timeoutMs: 5_000,
    input: z.object({ id: itemId }).strict(),
    prepare({ id }, { runId }) {
      const record = deps.artifacts.get(id);
      if (!record)
        throw new Error(
          deps.notes.store.get(id)
            ? 'That item is a saved note: show it with notes_show.'
            : 'Edi has nothing in its workspace with that id. Search the workspace first.',
        );
      const content = contentOf(record);
      return {
        preview: {
          title: 'Open saved content',
          action: 'Open',
          summary: `Open “${content.title}”.`,
          fields: [],
        },
        async execute() {
          await deps.shown(
            {
              id: record.id,
              kind: content.kind,
              title: content.title,
              preview: artifactPreview(content),
            },
            { runId, opened: true },
          );
          return {
            summary: `Opened “${content.title}”.`,
            output: { shown: true, id: record.id, kind: content.kind, title: content.title },
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
    title: 'Update workspace content',
    description:
      'Replace a workspace item with a new version, keeping its place: a generated document, ' +
      'checklist, table, diagram, view or interactive page (same kind; for a diagram, the whole new ' +
      'Mermaid), or a saved note (kind note, with the ' +
      'new title and the complete Markdown). Pass its id from workspace.search. The user reviews ' +
      'the change first, and Edi opens the result.',
    effect: 'write',
    timeoutMs: 10_000,
    input: showInput.extend({
      id: itemId,
      kind: z
        .enum(['document', 'checklist', 'table', 'diagram', 'view', 'html', 'note'])
        .describe('The item’s kind, unchanged; note for a saved note (use markdown)'),
    }),
    prepare(input, { callId, runId }) {
      const record = deps.artifacts.get(input.id);
      if (!record) {
        const note = deps.notes.store.get(input.id);
        if (!note)
          throw new Error(
            'Edi has nothing in its workspace with that id. Search the workspace first.',
          );
        return updateNote(note.title, input, callId, runId);
      }
      if (input.kind === 'note') throw new Error(`That item is a ${record.kind}, not a note.`);
      const { id, ...fields } = input;
      const content = toArtifactContent({ ...fields, kind: input.kind });
      if (content.kind !== record.kind)
        throw new Error(
          `That item is a ${record.kind}. Keep the kind, or show new content instead.`,
        );
      const path = artifactFilePath(deps.directory, record.path);
      // Bad input is still refused at once (above); only looking at the file takes a moment.
      return handEdits(deps, record).then(edited => ({
        preview: {
          title: 'Update content',
          action: 'Update',
          summary: `Replace “${record.title}” with a new version.`,
          fields: [
            { label: 'Title', value: content.title },
            { label: 'Location', value: path },
            // Said before they approve: this file is no longer as Edi left it.
            ...(edited
              ? [
                  {
                    label: 'Your edits',
                    value:
                      'You changed this file by hand. Your version is kept beside it as a ' +
                      'copy named “(your edits)”.',
                  },
                ]
              : []),
          ],
        },
        async execute() {
          const { file } = artifactExport(content);
          // Checked again now: they may have edited it while the review was waiting.
          const kept = (await handEdits(deps, record)) ? await keepHandEdits(path) : null;
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
          await deps.shown(
            {
              id,
              kind: content.kind,
              title: content.title,
              preview: artifactPreview(content),
            },
            { runId },
          );
          return {
            summary:
              `Updated “${content.title}” at ${path}.` +
              (kept ? ` The user’s own edits were kept beside it as “${kept}”.` : ''),
            output: { id, path, ...(kept ? { yourEditsKeptAs: kept } : {}) },
          };
        },
      }));
    },
  });

  /** A saved note keeps its file; only its title and Markdown change, after review. */
  function updateNote(
    previousTitle: string,
    input: { id: string; kind: string; title: string; markdown?: string },
    callId: string,
    runId: string,
  ) {
    if (input.kind !== 'note' && input.kind !== 'document')
      throw new Error('That item is a note. Pass kind note with its new Markdown.');
    const body = input.markdown?.trim();
    if (!body) throw new Error('A note needs its complete new Markdown.');
    const { path } = locate(deps.notes.store, deps.notes.directory, input.id);
    const content = noteContent(input.title, body);
    return {
      preview: {
        title: 'Edit a note',
        action: 'Update Note',
        summary: 'Replace this note’s content. The file path stays the same.',
        fields: [
          {
            label: 'Title',
            value:
              input.title === previousTitle ? input.title : `${previousTitle} → ${input.title}`,
          },
          { label: 'Location', value: path },
          { label: 'Size', value: formatBytes(Buffer.byteLength(content)) },
        ],
        body: content.slice(0, 4000),
      },
      async execute() {
        const saved = await replaceNote(deps.notes.store, deps.notes.directory, {
          id: input.id,
          title: input.title,
          body,
        });
        await deps.shown(
          {
            id: callId,
            kind: 'note',
            title: input.title,
            preview: artifactPreview({ kind: 'note', markdown: saved.content }),
            noteId: input.id,
          },
          { runId },
        );
        return {
          summary: `Updated “${input.title}” at ${saved.path}.`,
          output: { id: input.id, path: saved.path },
        };
      },
    };
  }

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

  const exportItem = deps.exportItem;
  const exported = defineCapability({
    id: 'workspace.export',
    title: 'Export from the workspace',
    description:
      'Export a workspace item as a file the user can send or print, into Documents/Edi/Exports: ' +
      'documents, notes and checklists as pdf or md; tables as csv, pdf or md; diagrams as png, ' +
      'svg, pdf or mmd; interactive pages as html. Use when the user asks to export, save as or ' +
      'send as a PDF, spreadsheet or image. Pass its id from workspace.search (or the item just ' +
      'shown). Never replaces an earlier export. Tell the user the file name; do not attach it.',
    // Like show: it only adds a new file inside Edi's own workspace and touches nothing else.
    effect: 'read',
    timeoutMs: 45_000,
    input: z
      .object({
        id: itemId,
        format: exportFormatSchema.describe('pdf, md, csv, png, svg, mmd or html'),
      })
      .strict(),
    prepare({ id, format }) {
      if (!exportItem) throw new Error('Exporting isn’t available here.');
      const target = locateWorkspaceItem(deps, id);
      const formats = exportFormats[target.kind];
      if (!formats.includes(format))
        throw new Error(
          `A ${target.kind} exports as ${formats.join(', ')}, not ${format}. Pick one of those.`,
        );
      const ref: ArtifactRef = target.kind === 'note' ? { noteId: id } : { callId: id };
      return {
        preview: {
          title: 'Export',
          action: 'Export',
          summary: `Export “${target.title}” as ${exportFormatLabel[format]}.`,
          fields: [],
        },
        async execute() {
          const file = await exportItem(ref, format);
          return {
            summary: `Exported “${target.title}” as ${file.name} in Documents/Edi/Exports.`,
            output: { name: file.name, path: file.path, bytes: file.bytes },
          };
        },
      };
    },
  });

  // New tools go last: callers and tests take the earlier ones by position.
  return [show, search, read, update, remove, ...(exportItem ? [exported] : []), open] as const;
}
