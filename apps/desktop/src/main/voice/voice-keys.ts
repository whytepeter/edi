import { app, safeStorage } from 'electron';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CloudProviderId } from '@edi/contracts';

/**
 * Cartesia and ElevenLabs keys, each separate, encrypted at rest with the macOS keychain like the
 * OpenRouter key. Keys are only ever sent to their own provider and never back to a renderer.
 */
export class VoiceKeys {
  private keys: Partial<Record<CloudProviderId, string>> = {};

  private get path() {
    return join(app.getPath('userData'), 'voice-keys.enc');
  }

  has(provider: CloudProviderId) {
    return Boolean(this.keys[provider]);
  }

  get(provider: CloudProviderId) {
    return this.keys[provider] ?? '';
  }

  async load() {
    try {
      if (!safeStorage.isEncryptionAvailable()) return;
      const saved = JSON.parse(safeStorage.decryptString(await readFile(this.path))) as Record<
        string,
        unknown
      >;
      for (const provider of ['cartesia', 'elevenlabs'] as const)
        if (typeof saved[provider] === 'string') this.keys[provider] = saved[provider];
    } catch {
      // Missing or locked keys mean the cloud voices need setting up again.
    }
  }

  async set(provider: CloudProviderId, key: string | null) {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Secure key storage is unavailable.');
    const next = { ...this.keys };
    if (key) next[provider] = key;
    else delete next[provider];
    await mkdir(app.getPath('userData'), { recursive: true });
    await writeFile(`${this.path}.tmp`, safeStorage.encryptString(JSON.stringify(next)), {
      mode: 0o600,
    });
    await rename(`${this.path}.tmp`, this.path);
    this.keys = next;
  }
}
