import { app, dialog, shell, type BrowserWindow } from 'electron';
import { open, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { z } from 'zod';
import type { FileRoot } from '@edi/capabilities';
import type { FileAccess, FileAccessAction, FolderAccessStatus } from '@edi/contracts';

const settingsUrls = {
  files: 'x-apple.systempreferences:com.apple.preference.security?Privacy_FilesAndFolders',
  'full-disk': 'x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles',
} as const;

const stored = z.object({
  /** Last known answer per folder path; absent means not checked yet. */
  access: z.record(z.string(), z.enum(['allowed', 'off'])).default({}),
  added: z.array(z.string()).max(30).default([]),
});

const denied = (error: unknown) =>
  ['EPERM', 'EACCES'].includes(String((error as { code?: unknown })?.code));

/**
 * The person's folders for Edi's file tools. Protected folders (Desktop, Documents, Downloads)
 * are only touched when the person asks or a file tool needs them, because touching one makes
 * macOS prompt. Full Disk Access is detected by reading a file only it unlocks.
 */
export class FileAccessManager {
  private readonly home = homedir();
  private readonly file = join(app.getPath('userData'), 'file-access.json');
  private state: z.infer<typeof stored> = { access: {}, added: [] };
  private fullDisk = false;

  constructor(private readonly workspace: () => string) {}

  async load() {
    try {
      this.state = stored.parse(JSON.parse(await readFile(this.file, 'utf8')));
    } catch {
      this.state = { access: {}, added: [] };
    }
    await this.refresh();
  }

  private save() {
    return writeFile(this.file, JSON.stringify(this.state, null, 2), { mode: 0o600 }).catch(
      () => {},
    );
  }

  private builtIn() {
    return [
      { id: 'desktop', kind: 'desktop' as const, name: 'Desktop', path: app.getPath('desktop') },
      {
        id: 'documents',
        kind: 'documents' as const,
        name: 'Documents',
        path: app.getPath('documents'),
      },
      {
        id: 'downloads',
        kind: 'downloads' as const,
        name: 'Downloads',
        path: app.getPath('downloads'),
      },
    ];
  }

  private folders() {
    return [
      ...this.builtIn(),
      ...this.state.added.map((path, index) => ({
        id: `added-${index}`,
        kind: 'added' as const,
        name: basename(path) || path,
        path,
      })),
    ];
  }

  /** Re-probe without prompting: Full Disk Access, and folders already known or unlocked by it. */
  async refresh() {
    this.fullDisk = await this.probeFullDisk();
    // Edi already uses Documents › Edi, so reading it cannot prompt again.
    const documents = app.getPath('documents');
    if (!this.state.access[documents]) {
      const ok = await readdir(this.workspace()).then(
        () => true,
        () => false,
      );
      if (ok) this.state.access[documents] = 'allowed';
    }
    for (const folder of this.folders()) {
      const known = this.state.access[folder.path];
      if (!known && !this.fullDisk) continue;
      const result = await this.touch(folder.path);
      if (result !== 'missing') this.state.access[folder.path] = result;
    }
    await this.save();
  }

  private async probeFullDisk() {
    for (const path of [
      join(this.home, 'Library/Application Support/com.apple.TCC/TCC.db'),
      join(this.home, 'Library/Safari/Bookmarks.plist'),
    ]) {
      try {
        const handle = await open(path, 'r');
        await handle.close();
        return true;
      } catch (error) {
        if (denied(error)) return false;
      }
    }
    return false;
  }

  private async touch(path: string): Promise<'allowed' | 'off' | 'missing'> {
    try {
      await readdir(path);
      return 'allowed';
    } catch (error) {
      return denied(error) ? 'off' : 'missing';
    }
  }

  private status(path: string): FolderAccessStatus {
    return this.state.access[path] ?? 'not-checked';
  }

  snapshot(): FileAccess {
    const shown = (path: string) =>
      path.startsWith(this.home + '/') ? `~${path.slice(this.home.length)}` : path;
    return {
      folders: this.folders().map(folder => ({
        id: folder.id,
        kind: folder.kind,
        name: folder.name.slice(0, 120),
        path: shown(folder.path).slice(0, 1024),
        status: this.status(folder.path),
      })),
      fullDiskAccess: this.fullDisk,
    };
  }

  /** Roots for the file tools; the home folder too while Full Disk Access is on. */
  roots(): FileRoot[] {
    const roots: FileRoot[] = this.folders().map(folder => ({
      name: folder.name,
      path: folder.path,
      access: (this.state.access[folder.path] ?? 'not-checked') as FileRoot['access'],
    }));
    if (this.fullDisk) roots.push({ name: 'your home folder', path: this.home, access: 'allowed' });
    return roots;
  }

  /** A file tool touched a folder; remember what macOS said. */
  record(root: FileRoot, allowed: boolean) {
    if (root.path === this.home) return;
    this.state.access[root.path] = allowed ? 'allowed' : 'off';
    void this.save();
  }

  async act(action: FileAccessAction, parent: BrowserWindow | null): Promise<FileAccess> {
    if (action.type === 'open-settings') {
      await shell.openExternal(settingsUrls[action.pane]);
    } else if (action.type === 'check') {
      const folder = this.folders().find(entry => entry.id === action.id);
      if (!folder) throw new Error('That folder is no longer listed.');
      const result = await this.touch(folder.path);
      if (result === 'missing') delete this.state.access[folder.path];
      else this.state.access[folder.path] = result;
      await this.save();
    } else if (action.type === 'add') {
      const options = {
        title: 'Choose a folder Edi can use',
        buttonLabel: 'Allow Edi',
        properties: ['openDirectory', 'createDirectory'] as ('openDirectory' | 'createDirectory')[],
      };
      const picked = parent
        ? await dialog.showOpenDialog(parent, options)
        : await dialog.showOpenDialog(options);
      const path = picked.filePaths[0];
      if (!picked.canceled && path && (await stat(path)).isDirectory()) {
        if (path === this.home || path === '/')
          throw new Error('Choose a specific folder, not your whole home folder or disk.');
        if (!this.folders().some(folder => folder.path === path)) this.state.added.push(path);
        // Chosen in the open panel, so macOS already allows it.
        this.state.access[path] = 'allowed';
        await this.save();
      }
    } else if (action.type === 'remove') {
      const folder = this.folders().find(entry => entry.id === action.id);
      if (folder?.kind === 'added') {
        this.state.added = this.state.added.filter(path => path !== folder.path);
        delete this.state.access[folder.path];
        await this.save();
      }
    }
    await this.refresh();
    return this.snapshot();
  }
}
