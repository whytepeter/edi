import { randomUUID } from 'node:crypto';
import { access, link, mkdir, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { z } from 'zod';
import { defineCapability, OutcomeUnknownError } from '../types';

export interface NoteStore {
  add(note: {
    id: string;
    title: string;
    path: string;
    bytes: number;
    toolCallId: string | null;
    createdAt: number;
  }): void;
  list(limit: number): { title: string; path: string; createdAt: number }[];
}

interface NotesDependencies {
  /** Trusted, host-chosen folder. Never taken from model input. */
  directory: () => string;
  store: NoteStore;
  now?: () => number;
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

export function notesCapabilities({ directory, store, now = Date.now }: NotesDependencies) {
  const save = defineCapability({
    id: 'notes.save',
    title: 'Save a note',
    description:
      'Save a new Markdown note to the user’s Edi Notes folder. The user reviews the exact file ' +
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
      const content = `# ${title}\n\n${body}\n`;
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
          await mkdir(folder, { recursive: true });
          // Write a private temp file, then hard-link it into place: `link` fails if
          // the name was taken since review, and the note appears whole or not at all.
          const temp = join(folder, `.edi-${randomUUID()}.tmp`);
          await writeFile(temp, content, { flag: 'wx', mode: 0o644 });
          try {
            await link(temp, path);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
              throw new Error(
                'A file with that name appeared after you approved. Nothing was replaced.',
                { cause: error },
              );
            }
            throw error;
          } finally {
            await unlink(temp).catch(() => {});
          }
          try {
            store.add({
              id: randomUUID(),
              title,
              path,
              bytes,
              toolCallId: callId,
              createdAt: now(),
            });
          } catch {
            // The file exists; failing to index it must not report the write as failed.
            throw new OutcomeUnknownError(
              `Saved ${path}, but Edi could not record it in its history.`,
            );
          }
          return { summary: `Saved “${title}” to ${path}`, output: { path } };
        },
      };
    },
  });

  const list = defineCapability({
    id: 'notes.list',
    title: 'Look through notes',
    description:
      'List notes Edi has saved for the user, newest first, with their titles and file paths.',
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

  return [save, list] as const;
}
