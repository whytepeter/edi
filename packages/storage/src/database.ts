import { chmodSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { latestVersion, migrations } from './migrations';

export type Database = DatabaseSync;

/**
 * Open Edi's database and bring it to the latest schema. The main process is the
 * only writer; workers and renderers go through repositories via IPC.
 */
export function openDatabase(path: string): Database {
  const db = new DatabaseSync(path);
  if (path !== ':memory:') chmodSync(path, 0o600); // history is private; WAL files inherit this
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 2000');
  migrate(db);
  return db;
}

/** Apply pending migrations, each atomically, tracked by SQLite's user_version. */
export function migrate(db: Database) {
  const { user_version: current } = db.prepare('PRAGMA user_version').get() as {
    user_version: number;
  };
  if (current > latestVersion) {
    // Refuse rather than corrupt: an older build must not write a newer schema.
    throw new Error(
      `Database schema ${current} is newer than this app supports (${latestVersion}).`,
    );
  }
  for (const migration of migrations) {
    if (migration.version <= current) continue;
    transaction(db, () => {
      db.exec(migration.sql);
      db.exec(`PRAGMA user_version = ${migration.version}`);
    });
  }
}

export function transaction<T>(db: Database, work: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = work();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
