import { app } from 'electron';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { defaultSettings, settingsSchema, type Settings } from '@edi/contracts';

/** Sole owner of preferences.json: serialized atomic writes, then change notification. */
export class SettingsStore {
  private value: Settings = { ...defaultSettings };
  private writes = Promise.resolve();
  private readonly listeners = new Set<(settings: Settings) => void>();

  get current(): Settings {
    return this.value;
  }

  // Resolved lazily so `--user-data-dir` and app.setPath() are honoured.
  private get path() {
    return join(app.getPath('userData'), 'preferences.json');
  }

  async load() {
    try {
      this.value = settingsSchema.parse(JSON.parse(await readFile(this.path, 'utf8')));
    } catch {
      // First launch or unreadable preferences: keep the defaults.
    }
  }

  onChange(listener: (settings: Settings) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * The new value is visible to readers immediately; listeners hear about it only
   * after it is on disk, so windows never display a preference that failed to save.
   */
  async update(patch: Partial<Settings>) {
    this.value = { ...this.value, ...patch };
    await this.persist();
    for (const listener of this.listeners) listener(this.value);
  }

  private persist() {
    const snapshot = JSON.stringify(this.value);
    const path = this.path;
    this.writes = this.writes
      .catch(() => {})
      .then(async () => {
        await mkdir(app.getPath('userData'), { recursive: true });
        await writeFile(`${path}.tmp`, snapshot, { mode: 0o600 });
        await rename(`${path}.tmp`, path);
      });
    return this.writes;
  }
}
