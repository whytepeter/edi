import { z } from 'zod';
import {
  runStatusSchema,
  toolCallStatusSchema,
  type Activity,
  type RunStatus,
  type ToolCallStatus,
  type ToolStep,
} from '@edi/contracts';
import { transaction, type Database } from './database';

// Rows are validated on the way out: the database is a trust boundary too.
const runRow = z.object({
  id: z.string(),
  prompt: z.string(),
  model: z.string(),
  status: runStatusSchema,
  error: z.string(),
  screens: z.number(),
  startedAt: z.number(),
  finishedAt: z.number().nullable(),
});
const stepRow = z.object({
  runId: z.string(),
  callId: z.string(),
  capability: z.string(),
  title: z.string(),
  status: toolCallStatusSchema,
  summary: z.string(),
});
const noteRow = z.object({
  id: z.string(),
  title: z.string(),
  path: z.string(),
  bytes: z.number(),
  createdAt: z.number(),
});
export type NoteRecord = z.infer<typeof noteRow>;
const artifactRow = z.object({
  id: z.string(),
  kind: z.enum(['document', 'checklist', 'table', 'html']),
  title: z.string(),
  content: z.string(),
  path: z.string(),
  bytes: z.number().int().nonnegative(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});
/** Generated workspace content. `content` is the structured data; `path` is workspace-relative. */
export interface ArtifactRecord {
  id: string;
  kind: 'document' | 'checklist' | 'table' | 'html';
  title: string;
  content: unknown;
  path: string;
  bytes: number;
  createdAt: number;
  updatedAt: number;
}
const exchangeRow = z.object({ prompt: z.string(), reply: z.string() });
export type Exchange = z.infer<typeof exchangeRow>;
const threadRow = z.object({
  id: z.string(),
  prompt: z.string(),
  reply: z.string(),
  status: runStatusSchema,
  error: z.string(),
});
export type ThreadTurn = z.infer<typeof threadRow>;
const shownRow = z.object({
  id: z.string(),
  runId: z.string(),
  capability: z.string(),
  input: z.string(),
  output: z.string().nullable(),
  createdAt: z.number().int().nonnegative(),
});
/** A successful display tool call: the host rebuilds the artifact from its reviewed input. */
export interface ShownCall {
  id: string;
  runId: string;
  capability: string;
  input: unknown;
  output: unknown;
  createdAt: number;
}
const parseJson = (text: string | null): unknown => {
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

export class RunRepository {
  constructor(private readonly db: Database) {}

  start(run: { id: string; prompt: string; model: string; screens: number; startedAt: number }) {
    this.db
      .prepare(
        `INSERT INTO runs (id, prompt, model, status, screens, started_at)
         VALUES (?, ?, ?, 'running', ?, ?)`,
      )
      .run(run.id, run.prompt, run.model, run.screens, run.startedAt);
  }

  /**
   * The last completed exchanges, oldest first, as text only: conversation context
   * for the next request. Long turns are clipped to bound tokens.
   */
  recentExchanges(limit: number, maxChars = { prompt: 2000, reply: 4000 }): Exchange[] {
    return this.db
      .prepare(
        `SELECT prompt, text AS reply FROM runs
         WHERE status = 'done' AND text != ''
         ORDER BY started_at DESC LIMIT ?`,
      )
      .all(limit)
      .map(row => exchangeRow.parse(row))
      .map(turn => ({
        prompt: turn.prompt.slice(0, maxChars.prompt),
        reply: turn.reply.slice(0, maxChars.reply),
      }))
      .reverse();
  }

  /**
   * Recent finished turns for the chat thread, oldest first. Includes stopped
   * and failed replies so the card remembers what the person already said.
   */
  thread(limit: number): ThreadTurn[] {
    return this.db
      .prepare(
        `SELECT id, prompt, text AS reply, status, error FROM runs
         WHERE status IN ('done', 'error', 'stopped') AND prompt != ''
         ORDER BY started_at DESC LIMIT ?`,
      )
      .all(limit)
      .map(row => threadRow.parse(row))
      .map(turn => ({
        ...turn,
        prompt: turn.prompt.slice(0, 8000),
        reply: turn.reply.slice(0, 32000),
        error: turn.error.slice(0, 400),
      }))
      .reverse();
  }

  finish(
    id: string,
    result: { status: Exclude<RunStatus, 'running'>; text: string; error: string; at: number },
  ) {
    this.db
      .prepare(
        `UPDATE runs SET status = ?, text = ?, error = ?, finished_at = ?
         WHERE id = ? AND status = 'running'`,
      )
      .run(result.status, result.text, result.error, result.at, id);
  }
}

export class ToolCallRepository {
  constructor(private readonly db: Database) {}

  /** Successful calls of the given display capabilities, oldest first. */
  shown(capabilities: readonly string[], filter: { runIds?: string[]; id?: string }): ShownCall[] {
    if (!capabilities.length) return [];
    const where = [
      `status = 'succeeded'`,
      `capability IN (${capabilities.map(() => '?').join(', ')})`,
    ];
    const values: string[] = [...capabilities];
    if (filter.id) {
      where.push('id = ?');
      values.push(filter.id);
    }
    if (filter.runIds) {
      if (!filter.runIds.length) return [];
      where.push(`run_id IN (${filter.runIds.map(() => '?').join(', ')})`);
      values.push(...filter.runIds);
    }
    return this.db
      .prepare(
        `SELECT id, run_id AS runId, capability, input_json AS input, output_json AS output,
                created_at AS createdAt
         FROM tool_calls WHERE ${where.join(' AND ')} ORDER BY created_at`,
      )
      .all(...values)
      .map(row => shownRow.parse(row))
      .map(row => ({ ...row, input: parseJson(row.input), output: parseJson(row.output) }));
  }

  create(call: {
    id: string;
    runId: string;
    capability: string;
    title: string;
    effect: 'read' | 'write';
    input: unknown;
    status: ToolCallStatus;
    at: number;
  }) {
    this.db
      .prepare(
        `INSERT INTO tool_calls (id, run_id, capability, title, effect, input_json, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        call.id,
        call.runId,
        call.capability,
        call.title,
        call.effect,
        JSON.stringify(call.input ?? null),
        call.status,
        call.at,
      );
  }

  decide(id: string, decision: 'approved' | 'denied', at: number) {
    this.db
      .prepare(
        `UPDATE tool_calls
         SET decision = ?, decided_at = ?, status = CASE WHEN ? = 'approved' THEN 'running' ELSE status END
         WHERE id = ? AND status = 'awaiting-approval'`,
      )
      .run(decision, at, decision, id);
  }

  finish(id: string, status: ToolCallStatus, summary: string, output: unknown, at: number) {
    this.db
      .prepare(
        `UPDATE tool_calls SET status = ?, summary = ?, output_json = ?, finished_at = ?
         WHERE id = ?`,
      )
      .run(status, summary, output === undefined ? null : JSON.stringify(output), at, id);
  }
}

export class NoteRepository {
  constructor(private readonly db: Database) {}

  add(note: NoteRecord & { toolCallId: string | null }) {
    this.db
      .prepare(
        `INSERT INTO notes (id, title, path, bytes, tool_call_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(note.id, note.title, note.path, note.bytes, note.toolCallId, note.createdAt);
  }

  get(id: string): NoteRecord | undefined {
    const row = this.db
      .prepare(`SELECT id, title, path, bytes, created_at AS createdAt FROM notes WHERE id = ?`)
      .get(id);
    return row ? noteRow.parse(row) : undefined;
  }

  list(limit: number): NoteRecord[] {
    return this.db
      .prepare(
        `SELECT id, title, path, bytes, created_at AS createdAt
         FROM notes ORDER BY created_at DESC LIMIT ?`,
      )
      .all(limit)
      .map(row => noteRow.parse(row));
  }

  update(note: { id: string; title: string; bytes: number }) {
    const result = this.db
      .prepare(`UPDATE notes SET title = ?, bytes = ? WHERE id = ?`)
      .run(note.title, note.bytes, note.id);
    if (result.changes === 0) throw new Error('That note is no longer in Edi’s history.');
  }

  /** After the notes folder moves, point every record inside it at the new folder. */
  relocate(from: string, to: string) {
    const prefix = from.endsWith('/') ? from : `${from}/`;
    const target = to.endsWith('/') ? to : `${to}/`;
    return Number(
      this.db
        .prepare(`UPDATE notes SET path = ? || substr(path, ?) WHERE substr(path, 1, ?) = ?`)
        .run(target, prefix.length + 1, prefix.length, prefix).changes,
    );
  }

  remove(id: string) {
    const result = this.db.prepare(`DELETE FROM notes WHERE id = ?`).run(id);
    if (result.changes === 0) throw new Error('That note is no longer in Edi’s history.');
  }
}

export class ArtifactRepository {
  constructor(private readonly db: Database) {}

  private static parse(row: unknown): ArtifactRecord {
    const { content, ...rest } = artifactRow.parse(row);
    return { ...rest, content: JSON.parse(content) as unknown };
  }

  add(record: ArtifactRecord) {
    this.db
      .prepare(
        `INSERT INTO artifacts (id, kind, title, content_json, path, bytes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.id,
        record.kind,
        record.title,
        JSON.stringify(record.content),
        record.path,
        record.bytes,
        record.createdAt,
        record.updatedAt,
      );
  }

  get(id: string): ArtifactRecord | undefined {
    const row = this.db
      .prepare(
        `SELECT id, kind, title, content_json AS content, path, bytes,
                created_at AS createdAt, updated_at AS updatedAt
         FROM artifacts WHERE id = ?`,
      )
      .get(id);
    return row ? ArtifactRepository.parse(row) : undefined;
  }

  /** Most recently changed first. */
  list(limit: number): ArtifactRecord[] {
    return this.db
      .prepare(
        `SELECT id, kind, title, content_json AS content, path, bytes,
                created_at AS createdAt, updated_at AS updatedAt
         FROM artifacts ORDER BY updated_at DESC LIMIT ?`,
      )
      .all(limit)
      .map(row => ArtifactRepository.parse(row));
  }

  update(record: {
    id: string;
    title: string;
    content: unknown;
    bytes: number;
    updatedAt: number;
  }) {
    const result = this.db
      .prepare(
        `UPDATE artifacts SET title = ?, content_json = ?, bytes = ?, updated_at = ? WHERE id = ?`,
      )
      .run(record.title, JSON.stringify(record.content), record.bytes, record.updatedAt, record.id);
    if (result.changes === 0) throw new Error('That item is no longer in Edi’s workspace.');
  }

  remove(id: string) {
    const result = this.db.prepare(`DELETE FROM artifacts WHERE id = ?`).run(id);
    if (result.changes === 0) throw new Error('That item is no longer in Edi’s workspace.');
  }
}

export interface Repositories {
  runs: RunRepository;
  toolCalls: ToolCallRepository;
  notes: NoteRepository;
  artifacts: ArtifactRepository;
  /** Recent runs with their tool steps, newest first. */
  activity(limit: number): Activity;
  /**
   * Called once at startup. Nothing that was in flight is ever replayed:
   * running runs become interrupted, undecided approvals are cancelled, and
   * calls that were executing become `unknown` because their effect may exist.
   */
  recoverInterrupted(at: number): { runs: number; approvals: number; uncertain: number };
}

export function createRepositories(db: Database): Repositories {
  return {
    runs: new RunRepository(db),
    toolCalls: new ToolCallRepository(db),
    notes: new NoteRepository(db),
    artifacts: new ArtifactRepository(db),

    activity(limit) {
      const runs = db
        .prepare(
          `SELECT id, prompt, model, status, error, screens,
                  started_at AS startedAt, finished_at AS finishedAt
           FROM runs ORDER BY started_at DESC LIMIT ?`,
        )
        .all(limit)
        .map(row => runRow.parse(row));
      if (!runs.length) return [];
      const steps = db
        .prepare(
          `SELECT run_id AS runId, id AS callId, capability, title, status, summary
           FROM tool_calls
           WHERE run_id IN (${runs.map(() => '?').join(', ')})
           ORDER BY created_at`,
        )
        .all(...runs.map(run => run.id))
        .map(row => stepRow.parse(row));
      return runs.map(run => ({
        ...run,
        prompt: run.prompt.slice(0, 8000),
        error: run.error.slice(0, 400),
        steps: steps
          .filter(step => step.runId === run.id)
          .slice(0, 50)
          .map(({ runId: _runId, ...step }): ToolStep => ({
            ...step,
            summary: step.summary.slice(0, 400),
          })),
      }));
    },

    recoverInterrupted(at) {
      return transaction(db, () => ({
        runs: Number(
          db
            .prepare(
              `UPDATE runs SET status = 'interrupted', finished_at = ? WHERE status = 'running'`,
            )
            .run(at).changes,
        ),
        approvals: Number(
          db
            .prepare(
              `UPDATE tool_calls SET status = 'cancelled', finished_at = ?,
                 summary = 'Edi closed before you decided. Nothing was changed.'
               WHERE status = 'awaiting-approval'`,
            )
            .run(at).changes,
        ),
        uncertain: Number(
          db
            .prepare(
              `UPDATE tool_calls SET status = 'unknown', finished_at = ?,
                 summary = 'Edi closed while this was running. Check the result before trying again.'
               WHERE status = 'running'`,
            )
            .run(at).changes,
        ),
      }));
    },
  };
}
