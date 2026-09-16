import { z } from 'zod';
import {
  approvalRuleSchema,
  connectorToolSchema,
  providerFailureSchema,
  runStatusSchema,
  toolCallStatusSchema,
  scheduleNotifySchema,
  scheduleWhenSchema,
  usageEntrySchema,
  usageKindSchema,
  usageProviderSchema,
  type Activity,
  type ApprovalRule,
  type ConnectorTool,
  type ProviderFailure,
  type UsageEntry,
  type UsagePeriod,
  type UsageSummary,
  type UsageTotals,
  type RunStatus,
  type ToolCallStatus,
  type Schedule,
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
  pinnedAt: z.number().nullable().optional(),
});
export type NoteRecord = z.infer<typeof noteRow>;
const artifactRow = z.object({
  id: z.string(),
  kind: z.enum(['document', 'checklist', 'table', 'diagram', 'html']),
  title: z.string(),
  content: z.string(),
  path: z.string(),
  bytes: z.number().int().nonnegative(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  pinnedAt: z.number().nullable().optional(),
});
/** Generated workspace content. `content` is the structured data; `path` is workspace-relative. */
export interface ArtifactRecord {
  id: string;
  kind: 'document' | 'checklist' | 'table' | 'diagram' | 'html';
  title: string;
  content: unknown;
  path: string;
  bytes: number;
  createdAt: number;
  updatedAt: number;
  /** When the person pinned it to the top of the Library. */
  pinnedAt?: number | null;
}
const exchangeRow = z.object({ prompt: z.string(), reply: z.string() });
export type Exchange = z.infer<typeof exchangeRow>;
const threadRow = z.object({
  id: z.string(),
  prompt: z.string(),
  /** Set when Edi started the turn itself; shown instead of the prompt. */
  note: z.string().nullable(),
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
    taskId?: string | null;
    note?: string | null;
  }) {
    this.db
      .prepare(
        `INSERT INTO runs (id, prompt, model, status, screens, started_at, thread_id, task_id, note)
         VALUES (?, ?, ?, 'running', ?, ?, ?, ?, ?)`,
      )
      .run(
        run.id,
        run.prompt,
        run.model,
        run.screens,
        run.startedAt,
        run.threadId ?? null,
        run.taskId ?? null,
        run.note ?? null,
      );
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
    // A stopped turn counts too, marked as cut off: "actually, only from Sarah" right after an
    // interruption needs the request it changes.
    return this.db
      .prepare(
        `SELECT prompt, text AS reply, status FROM runs
         WHERE thread_id = ? AND prompt != ''
           AND ((status = 'done' AND text != '') OR status = 'stopped')
         ORDER BY started_at DESC LIMIT ?`,
      )
      .all(threadId, limit)
      .map(row => exchangeRow.extend({ status: z.string() }).parse(row))
      .map(turn => {
        const reply = turn.reply.slice(0, maxChars.reply);
        return {
          prompt: turn.prompt.slice(0, maxChars.prompt),
          reply:
            turn.status === 'stopped'
              ? reply.trim()
                ? `${reply.trim()}\n\n[The user interrupted this reply before it finished.]`
                : '[The user interrupted before this was answered.]'
              : reply,
        };
      })
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
        `SELECT id, prompt, note, text AS reply, status, error FROM runs
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

const matchRow = z.object({
  id: z.string(),
  title: z.string(),
  updatedAt: z.number(),
  runId: z.string(),
  at: z.number(),
  excerpt: z.string(),
});
export type ConversationMatch = z.infer<typeof matchRow>;

/**
 * Words become prefix terms that must all match ("palet warm" finds "warm terracotta palette").
 * Punctuation and FTS syntax are dropped, so any text is safe to pass. Null when nothing is left.
 */
export function ftsQuery(text: string): string | null {
  const words =
    text
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu)
      ?.slice(0, 12) ?? [];
  return words.length ? words.map(word => `"${word}"*`).join(' ') : null;
}

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

  /**
   * Conversations whose title or turns match, best match first, one entry each with the turn
   * that matched and a short excerpt. `after`/`before` bound the matching turn's time (ms).
   */
  search(
    query: string,
    options: { limit: number; after?: number; before?: number },
  ): ConversationMatch[] {
    const match = ftsQuery(query);
    if (!match) return [];
    const rows = this.db
      .prepare(
        `SELECT t.id, t.title, t.updated_at AS updatedAt, r.id AS runId, r.started_at AS at,
                snippet(runs_search, -1, '', '', '…', 14) AS excerpt
         FROM runs_search
         JOIN runs r ON r.rowid = runs_search.rowid
         JOIN threads t ON t.id = r.thread_id
         WHERE runs_search MATCH ? AND r.started_at >= ? AND r.started_at <= ?
         ORDER BY bm25(runs_search) LIMIT 200`,
      )
      .all(match, options.after ?? 0, options.before ?? Number.MAX_SAFE_INTEGER)
      .map(row => matchRow.parse(row));
    const seen = new Set<string>();
    const best: ConversationMatch[] = [];
    for (const row of rows) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      best.push({ ...row, excerpt: row.excerpt.replace(/\s+/g, ' ').trim().slice(0, 200) });
      if (best.length >= options.limit) break;
    }
    return best;
  }

  remove(id: string) {
    const result = this.db.prepare(`DELETE FROM threads WHERE id = ?`).run(id);
    if (Number(result.changes) === 0) throw new Error('That conversation no longer exists.');
  }
}

const taskRow = z.object({
  id: z.string(),
  title: z.string(),
  prompt: z.string(),
  status: z.enum([
    'queued',
    'running',
    'waiting',
    'limited',
    'done',
    'failed',
    'cancelled',
    'interrupted',
  ]),
  conversationId: z.string().nullable(),
  scheduleId: z.string().nullable(),
  budgetUsd: z.number(),
  result: z.string(),
  error: z.string(),
  createdAt: z.number(),
  startedAt: z.number().nullable(),
  finishedAt: z.number().nullable(),
  spentUsd: z.number(),
});
export type TaskRecord = z.infer<typeof taskRow>;
const taskColumns = `t.id, t.title, t.prompt, t.status, t.conversation_id AS conversationId,
  t.schedule_id AS scheduleId,
  t.budget_usd AS budgetUsd, t.result, t.error, t.created_at AS createdAt,
  t.started_at AS startedAt, t.finished_at AS finishedAt,
  COALESCE((SELECT SUM(u.cost_usd) FROM usage u JOIN runs r ON r.id = u.run_id
            WHERE r.task_id = t.id), 0) AS spentUsd`;

/** Background tasks; what a task spent is the sum of its runs' reported costs. */
export class TaskRepository {
  constructor(private readonly db: Database) {}

  create(task: {
    id: string;
    title: string;
    prompt: string;
    budgetUsd: number;
    conversationId: string | null;
    scheduleId?: string | null;
    at: number;
  }) {
    this.db
      .prepare(
        `INSERT INTO tasks (id, title, prompt, status, conversation_id, budget_usd, created_at,
                            schedule_id)
         VALUES (?, ?, ?, 'queued', ?, ?, ?, ?)`,
      )
      .run(
        task.id,
        task.title.slice(0, 120),
        task.prompt,
        task.conversationId,
        task.budgetUsd,
        task.at,
        task.scheduleId ?? null,
      );
  }

  get(id: string): TaskRecord | undefined {
    const row = this.db.prepare(`SELECT ${taskColumns} FROM tasks t WHERE t.id = ?`).get(id);
    return row ? taskRow.parse(row) : undefined;
  }

  /** Unfinished first (oldest first, the order they run in), then the rest newest first. */
  list(limit: number): TaskRecord[] {
    return this.db
      .prepare(
        `SELECT ${taskColumns} FROM tasks t
         ORDER BY t.status IN ('queued', 'running', 'waiting', 'limited') DESC,
                  CASE WHEN t.status IN ('queued', 'running', 'waiting', 'limited')
                       THEN t.created_at ELSE -t.created_at END
         LIMIT ?`,
      )
      .all(limit)
      .map(row => taskRow.parse(row));
  }

  update(
    id: string,
    change: {
      status?: TaskRecord['status'];
      result?: string;
      error?: string;
      startedAt?: number;
      finishedAt?: number;
      budgetUsd?: number;
    },
  ) {
    const fields: string[] = [];
    const values: (string | number)[] = [];
    const set = (column: string, value: string | number | undefined) => {
      if (value === undefined) return;
      fields.push(`${column} = ?`);
      values.push(value);
    };
    set('status', change.status);
    set('result', change.result?.slice(0, 32000));
    set('error', change.error?.slice(0, 400));
    set('started_at', change.startedAt);
    set('finished_at', change.finishedAt);
    set('budget_usd', change.budgetUsd);
    if (!fields.length) return;
    this.db.prepare(`UPDATE tasks SET ${fields.join(', ')} WHERE id = ?`).run(...values, id);
  }

  /** The task's runs, oldest first. */
  runIds(id: string): string[] {
    return this.db
      .prepare(`SELECT id FROM runs WHERE task_id = ? ORDER BY started_at`)
      .all(id)
      .map(row => String((row as { id: unknown }).id));
  }

  /** Every step of the task's runs, in order. */
  steps(id: string): ToolStep[] {
    return this.db
      .prepare(
        `SELECT c.id AS callId, c.capability, c.title, c.status, c.summary
         FROM tool_calls c JOIN runs r ON r.id = c.run_id
         WHERE r.task_id = ? ORDER BY c.created_at`,
      )
      .all(id)
      .map(row => {
        const step = stepRow.omit({ runId: true }).parse(row);
        return { ...step, summary: step.summary.slice(0, 400) };
      });
  }

  remove(id: string) {
    const result = this.db.prepare(`DELETE FROM tasks WHERE id = ?`).run(id);
    if (Number(result.changes) === 0) throw new Error('That task no longer exists.');
  }

  /** At startup: work that was under way when Edi quit is interrupted, never resumed blindly. */
  recover(at: number) {
    return Number(
      this.db
        .prepare(
          `UPDATE tasks SET status = 'interrupted', finished_at = ?
           WHERE status IN ('running', 'waiting', 'limited')`,
        )
        .run(at).changes,
    );
  }
}

const scheduleRow = z.object({
  id: z.string(),
  title: z.string(),
  prompt: z.string(),
  when: z.string(),
  notify: scheduleNotifySchema,
  budgetUsd: z.number(),
  enabled: z.number(),
  unattended: z.number(),
  createdAt: z.number(),
  lastRunAt: z.number().nullable(),
  nextRunAt: z.number().nullable(),
  lastResult: z.string(),
});
const scheduleColumns = `id, title, prompt, when_json AS "when", notify, budget_usd AS budgetUsd,
  enabled, unattended, created_at AS createdAt, last_run_at AS lastRunAt, next_run_at AS nextRunAt,
  last_result AS lastResult`;

/** Schedules and watches. A row whose rule no longer parses is skipped, never run. */
/** Saved "Always allow" choices, newest first. */
export class ApprovalRuleRepository {
  constructor(private readonly db: Database) {}

  list(): ApprovalRule[] {
    return this.db
      .prepare(
        `SELECT id, capability_id AS capabilityId, capability_title AS capabilityTitle, kind, value,
                label, created_at AS createdAt
         FROM approval_rules ORDER BY created_at DESC, rowid DESC LIMIT 500`,
      )
      .all()
      .flatMap(row => {
        const parsed = approvalRuleSchema.safeParse({ ...(row as object) });
        return parsed.success ? [parsed.data] : [];
      });
  }

  /** Adds a rule, or keeps the existing one for the same action and scope. */
  add(rule: ApprovalRule) {
    const valid = approvalRuleSchema.parse(rule);
    this.db
      .prepare(
        `INSERT INTO approval_rules (id, capability_id, capability_title, kind, value, label, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (capability_id, kind, value) DO NOTHING`,
      )
      .run(
        valid.id,
        valid.capabilityId,
        valid.capabilityTitle,
        valid.kind,
        valid.value,
        valid.label,
        valid.createdAt,
      );
  }

  remove(id: string) {
    return this.db.prepare(`DELETE FROM approval_rules WHERE id = ?`).run(id).changes > 0;
  }
}

export class ScheduleRepository {
  constructor(private readonly db: Database) {}

  private static parse(row: unknown): Schedule | null {
    const raw = scheduleRow.parse(row);
    const when = scheduleWhenSchema.safeParse(JSON.parse(raw.when));
    if (!when.success) return null;
    return { ...raw, when: when.data, enabled: raw.enabled === 1, unattended: raw.unattended === 1 };
  }

  create(schedule: Omit<Schedule, 'lastRunAt' | 'lastResult'>) {
    this.db
      .prepare(
        `INSERT INTO schedules (id, title, prompt, when_json, notify, budget_usd, enabled,
                                unattended, created_at, next_run_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        schedule.id,
        schedule.title.slice(0, 120),
        schedule.prompt,
        JSON.stringify(scheduleWhenSchema.parse(schedule.when)),
        schedule.notify,
        schedule.budgetUsd,
        schedule.enabled ? 1 : 0,
        schedule.unattended ? 1 : 0,
        schedule.createdAt,
        schedule.nextRunAt,
      );
  }

  get(id: string): Schedule | undefined {
    const row = this.db.prepare(`SELECT ${scheduleColumns} FROM schedules WHERE id = ?`).get(id);
    return (row && ScheduleRepository.parse(row)) || undefined;
  }

  list(limit: number): Schedule[] {
    return this.db
      .prepare(
        `SELECT ${scheduleColumns} FROM schedules
         ORDER BY enabled DESC, next_run_at IS NULL, next_run_at, created_at DESC LIMIT ?`,
      )
      .all(limit)
      .map(row => ScheduleRepository.parse(row))
      .filter((schedule): schedule is Schedule => schedule !== null);
  }

  /** Enabled schedules whose next run is at or before `now`, earliest first. */
  due(now: number): Schedule[] {
    return this.db
      .prepare(
        `SELECT ${scheduleColumns} FROM schedules
         WHERE enabled = 1 AND next_run_at IS NOT NULL AND next_run_at <= ?
         ORDER BY next_run_at`,
      )
      .all(now)
      .map(row => ScheduleRepository.parse(row))
      .filter((schedule): schedule is Schedule => schedule !== null);
  }

  update(
    id: string,
    change: {
      enabled?: boolean;
      unattended?: boolean;
      nextRunAt?: number | null;
      lastRunAt?: number;
      lastResult?: string;
    },
  ) {
    const fields: string[] = [];
    const values: (string | number | null)[] = [];
    if (change.enabled !== undefined) {
      fields.push('enabled = ?');
      values.push(change.enabled ? 1 : 0);
    }
    if (change.unattended !== undefined) {
      fields.push('unattended = ?');
      values.push(change.unattended ? 1 : 0);
    }
    if (change.nextRunAt !== undefined) {
      fields.push('next_run_at = ?');
      values.push(change.nextRunAt);
    }
    if (change.lastRunAt !== undefined) {
      fields.push('last_run_at = ?');
      values.push(change.lastRunAt);
    }
    if (change.lastResult !== undefined) {
      fields.push('last_result = ?');
      values.push(change.lastResult.slice(0, 8000));
    }
    if (!fields.length) return;
    this.db.prepare(`UPDATE schedules SET ${fields.join(', ')} WHERE id = ?`).run(...values, id);
  }

  remove(id: string) {
    const result = this.db.prepare(`DELETE FROM schedules WHERE id = ?`).run(id);
    if (Number(result.changes) === 0) throw new Error('That schedule no longer exists.');
  }
}

const recordedRow = z.object({
  id: z.string(),
  runId: z.string(),
  capability: z.string(),
  title: z.string(),
  effect: z.string(),
  status: z.string(),
  summary: z.string().nullable(),
  input: z.string().nullable(),
  output: z.string().nullable(),
  createdAt: z.number(),
});

const trailRow = z.object({
  id: z.string(),
  runId: z.string(),
  capability: z.string(),
  title: z.string(),
  status: z.string(),
  summary: z.string().nullable(),
});

export class ToolCallRepository {
  constructor(private readonly db: Database) {}

  /** The request a tool call answered, and its conversation: what Regenerate asks again. */
  origin(callId: string) {
    const row = this.db
      .prepare(
        `SELECT runs.prompt AS prompt, runs.note AS note, runs.thread_id AS conversationId,
                runs.task_id AS taskId
         FROM tool_calls JOIN runs ON runs.id = tool_calls.run_id
         WHERE tool_calls.id = ?`,
      )
      .get(callId);
    return row
      ? z
          .object({
            prompt: z.string(),
            note: z.string().nullable(),
            conversationId: z.string().nullable(),
            taskId: z.string().nullable(),
          })
          .parse(row)
      : undefined;
  }

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

  /** Every run's actions, oldest first: the trail under each reply in a conversation. */
  steps(runIds: readonly string[]) {
    const byRun = new Map<
      string,
      { callId: string; capability: string; title: string; status: ToolCallStatus; summary: string }[]
    >();
    if (!runIds.length) return byRun;
    const rows = this.db
      .prepare(
        `SELECT id, run_id AS runId, capability, title, status, summary FROM tool_calls
         WHERE run_id IN (${runIds.map(() => '?').join(', ')}) ORDER BY created_at`,
      )
      .all(...runIds);
    for (const raw of rows) {
      const row = trailRow.parse(raw);
      const steps = byRun.get(row.runId) ?? [];
      if (steps.length >= 40) continue;
      steps.push({
        callId: row.id,
        capability: row.capability.slice(0, 80),
        title: row.title.slice(0, 120) || row.capability.slice(0, 80),
        status: row.status as ToolCallStatus,
        summary: (row.summary ?? '').slice(0, 400),
      });
      byRun.set(row.runId, steps);
    }
    return byRun;
  }

  /** Recent calls, newest first, with what was asked and what came back (activity and undo). */
  recent(limit: number) {
    return this.db
      .prepare(
        `SELECT id, run_id AS runId, capability, title, effect, status, summary,
                input_json AS input, output_json AS output, created_at AS createdAt
         FROM tool_calls ORDER BY created_at DESC LIMIT ?`,
      )
      .all(Math.max(1, Math.min(500, limit)))
      .map(row => recordedRow.parse(row))
      .map(row => ({
        ...row,
        summary: row.summary ?? '',
        input: parseJson(row.input),
        output: parseJson(row.output),
      }));
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

  add(note: Omit<NoteRecord, 'pinnedAt'> & { toolCallId: string | null }) {
    this.db
      .prepare(
        `INSERT INTO notes (id, title, path, bytes, tool_call_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(note.id, note.title, note.path, note.bytes, note.toolCallId, note.createdAt);
  }

  get(id: string): NoteRecord | undefined {
    const row = this.db
      .prepare(
        `SELECT id, title, path, bytes, created_at AS createdAt, pinned_at AS pinnedAt
         FROM notes WHERE id = ?`,
      )
      .get(id);
    return row ? noteRow.parse(row) : undefined;
  }

  list(limit: number): NoteRecord[] {
    return this.db
      .prepare(
        `SELECT id, title, path, bytes, created_at AS createdAt, pinned_at AS pinnedAt
         FROM notes ORDER BY created_at DESC LIMIT ?`,
      )
      .all(limit)
      .map(row => noteRow.parse(row));
  }

  /** A new path only when the file was renamed along with the title. */
  update(note: { id: string; title: string; bytes: number; path?: string }) {
    const result = this.db
      .prepare(`UPDATE notes SET title = ?, bytes = ?, path = coalesce(?, path) WHERE id = ?`)
      .run(note.title, note.bytes, note.path ?? null, note.id);
    if (result.changes === 0) throw new Error('That note is no longer in Edi’s history.');
  }

  setPinned(id: string, pinnedAt: number | null) {
    const result = this.db.prepare(`UPDATE notes SET pinned_at = ? WHERE id = ?`).run(pinnedAt, id);
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
                created_at AS createdAt, updated_at AS updatedAt, pinned_at AS pinnedAt
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
                created_at AS createdAt, updated_at AS updatedAt, pinned_at AS pinnedAt
         FROM artifacts ORDER BY updated_at DESC LIMIT ?`,
      )
      .all(limit)
      .map(row => ArtifactRepository.parse(row));
  }

  /** A new path only when the file was renamed along with the title. */
  update(record: {
    id: string;
    title: string;
    content: unknown;
    bytes: number;
    updatedAt: number;
    path?: string;
  }) {
    const result = this.db
      .prepare(
        `UPDATE artifacts SET title = ?, content_json = ?, bytes = ?, updated_at = ?,
                path = coalesce(?, path)
         WHERE id = ?`,
      )
      .run(
        record.title,
        JSON.stringify(record.content),
        record.bytes,
        record.updatedAt,
        record.path ?? null,
        record.id,
      );
    if (result.changes === 0) throw new Error('That item is no longer in Edi’s workspace.');
  }

  setPinned(id: string, pinnedAt: number | null) {
    const result = this.db
      .prepare(`UPDATE artifacts SET pinned_at = ? WHERE id = ?`)
      .run(pinnedAt, id);
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

export interface ConnectorRecord {
  id: string;
  name: string;
  url: string;
  catalogId: string | null;
  provider: 'mcp' | 'composio';
  composioConnectionId: string | null;
  enabled: boolean;
  /** The server's tools as last listed, with the person's on/off choice for each. */
  tools: ConnectorTool[];
  addedAt: number;
}

const connectorRow = z.object({
  id: z.string(),
  name: z.string(),
  url: z.string(),
  catalogId: z.string().nullable(),
  provider: z.enum(['mcp', 'composio']),
  composioConnectionId: z.string().nullable(),
  enabled: z.number(),
  tools: z.string(),
  addedAt: z.number(),
});

export class ConnectorRepository {
  constructor(private readonly db: Database) {}

  private static parse(row: unknown): ConnectorRecord {
    const raw = connectorRow.parse(row);
    const tools = z.array(connectorToolSchema).max(200).safeParse(JSON.parse(raw.tools));
    return {
      ...raw,
      enabled: raw.enabled === 1,
      tools: tools.success ? tools.data : [],
    };
  }

  list(): ConnectorRecord[] {
    return this.db
      .prepare(
        `SELECT id, name, url, catalog_id AS catalogId, provider,
                composio_connection_id AS composioConnectionId,
                enabled, tools_json AS tools, added_at AS addedAt
         FROM connectors ORDER BY added_at, rowid LIMIT 50`,
      )
      .all()
      .map(row => ConnectorRepository.parse(row));
  }

  get(id: string) {
    return this.list().find(connector => connector.id === id);
  }

  add(connector: ConnectorRecord) {
    this.db
      .prepare(
        `INSERT INTO connectors (id, name, url, catalog_id, provider, composio_connection_id,
                                 enabled, tools_json, added_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        connector.id,
        connector.name.slice(0, 60),
        connector.url,
        connector.catalogId,
        connector.provider,
        connector.composioConnectionId,
        connector.enabled ? 1 : 0,
        JSON.stringify(connector.tools),
        connector.addedAt,
      );
  }

  update(
    id: string,
    patch: Partial<Pick<ConnectorRecord, 'enabled' | 'tools' | 'name' | 'composioConnectionId'>>,
  ) {
    const fields: string[] = [];
    const values: (string | number | null)[] = [];
    if (patch.enabled !== undefined) {
      fields.push('enabled = ?');
      values.push(patch.enabled ? 1 : 0);
    }
    if (patch.tools) {
      fields.push('tools_json = ?');
      values.push(JSON.stringify(z.array(connectorToolSchema).max(200).parse(patch.tools)));
    }
    if (patch.name) {
      fields.push('name = ?');
      values.push(patch.name.slice(0, 60));
    }
    if (patch.composioConnectionId !== undefined) {
      fields.push('composio_connection_id = ?');
      values.push(patch.composioConnectionId);
    }
    if (!fields.length) return;
    this.db.prepare(`UPDATE connectors SET ${fields.join(', ')} WHERE id = ?`).run(...values, id);
  }

  remove(id: string) {
    return this.db.prepare(`DELETE FROM connectors WHERE id = ?`).run(id).changes > 0;
  }
}

/** Safe summaries of failed model calls, kept to the most recent 500. */
export class FailureRepository {
  constructor(private readonly db: Database) {}

  add(
    failure: ProviderFailure & { runId: string | null; model: string; kind: string },
    at: number,
  ) {
    const valid = providerFailureSchema.parse({
      ...(failure.status === undefined ? {} : { status: failure.status }),
      ...(failure.provider ? { provider: failure.provider } : {}),
      ...(failure.code ? { code: failure.code } : {}),
      ...(failure.message ? { message: failure.message } : {}),
      step: failure.step,
    });
    transaction(this.db, () => {
      this.db
        .prepare(
          `INSERT INTO failures (at, run_id, model, kind, status, provider, code, message, step)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          at,
          failure.runId,
          failure.model.slice(0, 160),
          failure.kind.slice(0, 40),
          valid.status ?? null,
          valid.provider ?? null,
          valid.code ?? null,
          valid.message ?? null,
          valid.step,
        );
      this.db
        .prepare(
          `DELETE FROM failures WHERE id NOT IN (SELECT id FROM failures ORDER BY id DESC LIMIT 500)`,
        )
        .run();
    });
  }

  recent(limit: number) {
    return this.db
      .prepare(
        `SELECT at, run_id AS runId, model, kind, status, provider, code, message, step
         FROM failures ORDER BY id DESC LIMIT ?`,
      )
      .all(limit) as {
      at: number;
      runId: string | null;
      model: string;
      kind: string;
      status: number | null;
      provider: string | null;
      code: string | null;
      message: string | null;
      step: number;
    }[];
  }
}

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
        if (row.provider !== 'cartesia' && row.provider !== 'elevenlabs') continue;
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
  failures: FailureRepository;
  connectors: ConnectorRepository;
  conversations: ConversationRepository;
  tasks: TaskRepository;
  schedules: ScheduleRepository;
  approvalRules: ApprovalRuleRepository;
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
    failures: new FailureRepository(db),
    connectors: new ConnectorRepository(db),
    conversations: new ConversationRepository(db),
    tasks: new TaskRepository(db),
    schedules: new ScheduleRepository(db),
    approvalRules: new ApprovalRuleRepository(db),

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
