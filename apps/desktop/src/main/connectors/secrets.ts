import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  OAuthClientInformationMixed,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';

/** What a connected app's sign-in needs between launches. */
export interface ConnectorSecrets {
  client?: OAuthClientInformationMixed;
  tokens?: OAuthTokens;
  codeVerifier?: string;
  /** The loopback port the client registered, reused so its redirect address stays valid. */
  port?: number;
}

export interface SecretStore {
  read(id: string): Promise<ConnectorSecrets>;
  write(id: string, secrets: ConnectorSecrets): Promise<void>;
  remove(id: string): Promise<void>;
}

const safeId = (id: string) => {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error('Invalid connector id.');
  return id;
};

/** Encrypted at rest with Electron safeStorage, whose key lives in the macOS keychain. */
export class EncryptedSecretStore implements SecretStore {
  constructor(
    private readonly folder: string,
    private readonly crypto: {
      available(): boolean;
      encrypt(text: string): Buffer;
      decrypt(data: Buffer): string;
    },
  ) {}

  private path(id: string) {
    return join(this.folder, `${safeId(id)}.enc`);
  }

  async read(id: string): Promise<ConnectorSecrets> {
    try {
      if (!this.crypto.available()) return {};
      return JSON.parse(this.crypto.decrypt(await readFile(this.path(id)))) as ConnectorSecrets;
    } catch {
      return {};
    }
  }

  async write(id: string, secrets: ConnectorSecrets) {
    if (!this.crypto.available()) throw new Error('Secure storage is unavailable on this Mac.');
    await mkdir(this.folder, { recursive: true, mode: 0o700 });
    const path = this.path(id);
    await writeFile(`${path}.tmp`, this.crypto.encrypt(JSON.stringify(secrets)), { mode: 0o600 });
    await rename(`${path}.tmp`, path);
  }

  async remove(id: string) {
    await unlink(this.path(id)).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
}

/** For tests. */
export class MemorySecretStore implements SecretStore {
  readonly saved = new Map<string, ConnectorSecrets>();
  async read(id: string) {
    return structuredClone(this.saved.get(id) ?? {});
  }
  async write(id: string, secrets: ConnectorSecrets) {
    this.saved.set(id, structuredClone(secrets));
  }
  async remove(id: string) {
    this.saved.delete(id);
  }
}
