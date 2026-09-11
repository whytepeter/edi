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
const exchangeRow = z.object({ prompt: z.string(), reply: z.string() });
export type Exchange = z.infer<typeof exchangeRow>;

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

  list(limit: number): NoteRecord[] {
    return this.db
      .prepare(
        `SELECT id, title, path, bytes, created_at AS createdAt
         FROM notes ORDER BY created_at DESC LIMIT ?`,
      )
      .all(limit)
      .map(row => noteRow.parse(row));
  }
}

export interface Repositories {
  runs: RunRepository;
  toolCalls: ToolCallRepository;
  notes: NoteRepository;
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
