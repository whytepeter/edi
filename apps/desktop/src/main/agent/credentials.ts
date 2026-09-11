import { app, safeStorage } from 'electron';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { modelIdSchema } from '@edi/contracts';

/** The OpenRouter key lives only here, encrypted at rest with the macOS keychain. */
export class OpenRouterCredentials {
  apiKey = '';
  model = '';

  get configured() {
    return this.apiKey.length > 0;
  }

  private get path() {
    return join(app.getPath('userData'), 'openrouter.enc');
  }

  async load() {
    try {
      if (!safeStorage.isEncryptionAvailable()) return;
      const saved = JSON.parse(safeStorage.decryptString(await readFile(this.path)));
      const model = modelIdSchema.parse(saved.model);
      if (typeof saved.apiKey !== 'string' || saved.apiKey.length < 10) return;
      this.apiKey = saved.apiKey;
      this.model = model;
    } catch {
      // Missing or locked credentials require setup again.
    }
  }

  async save(apiKey: string, model: string) {
    const insecure =
      process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text';
    if (!safeStorage.isEncryptionAvailable() || insecure) {
      throw new Error('Secure credential storage is unavailable.');
    }
    const encrypted = safeStorage.encryptString(JSON.stringify({ apiKey, model }));
    await mkdir(app.getPath('userData'), { recursive: true });
    await writeFile(`${this.path}.tmp`, encrypted, { mode: 0o600 });
    await rename(`${this.path}.tmp`, this.path);
    this.apiKey = apiKey;
    this.model = model;
  }

  async clear() {
    await unlink(this.path).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
    });
    this.apiKey = '';
    this.model = '';
  }
}
