/**
 * Append-only. Never edit a shipped migration; add a new version instead.
 * Timestamps are Unix epoch milliseconds. Status values mirror @edi/contracts.
 */
export const migrations: readonly { version: number; sql: string }[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE runs (
        id          TEXT PRIMARY KEY,
        prompt      TEXT    NOT NULL,
        model       TEXT    NOT NULL,
        status      TEXT    NOT NULL
                    CHECK (status IN ('running', 'done', 'stopped', 'error', 'interrupted')),
        text        TEXT    NOT NULL DEFAULT '',
        error       TEXT    NOT NULL DEFAULT '',
        started_at  INTEGER NOT NULL,
        finished_at INTEGER
      );
      CREATE INDEX runs_started ON runs (started_at DESC);

      -- One row per tool call. Approval decisions are recorded here, bound to the call.
      CREATE TABLE tool_calls (
        id          TEXT PRIMARY KEY,
        run_id      TEXT    NOT NULL REFERENCES runs (id) ON DELETE CASCADE,
        capability  TEXT    NOT NULL,
        title       TEXT    NOT NULL,
        effect      TEXT    NOT NULL CHECK (effect IN ('read', 'write')),
        input_json  TEXT    NOT NULL,
        status      TEXT    NOT NULL
                    CHECK (status IN ('awaiting-approval', 'denied', 'running', 'succeeded',
                                      'failed', 'cancelled', 'unknown')),
        decision    TEXT    CHECK (decision IN ('approved', 'denied')),
        summary     TEXT    NOT NULL DEFAULT '',
        output_json TEXT,
        created_at  INTEGER NOT NULL,
        decided_at  INTEGER,
        finished_at INTEGER
      );
      CREATE INDEX tool_calls_run ON tool_calls (run_id, created_at);

      CREATE TABLE notes (
        id           TEXT PRIMARY KEY,
        title        TEXT    NOT NULL,
        path         TEXT    NOT NULL,
        bytes        INTEGER NOT NULL,
        tool_call_id TEXT    REFERENCES tool_calls (id) ON DELETE SET NULL,
        created_at   INTEGER NOT NULL
      );
      CREATE INDEX notes_created ON notes (created_at DESC);
    `,
  },
];

export const latestVersion = migrations.at(-1)!.version;
