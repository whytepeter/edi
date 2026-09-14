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
  {
    // Screen context: only the number of screenshots sent is kept, never the images.
    version: 2,
    sql: `ALTER TABLE runs ADD COLUMN screens INTEGER NOT NULL DEFAULT 0;`,
  },
  {
    // Generated workspace content gets its own record so it can be searched, updated and deleted.
    // The id is the workspace.show call that created it, so conversation cards keep opening it.
    // Content is the validated structured data; path is relative to the Edi workspace root.
    version: 3,
    sql: `
      CREATE TABLE artifacts (
        id           TEXT PRIMARY KEY,
        kind         TEXT    NOT NULL CHECK (kind IN ('document', 'checklist', 'table', 'html')),
        title        TEXT    NOT NULL,
        content_json TEXT    NOT NULL,
        path         TEXT    NOT NULL,
        bytes        INTEGER NOT NULL,
        created_at   INTEGER NOT NULL,
        updated_at   INTEGER NOT NULL
      );
      CREATE INDEX artifacts_updated ON artifacts (updated_at DESC);

      INSERT INTO artifacts (id, kind, title, content_json, path, bytes, created_at, updated_at)
      SELECT id,
             json_extract(input_json, '$.kind'),
             json_extract(input_json, '$.title'),
             input_json,
             json_extract(output_json, '$.path'),
             json_extract(output_json, '$.bytes'),
             created_at,
             COALESCE(finished_at, created_at)
      FROM tool_calls
      WHERE capability = 'workspace.show' AND status = 'succeeded'
        AND json_extract(input_json, '$.kind') IN ('document', 'checklist', 'table', 'html')
        AND json_type(output_json, '$.path') = 'text'
        AND json_type(output_json, '$.bytes') = 'integer';
    `,
  },
  {
    // What Edi consumed: one row per OpenRouter model call or cloud voice reply. Counts and
    // costs only; no prompts, pages or spoken text.
    version: 4,
    sql: `
      CREATE TABLE usage (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        at            INTEGER NOT NULL,
        run_id        TEXT,
        kind          TEXT    NOT NULL CHECK (kind IN ('answer', 'page-reader', 'voice')),
        provider      TEXT    NOT NULL CHECK (provider IN ('openrouter', 'cartesia', 'elevenlabs')),
        model         TEXT    NOT NULL,
        input_tokens  INTEGER NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
        output_tokens INTEGER NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
        cached_tokens INTEGER NOT NULL DEFAULT 0 CHECK (cached_tokens >= 0),
        cost_usd      REAL             CHECK (cost_usd IS NULL OR cost_usd >= 0),
        characters    INTEGER NOT NULL DEFAULT 0 CHECK (characters >= 0)
      );
      CREATE INDEX usage_at ON usage (at);
    `,
  },
];

export const latestVersion = migrations.at(-1)!.version;
