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
  {
    // Conversations. Existing history is split wherever two hours passed between questions (the
    // same quiet period after which Edi starts a new conversation),
    // each part titled by its first question.
    version: 5,
    sql: `
      CREATE TABLE threads (
        id         TEXT PRIMARY KEY,
        title      TEXT    NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX threads_updated ON threads (updated_at DESC);
      ALTER TABLE runs ADD COLUMN thread_id TEXT REFERENCES threads (id) ON DELETE CASCADE;
      CREATE INDEX runs_thread ON runs (thread_id, started_at);

      CREATE TEMP TABLE legacy_turns AS
        WITH ordered AS (
          SELECT id, prompt, started_at, COALESCE(finished_at, started_at) AS ended,
                 LAG(started_at) OVER (ORDER BY started_at) AS previous
          FROM runs
        )
        SELECT id, prompt, started_at, ended,
               SUM(CASE WHEN previous IS NULL OR started_at - previous > 7200000 THEN 1 ELSE 0 END)
                 OVER (ORDER BY started_at ROWS UNBOUNDED PRECEDING) AS part
        FROM ordered;
      INSERT INTO threads (id, title, created_at, updated_at)
        SELECT 'earlier-' || part,
               (SELECT substr(trim(first.prompt), 1, 80) FROM legacy_turns first
                WHERE first.part = parts.part ORDER BY first.started_at LIMIT 1),
               MIN(started_at), MAX(ended)
        FROM legacy_turns parts GROUP BY part;
      UPDATE runs SET thread_id =
        (SELECT 'earlier-' || part FROM legacy_turns WHERE legacy_turns.id = runs.id);
      DROP TABLE legacy_turns;
    `,
  },
  {
    // Full-text search over conversation turns, kept in step with runs by triggers (deleting a
    // conversation cascades to its runs, and so out of the index).
    version: 6,
    sql: `
      CREATE VIRTUAL TABLE runs_search USING fts5(
        prompt, text,
        content = 'runs', content_rowid = 'rowid',
        tokenize = 'unicode61 remove_diacritics 2'
      );
      CREATE TRIGGER runs_search_insert AFTER INSERT ON runs BEGIN
        INSERT INTO runs_search (rowid, prompt, text) VALUES (new.rowid, new.prompt, new.text);
      END;
      CREATE TRIGGER runs_search_delete AFTER DELETE ON runs BEGIN
        INSERT INTO runs_search (runs_search, rowid, prompt, text)
          VALUES ('delete', old.rowid, old.prompt, old.text);
      END;
      CREATE TRIGGER runs_search_update AFTER UPDATE OF prompt, text ON runs BEGIN
        INSERT INTO runs_search (runs_search, rowid, prompt, text)
          VALUES ('delete', old.rowid, old.prompt, old.text);
        INSERT INTO runs_search (rowid, prompt, text) VALUES (new.rowid, new.prompt, new.text);
      END;
      INSERT INTO runs_search (runs_search) VALUES ('rebuild');
    `,
  },
  {
    // Background tasks. Their runs carry task_id instead of a conversation; deleting a task
    // removes its runs, steps and search entries.
    version: 7,
    sql: `
      CREATE TABLE tasks (
        id              TEXT PRIMARY KEY,
        title           TEXT    NOT NULL,
        prompt          TEXT    NOT NULL,
        status          TEXT    NOT NULL CHECK (status IN ('queued', 'running', 'waiting',
                          'limited', 'done', 'failed', 'cancelled', 'interrupted')),
        conversation_id TEXT    REFERENCES threads (id) ON DELETE SET NULL,
        budget_usd      REAL    NOT NULL CHECK (budget_usd > 0),
        result          TEXT    NOT NULL DEFAULT '',
        error           TEXT    NOT NULL DEFAULT '',
        created_at      INTEGER NOT NULL,
        started_at      INTEGER,
        finished_at     INTEGER
      );
      CREATE INDEX tasks_created ON tasks (created_at DESC);
      ALTER TABLE runs ADD COLUMN task_id TEXT REFERENCES tasks (id) ON DELETE CASCADE;
      CREATE INDEX runs_task ON runs (task_id);
    `,
  },
  {
    // Schedules and watches start tasks; when_json holds the validated timing rule.
    version: 8,
    sql: `
      CREATE TABLE schedules (
        id          TEXT PRIMARY KEY,
        title       TEXT    NOT NULL,
        prompt      TEXT    NOT NULL,
        when_json   TEXT    NOT NULL,
        notify      TEXT    NOT NULL CHECK (notify IN ('always', 'on-change')),
        budget_usd  REAL    NOT NULL CHECK (budget_usd > 0),
        enabled     INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
        created_at  INTEGER NOT NULL,
        last_run_at INTEGER,
        next_run_at INTEGER,
        last_result TEXT    NOT NULL DEFAULT ''
      );
      CREATE INDEX schedules_due ON schedules (enabled, next_run_at);
      ALTER TABLE tasks ADD COLUMN schedule_id TEXT REFERENCES schedules (id) ON DELETE SET NULL;
    `,
  },
  {
    // Saved "Always allow" choices: one action within a folder, on a site, for an app, or any.
    version: 9,
    sql: `
      CREATE TABLE approval_rules (
        id               TEXT PRIMARY KEY,
        capability_id    TEXT    NOT NULL,
        capability_title TEXT    NOT NULL,
        kind             TEXT    NOT NULL CHECK (kind IN ('folder', 'site', 'app', 'any')),
        value            TEXT    NOT NULL,
        label            TEXT    NOT NULL,
        created_at       INTEGER NOT NULL,
        UNIQUE (capability_id, kind, value)
      );
    `,
  },
  {
    // Why model calls failed: status, provider, code and a cleaned short message. No content.
    version: 10,
    sql: `
      CREATE TABLE failures (
        id       INTEGER PRIMARY KEY AUTOINCREMENT,
        at       INTEGER NOT NULL,
        run_id   TEXT    REFERENCES runs (id) ON DELETE CASCADE,
        model    TEXT    NOT NULL,
        kind     TEXT    NOT NULL,
        status   INTEGER,
        provider TEXT,
        code     TEXT,
        message  TEXT,
        step     INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX failures_at ON failures (at);
    `,
  },
];

export const latestVersion = migrations.at(-1)!.version;
