import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  characterIdSchema,
  checkCharacter,
  defaultCharacterId,
  type CharacterDescriptor,
  type CharacterInspection,
} from '@edi/contracts';
import { builtInCharacters } from '../../shared/built-in-characters';
import { PackageError, readCharacterPackage, type PackageFiles } from './package-file';

/** A checked package waits this long for the person to press Install. */
const PENDING_MS = 10 * 60_000;

/**
 * Every character Edi can show: the built-in ones and packages the person installed. Installed
 * packages live as `<userData>/characters/<id>/{character.json,art.svg}` and are checked again
 * on every launch, so a file edited by hand can never skip the sanitizer.
 */
export class CharacterLibrary {
  private installed = new Map<string, CharacterDescriptor>();
  private pending = new Map<string, { files: PackageFiles; id: string; expires: number }>();
  private readonly listeners = new Set<(characters: CharacterDescriptor[]) => void>();

  constructor(private readonly folder: () => string) {}

  async load() {
    let names: string[];
    try {
      names = await readdir(this.folder());
    } catch {
      return;
    }
    for (const name of names) {
      if (!characterIdSchema.safeParse(name).success) continue;
      try {
        const directory = join(this.folder(), name);
        const files = {
          manifest: await readFile(join(directory, 'character.json'), 'utf8'),
          art: await readFile(join(directory, 'art.svg'), 'utf8'),
        };
        const { descriptor } = checkCharacter(files);
        if (descriptor && descriptor.manifest.id === name) this.installed.set(name, descriptor);
      } catch {
        // An unreadable package is skipped; the rest still load.
      }
    }
  }

  list(): CharacterDescriptor[] {
    const installed = [...this.installed.values()].sort((a, b) =>
      a.manifest.name.localeCompare(b.manifest.name),
    );
    return [...builtInCharacters, ...installed];
  }

  has(id: string) {
    return this.installed.has(id) || builtInCharacters.some(entry => entry.manifest.id === id);
  }

  /** The character, or Edi when it is not installed (removed, or from another Mac). */
  get(id: string): CharacterDescriptor {
    return (
      builtInCharacters.find(entry => entry.manifest.id === id) ??
      this.installed.get(id) ??
      builtInCharacters.find(entry => entry.manifest.id === defaultCharacterId)!
    );
  }

  onChange(listener: (characters: CharacterDescriptor[]) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Check package bytes without installing. Returns a token to install with when it passes. */
  inspect(bytes: Uint8Array, fileName: string): CharacterInspection {
    const token = randomUUID();
    const now = Date.now();
    for (const [key, entry] of this.pending) if (entry.expires < now) this.pending.delete(key);
    let files: PackageFiles;
    try {
      files = readCharacterPackage(bytes);
    } catch (error) {
      const message =
        error instanceof PackageError ? error.message : 'This file could not be read.';
      return {
        token,
        fileName,
        character: null,
        manifest: null,
        problems: [{ level: 'error', message }],
        replaces: null,
      };
    }
    const { descriptor, manifest, problems } = checkCharacter(files);
    if (descriptor)
      this.pending.set(token, { files, id: descriptor.manifest.id, expires: now + PENDING_MS });
    return {
      token,
      fileName,
      character: descriptor,
      manifest: manifest
        ? { id: manifest.id, name: manifest.name, version: manifest.version }
        : null,
      problems: problems.slice(0, 64),
      replaces: manifest ? (this.installed.get(manifest.id)?.manifest.version ?? null) : null,
    };
  }

  async install(token: string): Promise<CharacterDescriptor> {
    const entry = this.pending.get(token);
    this.pending.delete(token);
    if (!entry || entry.expires < Date.now())
      throw new Error('That package is no longer ready to install. Choose it again.');
    // Check once more: what is written is exactly what passed.
    const { descriptor } = checkCharacter(entry.files);
    if (!descriptor) throw new Error('That package did not pass its check.');
    const id = descriptor.manifest.id;
    const root = this.folder();
    await mkdir(root, { recursive: true });
    const staging = join(root, `.installing-${randomUUID()}`);
    await mkdir(staging);
    try {
      await writeFile(join(staging, 'character.json'), entry.files.manifest, { mode: 0o600 });
      await writeFile(join(staging, 'art.svg'), entry.files.art, { mode: 0o600 });
      await rm(join(root, id), { recursive: true, force: true });
      await rename(staging, join(root, id));
    } catch (error) {
      await rm(staging, { recursive: true, force: true });
      throw error;
    }
    this.installed.set(id, descriptor);
    this.notify();
    return descriptor;
  }

  async remove(id: string) {
    if (!this.installed.has(id)) throw new Error('Only installed characters can be removed.');
    await rm(join(this.folder(), characterIdSchema.parse(id)), { recursive: true, force: true });
    this.installed.delete(id);
    this.notify();
  }

  private notify() {
    const characters = this.list();
    for (const listener of this.listeners) listener(characters);
  }
}
