import { z } from 'zod';
import {
  runStatusSchema,
  toolCallStatusSchema,
  usageEntrySchema,
  usageKindSchema,
  usageProviderSchema,
  type Activity,
  type UsageEntry,
  type UsagePeriod,
  type UsageSummary,
  type UsageTotals,
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

  start(run: {
    id: string;
    prompt: string;
    model: string;
    screens: number;
    startedAt: number;
    threadId?: string | null;
  }) {
    this.db
      .prepare(
        `INSERT INTO runs (id, prompt, model, status, screens, started_at, thread_id)
         VALUES (?, ?, ?, 'running', ?, ?, ?)`,
      )
      .run(run.id, run.prompt, run.model, run.screens, run.startedAt, run.threadId ?? null);
  }

  /**
   * The last completed exchanges, oldest first, as text only: conversation context
   * for the next request. Long turns are clipped to bound tokens.
   */
  recentExchanges(
    limit: number,
    threadId: string | null,
    maxChars = { prompt: 2000, reply: 4000 },
  ): Exchange[] {
    if (threadId === null) return [];
    return this.db
      .prepare(
        `SELECT prompt, text AS reply FROM runs
         WHERE status = 'done' AND text != '' AND thread_id = ?
         ORDER BY started_at DESC LIMIT ?`,
      )
      .all(threadId, limit)
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
  thread(limit: number, threadId: string | null): ThreadTurn[] {
    if (threadId === null) return [];
    return this.db
      .prepare(
        `SELECT id, prompt, text AS reply, status, error FROM runs
         WHERE status IN ('done', 'error', 'stopped') AND prompt != '' AND thread_id = ?
         ORDER BY started_at DESC LIMIT ?`,
      )
      .all(threadId, limit)
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

const conversationRow = z.object({
  id: z.string(),
  title: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
  turns: z.number(),
});
export type ConversationRecord = z.infer<typeof conversationRow>;

/** Conversations: each run belongs to one. Deleting one removes its runs and their tool calls. */
export class ConversationRepository {
  constructor(private readonly db: Database) {}

  create(conversation: { id: string; title: string; at: number }) {
    this.db
      .prepare(`INSERT INTO threads (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)`)
      .run(conversation.id, conversation.title.slice(0, 80), conversation.at, conversation.at);
  }

  touch(id: string, at: number) {
    this.db.prepare(`UPDATE threads SET updated_at = MAX(updated_at, ?) WHERE id = ?`).run(at, id);
  }

  get(id: string): ConversationRecord | undefined {
    const row = this.db
      .prepare(
        `SELECT t.id, t.title, t.created_at AS createdAt, t.updated_at AS updatedAt,
                (SELECT COUNT(*) FROM runs r WHERE r.thread_id = t.id) AS turns
         FROM threads t WHERE t.id = ?`,
      )
      .get(id);
    return row ? conversationRow.parse(row) : undefined;
  }

  /** Most recently active first; empty conversations are left out. */
  list(limit: number): ConversationRecord[] {
    return this.db
      .prepare(
        `SELECT t.id, t.title, t.created_at AS createdAt, t.updated_at AS updatedAt,
                COUNT(r.id) AS turns
         FROM threads t JOIN runs r ON r.thread_id = t.id
         GROUP BY t.id ORDER BY t.updated_at DESC LIMIT ?`,
      )
      .all(limit)
      .map(row => conversationRow.parse(row));
  }

  remove(id: string) {
    const result = this.db.prepare(`DELETE FROM threads WHERE id = ?`).run(id);
    if (Number(result.changes) === 0) throw new Error('That conversation no longer exists.');
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

const usageRow = z.object({
  runId: z.string().nullable(),
  at: z.number(),
  kind: usageKindSchema,
  provider: usageProviderSchema,
  model: z.string(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  cachedTokens: z.number(),
  costUsd: z.number().nullable(),
  characters: z.number(),
});

const emptyTotals = (): UsageTotals => ({
  calls: 0,
  inputTokens: 0,
  outputTokens: 0,
  cachedTokens: 0,
  costUsd: 0,
  unpricedCalls: 0,
});
function addTo(totals: UsageTotals, row: z.infer<typeof usageRow>) {
  totals.calls += 1;
  totals.inputTokens += row.inputTokens;
  totals.outputTokens += row.outputTokens;
  totals.cachedTokens += row.cachedTokens;
  if (row.costUsd === null) totals.unpricedCalls += 1;
  else totals.costUsd += row.costUsd;
}
const localDay = (at: number) => {
  const date = new Date(at);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

export class UsageRepository {
  constructor(private readonly db: Database) {}

  add(entry: UsageEntry, at: number, runId: string | null = null) {
    const row = usageEntrySchema.parse(entry);
    this.db
      .prepare(
        `INSERT INTO usage (at, run_id, kind, provider, model, input_tokens, output_tokens,
                            cached_tokens, cost_usd, characters)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        at,
        runId,
        row.kind,
        row.provider,
        row.model,
        row.inputTokens,
        row.outputTokens,
        row.cachedTokens,
        row.costUsd,
        row.characters,
      );
  }

  /** Totals for the last `days` local days, today included. Account figures come from main. */
  summary(days: UsagePeriod, now: number): Omit<UsageSummary, 'account'> {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - (days - 1));
    const rows = this.db
      .prepare(
        `SELECT run_id AS runId, at, kind, provider, model, input_tokens AS inputTokens,
                output_tokens AS outputTokens, cached_tokens AS cachedTokens,
                cost_usd AS costUsd, characters
         FROM usage WHERE at >= ? AND at <= ? ORDER BY at`,
      )
      .all(start.getTime(), now)
      .map(row => usageRow.parse(row));

    const total = emptyTotals();
    const kinds = new Map<'answer' | 'page-reader', UsageTotals>();
    const models = new Map<string, UsageTotals>();
    const daily = new Map<string, number>();
    for (let offset = 0; offset < days; offset++) {
      const day = new Date(start);
      day.setDate(start.getDate() + offset);
      daily.set(localDay(day.getTime()), 0);
    }
    const runs = new Set<string>();
    const voice = new Map<'cartesia' | 'elevenlabs', { replies: number; characters: number }>();
    for (const row of rows) {
      if (row.kind === 'voice') {
        if (row.provider === 'openrouter') continue;
        const entry = voice.get(row.provider) ?? { replies: 0, characters: 0 };
        entry.replies += 1;
        entry.characters += row.characters;
        voice.set(row.provider, entry);
        continue;
      }
      addTo(total, row);
      if (!kinds.has(row.kind)) kinds.set(row.kind, emptyTotals());
      addTo(kinds.get(row.kind)!, row);
      if (!models.has(row.model)) models.set(row.model, emptyTotals());
      addTo(models.get(row.model)!, row);
      const day = localDay(row.at);
      daily.set(day, (daily.get(day) ?? 0) + (row.costUsd ?? 0));
      if (row.kind === 'answer' && row.runId) runs.add(row.runId);
    }
    return {
      days,
      total,
      answers: runs.size,
      byKind: [...kinds].map(([kind, totals]) => ({ kind, ...totals })),
      byModel: [...models]
        .map(([model, totals]) => ({ model, ...totals }))
        .sort((a, b) => b.costUsd - a.costUsd || b.inputTokens - a.inputTokens)
        .slice(0, 12),
      daily: [...daily].map(([day, costUsd]) => ({ day, costUsd })),
      voice: [...voice].map(([provider, entry]) => ({ provider, ...entry })),
    };
  }
}

export interface Repositories {
  runs: RunRepository;
  toolCalls: ToolCallRepository;
  notes: NoteRepository;
  artifacts: ArtifactRepository;
  usage: UsageRepository;
  conversations: ConversationRepository;
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
    usage: new UsageRepository(db),
    conversations: new ConversationRepository(db),

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
