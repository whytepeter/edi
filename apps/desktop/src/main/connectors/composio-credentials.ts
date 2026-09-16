import { app, safeStorage } from 'electron';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Composio API key, encrypted at rest with the macOS keychain. */
export class ComposioCredentials {
  apiKey = '';

  get configured() {
    return this.apiKey.length > 0;
  }

  private get path() {
    return join(app.getPath('userData'), 'composio.enc');
  }

  async load() {
    try {
      if (!safeStorage.isEncryptionAvailable()) return;
      const saved = JSON.parse(safeStorage.decryptString(await readFile(this.path)));
      if (typeof saved.apiKey !== 'string' || saved.apiKey.length < 10) return;
      this.apiKey = saved.apiKey;
    } catch {
      // Missing or locked credentials require setup again.
    }
  }

  async save(apiKey: string) {
    const insecure =
      process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text';
    if (!safeStorage.isEncryptionAvailable() || insecure) {
      throw new Error('Secure credential storage is unavailable.');
    }
    const encrypted = safeStorage.encryptString(JSON.stringify({ apiKey }));
    await mkdir(app.getPath('userData'), { recursive: true });
    await writeFile(`${this.path}.tmp`, encrypted, { mode: 0o600 });
    await rename(`${this.path}.tmp`, this.path);
    this.apiKey = apiKey;
  }

  async clear() {
    await unlink(this.path).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
    });
    this.apiKey = '';
  }
}
