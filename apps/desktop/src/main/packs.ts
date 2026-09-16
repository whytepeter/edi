import { createHash } from 'node:crypto';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { mkdir, open, rename, rm, statfs } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/** One file of a pack, pinned by address, size and SHA-256 so nothing else can be installed. */
export interface PackFile {
  /** Where it goes, relative to Edi's models folder (the runtime looks there). */
  path: string;
  url: string;
  bytes: number;
  sha256: string;
}

export interface Pack<Id extends string> {
  id: Id;
  name: string;
  files: PackFile[];
}

/** What Settings shows for one pack: how much has arrived, and why it stopped. */
export interface PackState<Id extends string> {
  id: Id;
  name: string;
  bytes: number;
  received: number;
  state: 'missing' | 'downloading' | 'paused' | 'installed' | 'failed' | 'development';
  error?: string;
}

/** Room left on the disk after a download, so Edi never fills it to the brim. */
const SPARE_BYTES = 200 * 1024 * 1024;

interface Active {
  abort: AbortController;
  received: number;
}

/** A message meant for the person; anything else becomes a generic connection message. */
export class PackError extends Error {}

async function diskFree(dir: string) {
  const stats = await statfs(dir);
  return stats.bavail * stats.bsize;
}

const megabytes = (bytes: number) => `${Math.ceil(bytes / 1_000_000)} MB`;

/**
 * Downloads, resumes and removes packs of pinned files in Edi's own models folder. A file
 * downloads to `<name>.partial`, continues from where it stopped (HTTP Range) after Pause, a
 * dropped connection or a restart, and is renamed into place only once its size and SHA-256
 * match. What is installed is read from the disk, so the runtime and Settings always agree.
 */
export class PackDownloader<Id extends string> {
  private readonly active = new Map<Id, Active>();
  private readonly failures = new Map<Id, string>();

  constructor(
    protected readonly options: {
      /** Application Support › Edi › models. */
      dir: string;
      packs: readonly Pack<Id>[];
      /** Whether a pack is available some other way (the development cache). */
      elsewhere?: (id: Id) => boolean;
      fetch?: typeof fetch;
      freeBytes?: (dir: string) => Promise<number>;
    },
  ) {}

  private target(file: PackFile) {
    return join(this.options.dir, file.path);
  }

  /** The folder a pack's files live in, for a runtime that needs the path. */
  path(relative: string) {
    return join(this.options.dir, relative);
  }

  private installed(file: PackFile) {
    const target = this.target(file);
    return existsSync(target) && statSync(target).size === file.bytes;
  }

  /** Whether every file of a pack is on this Mac, checked by size. */
  ready(id: Id) {
    const pack = this.options.packs.find(item => item.id === id);
    return Boolean(pack?.files.every(file => this.installed(file)));
  }

  private partialBytes(file: PackFile) {
    const partial = `${this.target(file)}.partial`;
    return existsSync(partial) ? Math.min(statSync(partial).size, file.bytes) : 0;
  }

  status(): PackState<Id>[] {
    return this.options.packs.map(pack => {
      const bytes = pack.files.reduce((sum, file) => sum + file.bytes, 0);
      const done = pack.files.filter(file => this.installed(file));
      const base = { id: pack.id, name: pack.name, bytes };
      const active = this.active.get(pack.id);
      if (done.length === pack.files.length)
        return { ...base, state: 'installed' as const, received: bytes };
      const received =
        done.reduce((sum, file) => sum + file.bytes, 0) +
        pack.files
          .filter(file => !this.installed(file))
          .reduce((sum, file) => sum + this.partialBytes(file), 0);
      if (active)
        return {
          ...base,
          state: 'downloading' as const,
          received: Math.max(received, active.received),
        };
      const error = this.failures.get(pack.id);
      if (error) return { ...base, state: 'failed' as const, received, error };
      if (received > 0) return { ...base, state: 'paused' as const, received };
      if (this.options.elsewhere?.(pack.id))
        return { ...base, state: 'development' as const, received: 0 };
      return { ...base, state: 'missing' as const, received: 0 };
    });
  }

  /** Start or resume a pack. Resolves when it is installed, paused or failed. */
  async download(id: Id) {
    const pack = this.options.packs.find(item => item.id === id);
    if (!pack || this.active.has(id)) return;
    const active: Active = { abort: new AbortController(), received: 0 };
    this.active.set(id, active);
    this.failures.delete(id);
    try {
      const remaining = pack.files
        .filter(file => !this.installed(file))
        .reduce((sum, file) => sum + file.bytes - this.partialBytes(file), 0);
      await mkdir(this.options.dir, { recursive: true });
      const free = await (this.options.freeBytes ?? diskFree)(this.options.dir);
      if (free < remaining + SPARE_BYTES)
        throw new PackError(`Needs ${megabytes(remaining + SPARE_BYTES)} free on this Mac.`);
      let before = 0;
      for (const file of pack.files) {
        if (!this.installed(file))
          await this.fetchFile(file, active, got => (active.received = before + got));
        before += file.bytes;
        active.received = before;
      }
    } catch (error) {
      // Pause keeps what arrived; it continues from there next time.
      if (!active.abort.signal.aborted)
        this.failures.set(
          id,
          error instanceof PackError
            ? error.message
            : 'The download stopped. Check your connection.',
        );
    } finally {
      this.active.delete(id);
    }
  }

  /** Stop a download and keep what arrived. */
  pause(id: Id) {
    this.active.get(id)?.abort.abort();
  }

  /** Delete a pack's files, finished or not. Downloading it again starts over. */
  async remove(id: Id) {
    const pack = this.options.packs.find(item => item.id === id);
    if (!pack) return;
    this.active.get(id)?.abort.abort();
    this.failures.delete(id);
    for (const file of pack.files) {
      await rm(this.target(file), { force: true });
      await rm(`${this.target(file)}.partial`, { force: true });
    }
  }

  private async fetchFile(
    file: PackFile,
    active: Active,
    progress: (bytes: number) => void,
  ): Promise<void> {
    const target = this.target(file);
    const partial = `${target}.partial`;
    await mkdir(dirname(target), { recursive: true });
    const offset = this.partialBytes(file);
    const hash = createHash('sha256');
    if (offset > 0) {
      // Resuming: the checksum covers the bytes already on disk.
      for await (const chunk of createReadStream(partial, { end: offset - 1 }))
        hash.update(chunk as Buffer);
    }
    let received = offset;
    // Fetch the rest, unless it all arrived last time and was never checked (Edi quit then).
    if (offset < file.bytes) {
      const response = await (this.options.fetch ?? fetch)(file.url, {
        headers: offset > 0 ? { range: `bytes=${offset}-` } : {},
        signal: active.abort.signal,
        redirect: 'follow',
      });
      if (response.status === 200 && offset > 0) {
        // The server sent the whole file instead of the rest: start over.
        await response.body?.cancel();
        await rm(partial, { force: true });
        return this.fetchFile(file, active, progress);
      }
      if (response.status !== 200 && response.status !== 206)
        throw new PackError(`The download couldn’t start (${response.status}). Try again later.`);
      if (!response.body) throw new PackError('The download came back empty. Try again later.');
      const handle = await open(partial, offset > 0 ? 'a' : 'w');
      try {
        for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
          received += chunk.byteLength;
          if (received > file.bytes) throw new PackError('The download was larger than expected.');
          hash.update(chunk);
          await handle.write(chunk);
          progress(received);
        }
      } finally {
        await handle.close();
      }
    }
    if (received !== file.bytes || hash.digest('hex') !== file.sha256) {
      await rm(partial, { force: true });
      throw new PackError('The download didn’t check out, so it was removed. Try again.');
    }
    await rename(partial, target);
  }
}
