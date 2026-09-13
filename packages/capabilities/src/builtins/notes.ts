import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { access, link, mkdir, open, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { z } from 'zod';
import { artifactPreview, type ArtifactSummary } from '@edi/contracts';
import { defineCapability, OutcomeUnknownError } from '../types';

export interface ListedNote {
  id: string;
  title: string;
  path: string;
  createdAt: number;
}

export interface NoteStore {
  add(note: {
    id: string;
    title: string;
    path: string;
    bytes: number;
    toolCallId: string | null;
    createdAt: number;
  }): void;
  get(id: string): ListedNote | undefined;
  list(limit: number): ListedNote[];
  update(note: { id: string; title: string; bytes: number }): void;
  remove(id: string): void;
}

interface NotesDependencies {
  /** Trusted, host-chosen folder. Never taken from model input. */
  directory: () => string;
  store: NoteStore;
  now?: () => number;
  /** Display a note in Edi's card. */
  shown?: (artifact: ArtifactSummary) => void;
}

/** File names come only from a slug of the title, so input cannot choose a path. */
export function slugify(title: string) {
  return title
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');
}

async function exists(path: string) {
  return access(path).then(
    () => true,
    () => false,
  );
}

/** The first free `slug.md`, `slug-2.md`, … — existing notes are never overwritten. */
async function freePath(directory: string, slug: string) {
  for (let n = 1; n <= 100; n++) {
    const path = join(directory, n === 1 ? `${slug}.md` : `${slug}-${n}.md`);
    if (!(await exists(path))) return path;
  }
  throw new Error('Too many notes share this title. Try a different title.');
}

function formatBytes(bytes: number) {
  return bytes < 1024 ? `${bytes} bytes` : `${(bytes / 1024).toFixed(1)} KB`;
}

const noteId = z.string().uuid().describe('Id from notes.list or notes.read');
const MAX_NOTE_READ_BYTES = 64 * 1024;

/** A note record and its file, confined to the notes folder. Shared with workspace tools. */
export function locate(store: NoteStore, directory: () => string, id: string) {
  const note = store.get(id);
  if (!note) throw new Error('Edi has no saved note with that id. List notes first.');
  const folder = resolve(directory());
  const path = resolve(note.path);
  if (dirname(path) !== folder) {
    throw new Error('Refusing to touch a file outside the notes folder.');
  }
  return { note, folder, path };
}

function noteContent(title: string, body: string) {
  return `# ${title}\n\n${body}\n`;
}

/** Open the reviewed path without following a replacement symbolic link. */
export async function readNote(path: string) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error('That note is not a regular file. Nothing was read.');
    if (stat.size > MAX_NOTE_READ_BYTES)
      throw new Error('That note is too large for Edi to read safely.');
    return await handle.readFile('utf8');
  } finally {
    await handle.close();
  }
}

/** Read a Library note by id, confined to the notes folder. */
export async function readLibraryNote(store: NoteStore, directory: () => string, id: string) {
  const { note, path } = locate(store, directory, id);
  try {
    return { note, markdown: await readNote(path) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error('That note’s file is gone.', { cause: error });
    }
    throw error;
  }
}

/**
 * Create a new note file without replacing anything. Used by the reviewed `notes.save` and by
 * the person's own Save button, which is itself the consent.
 */
export async function writeNewNote(
  deps: { directory: () => string; store: NoteStore; now?: () => number },
  note: { title: string; body: string; toolCallId: string | null },
  /** The exact path a person reviewed; it is never swapped for another name. */
  reviewedPath?: string,
) {
  const folder = resolve(deps.directory());
  const path = reviewedPath ?? (await freePath(folder, slugify(note.title) || 'note'));
  if (dirname(path) !== folder) throw new Error('Refusing to write outside the notes folder.');
  const content = noteContent(note.title, note.body);
  const bytes = Buffer.byteLength(content);
  await mkdir(folder, { recursive: true });
  // Write a private temp file, then hard-link it into place: `link` fails if the name was
  // taken meanwhile, and the note appears whole or not at all.
  const temp = join(folder, `.edi-${randomUUID()}.tmp`);
  await writeFile(temp, content, { flag: 'wx', mode: 0o644 });
  try {
    await link(temp, path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new Error(
        reviewedPath
          ? 'A file with that name appeared after you approved. Nothing was replaced.'
          : 'A file with that name appeared meanwhile. Nothing was replaced.',
        { cause: error },
      );
    }
    throw error;
  } finally {
    await unlink(temp).catch(() => {});
  }
  const id = randomUUID();
  try {
    deps.store.add({
      id,
      title: note.title,
      path,
      bytes,
      toolCallId: note.toolCallId,
      createdAt: (deps.now ?? Date.now)(),
    });
  } catch {
    // The file exists; failing to index it must not report the write as failed.
    throw new OutcomeUnknownError(`Saved ${path}, but Edi could not record it in its history.`);
  }
  return { id, path };
}

export function notesCapabilities({ directory, store, now = Date.now, shown }: NotesDependencies) {
  const save = defineCapability({
    id: 'notes.save',
    title: 'Save a note',
    description:
      'Save a new Markdown note to the Notes folder in the user’s Edi workspace (Documents › Edi). The user reviews the exact file ' +
      'before anything is written. Use only when the user asks to save or write something down.',
    effect: 'write',
    timeoutMs: 10_000,
    input: z
      .object({
        title: z.string().trim().min(1).max(120).describe('Short, descriptive title'),
        body: z.string().trim().min(1).max(20_000).describe('Note content in Markdown'),
      })
      .strict(),
    async prepare({ title, body }, { callId }) {
      const folder = resolve(directory());
      const path = await freePath(folder, slugify(title) || 'note');
      // Defence in depth: the slug cannot escape, but verify the plan anyway.
      if (dirname(path) !== folder) throw new Error('Refusing to write outside the notes folder.');
      const content = noteContent(title, body);
      const bytes = Buffer.byteLength(content);
      return {
        preview: {
          title: 'Save a note',
          action: 'Save Note',
          summary: 'Edi wants to create a new Markdown file. Existing files are never replaced.',
          fields: [
            { label: 'Title', value: title },
            { label: 'Location', value: path },
            { label: 'Size', value: formatBytes(bytes) },
          ],
          body: content.slice(0, 4000),
        },
        async execute() {
          await writeNewNote({ directory, store, now }, { title, body, toolCallId: callId }, path);
          return { summary: `Saved “${title}” to ${path}`, output: { path } };
        },
      };
    },
  });

  const list = defineCapability({
    id: 'notes.list',
    title: 'Look through notes',
    description:
      'List notes Edi has saved for the user, newest first, with their ids, titles and file paths.',
    effect: 'read',
    timeoutMs: 5_000,
    input: z.object({ limit: z.number().int().min(1).max(50).default(10) }).strict(),
    prepare({ limit }) {
      return {
        preview: {
          title: 'Look through notes',
          action: 'Read Notes',
          summary: `Read up to ${limit} saved notes.`,
          fields: [],
        },
        async execute() {
          const notes = store.list(limit).map(note => ({
            id: note.id,
            title: note.title,
            path: note.path,
            savedAt: new Date(note.createdAt).toISOString(),
          }));
          const count = notes.length;
          return {
            summary: count
              ? `Found ${count} saved note${count === 1 ? '' : 's'}.`
              : 'No saved notes yet.',
            output: { notes },
          };
        },
      };
    },
  });

  const read = defineCapability({
    id: 'notes.read',
    title: 'Read a note',
    description:
      'Read the full Markdown of a note Edi has saved. Pass the id from notes.list. ' +
      'Use this before editing, or when the user asks what a note says.',
    effect: 'read',
    timeoutMs: 5_000,
    input: z.object({ id: noteId }).strict(),
    prepare({ id }) {
      const { note, path } = locate(store, directory, id);
      return {
        preview: {
          title: 'Read a note',
          action: 'Read Note',
          summary: `Read “${note.title}”.`,
          fields: [],
        },
        async execute() {
          let body: string;
          try {
            body = await readNote(path);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
              throw new Error('That note’s file is gone. Nothing was read.', { cause: error });
            }
            throw error;
          }
          return {
            summary: `Read “${note.title}”.`,
            output: { id: note.id, title: note.title, path, body },
          };
        },
      };
    },
  });

  const edit = defineCapability({
    id: 'notes.edit',
    title: 'Edit a note',
    description:
      'Replace the title and body of an existing note. The file path does not change. ' +
      'The user reviews the new content before anything is written. Pass the id from notes.list.',
    effect: 'write',
    timeoutMs: 10_000,
    input: z
      .object({
        id: noteId,
        title: z.string().trim().min(1).max(120).describe('Short, descriptive title'),
        body: z.string().trim().min(1).max(20_000).describe('Replacement content in Markdown'),
      })
      .strict(),
    prepare({ id, title, body }) {
      const { note, folder, path } = locate(store, directory, id);
      const content = noteContent(title, body);
      const bytes = Buffer.byteLength(content);
      return {
        preview: {
          title: 'Edit a note',
          action: 'Update Note',
          summary: 'Edi wants to replace this note’s content. The file path stays the same.',
          fields: [
            { label: 'Title', value: title === note.title ? title : `${note.title} → ${title}` },
            { label: 'Location', value: path },
            { label: 'Size', value: formatBytes(bytes) },
          ],
          body: content.slice(0, 4000),
        },
        async execute() {
          if (!(await exists(path))) {
            throw new Error('That note’s file is gone. Nothing was changed.');
          }
          const temp = join(folder, `.edi-${randomUUID()}.tmp`);
          await writeFile(temp, content, { flag: 'wx', mode: 0o644 });
          try {
            await rename(temp, path);
          } catch (error) {
            await unlink(temp).catch(() => {});
            throw error;
          }
          try {
            store.update({ id: note.id, title, bytes });
          } catch {
            throw new OutcomeUnknownError(
              `Updated ${path}, but Edi could not record it in its history.`,
            );
          }
          return { summary: `Updated “${title}” at ${path}`, output: { path } };
        },
      };
    },
  });

  const remove = defineCapability({
    id: 'notes.delete',
    title: 'Delete a note',
    description:
      'Delete a note Edi saved: the Markdown file and Edi’s record of it. The user reviews ' +
      'the exact file before anything is removed. Pass the id from notes.list.',
    effect: 'write',
    timeoutMs: 10_000,
    input: z.object({ id: noteId }).strict(),
    prepare({ id }) {
      const { note, path } = locate(store, directory, id);
      return {
        preview: {
          title: 'Delete a note',
          action: 'Delete Note',
          summary: 'Edi wants to permanently delete this Markdown file.',
          fields: [
            { label: 'Title', value: note.title },
            { label: 'Location', value: path },
          ],
        },
        async execute() {
          try {
            await unlink(path);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
          }
          try {
            store.remove(note.id);
          } catch {
            throw new OutcomeUnknownError(`Removed ${path}, but Edi could not update its history.`);
          }
          return { summary: `Deleted “${note.title}” at ${path}`, output: { path } };
        },
      };
    },
  });

  const show = defineCapability({
    id: 'notes.show',
    title: 'Show a note',
    description:
      'Display a saved note in Edi’s card. Use this, not notes.read, when the user asks to see, ' +
      'show, open or pull up a note. Reply in one short sentence; never read the note out.',
    effect: 'read',
    timeoutMs: 5_000,
    input: z.object({ id: noteId }).strict(),
    prepare({ id }, { callId }) {
      const { note } = locate(store, directory, id);
      return {
        preview: {
          title: 'Show a note',
          action: 'Show',
          summary: `Show “${note.title}”.`,
          fields: [],
        },
        async execute() {
          const { markdown } = await readLibraryNote(store, directory, id);
          shown?.({
            id: callId,
            kind: 'note',
            title: note.title,
            preview: artifactPreview({ kind: 'note', markdown }),
            noteId: note.id,
          });
          return {
            summary: `Showed “${note.title}” in Edi’s card.`,
            // The body stays out of the reply so it is displayed, not read aloud.
            output: { shown: true, title: note.title },
          };
        },
      };
    },
  });

  return [save, list, read, edit, remove, show] as const;
}
