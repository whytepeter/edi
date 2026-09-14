import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import {
  CapabilityBroker,
  type Capability,
  type ToolCallRecorder,
  type ToolOutcome,
} from '@edi/capabilities';
import {
  presentationText,
  ruleAllows,
  modelIdSchema,
  type ApprovalRequest,
  type Task,
  type TaskStatus,
  type ToolStep,
} from '@edi/contracts';
import type { Repositories, TaskRecord } from '@edi/storage';
import { PausableTimer, WRAP_UP_MS } from './agent-service';
import type { ApprovalRules } from './approval-rules';
import { ApprovalQueue } from './approvals';
import type { OpenRouterCredentials } from './credentials';
import {
  recordFailure,
  recordWebSearch,
  workerMessageSchema,
  type HostMessage,
  type WorkerInput,
} from './worker-protocol';

/** Wall-clock budget for a task's run, excluding time waiting for a review or more budget. */
const TASK_BUDGET_MS = 15 * 60_000;
const TASK_STEPS = 25;
const MAX_TEXT = 32_000;
const HISTORY_TURNS = 6;

/** The part of a worker the service uses; tests pass a fake. */
export interface WorkerLike {
  on(event: 'message', listener: (message: unknown) => void): unknown;
  on(event: 'error' | 'exit', listener: () => void): unknown;
  postMessage(message: HostMessage): void;
  terminate(): Promise<number> | void;
}

interface TaskServiceOptions {
  credentials: OpenRouterCredentials;
  repositories: Repositories;
  capabilities: readonly Capability[];
  selfContext?: () => string;
  assistantName?: () => string;
  readerModel?: () => string | null;
  /** How many tasks run at once; the rest wait their turn. */
  maxRunning?: number;
  createWorker?: (data: WorkerInput) => WorkerLike;
  now?: () => number;
  /** Saved "Always allow" choices, shared with conversations. */
  rules?: ApprovalRules;
  /** A task finished (done, failed or stopped by its limit), for a quiet notice. */
  finished?: (task: Task) => void;
}

interface ActiveTask {
  id: string;
  runId: string;
  worker: WorkerLike;
  abort: AbortController;
  deadline: PausableTimer;
  /** The time budget ran out and the model was asked to finish from what it has. */
  wrappingUp: boolean;
  text: string;
  /** Over its cap: tool results wait here until the person allows more or stops it. */
  held: HostMessage[] | null;
}

const failures = {
  auth: 'OpenRouter rejected the saved key. Replace it in Settings → AI.',
  credits: 'OpenRouter has no available credits.',
  model: 'The selected model is unavailable or incompatible.',
  tools: 'The model couldn’t write out all of those actions at once.',
  temporary: 'OpenRouter could not answer after retrying.',
  unknown: 'OpenRouter could not complete this task.',
} as const;

/**
 * Background tasks: each runs the agent worker on its own, beside the conversation, with its
 * own steps, reviews and spending cap. Spending is checked after every model call; over the cap,
 * the task holds its next step and waits for the person, so nothing is lost by pausing.
 */
export class TaskService {
  private readonly active = new Map<string, ActiveTask>();
  private readonly runs = new Map<string, string>();
  private readonly steps = new Map<string, ToolStep[]>();
  private readonly allowed = new Map<string, Set<string>>();
  private readonly listeners = new Set<(tasks: Task[]) => void>();
  private readonly approvals = new ApprovalQueue(
    () => this.onApprovals(),
    request => {
      const taskId = this.runs.get(request.runId);
      return (
        Boolean(this.options.rules?.allows(request)) ||
        Boolean(taskId && this.allowed.get(taskId)?.has(request.capability.id))
      );
    },
  );
  private readonly broker: CapabilityBroker;
  private readonly now: () => number;
  private readonly stepRecorder: ToolCallRecorder;

  constructor(private readonly options: TaskServiceOptions) {
    this.now = options.now ?? Date.now;
    this.stepRecorder = this.recorder();
    this.broker = new CapabilityBroker(options.capabilities, {
      approvals: this.approvals,
      recorder: this.stepRecorder,
    });
  }

  onChange(listener: (tasks: Task[]) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** After a restart: interrupted work is marked, and queued tasks start. */
  resume() {
    this.options.repositories.tasks.recover(this.now());
    this.pump();
  }

  start(input: {
    prompt: string;
    title?: string;
    budgetUsd: number;
    conversationId: string | null;
    scheduleId?: string | null;
  }) {
    if (!this.options.credentials.configured) throw new Error('Set up OpenRouter first.');
    const id = randomUUID();
    const title =
      input.title?.trim().slice(0, 120) ||
      input.prompt.replace(/\s+/g, ' ').trim().slice(0, 80) ||
      'Task';
    this.options.repositories.tasks.create({
      id,
      title,
      prompt: input.prompt,
      budgetUsd: input.budgetUsd,
      conversationId: input.conversationId,
      scheduleId: input.scheduleId ?? null,
      at: this.now(),
    });
    this.pump();
    this.publish();
    return this.task(id)!;
  }

  stop(id: string) {
    const active = this.active.get(id);
    if (active) return this.finish(active, 'cancelled', 'Stopped.');
    const record = this.options.repositories.tasks.get(id);
    if (record?.status === 'queued') {
      this.options.repositories.tasks.update(id, { status: 'cancelled', finishedAt: this.now() });
      this.publish();
    }
  }

  remove(id: string) {
    if (this.active.has(id)) this.stop(id);
    this.options.repositories.tasks.remove(id);
    this.steps.delete(id);
    this.allowed.delete(id);
    this.publish();
  }

  /** Allow more spending; a task paused at its cap carries on. */
  raiseBudget(id: string, addUsd: number) {
    const record = this.options.repositories.tasks.get(id);
    if (!record) throw new Error('That task no longer exists.');
    const budgetUsd = Math.min(500, Math.round((record.budgetUsd + addUsd) * 100) / 100);
    this.options.repositories.tasks.update(id, { budgetUsd });
    const active = this.active.get(id);
    if (active?.held && record.spentUsd < budgetUsd) {
      const held = active.held;
      active.held = null;
      active.deadline.resume();
      this.options.repositories.tasks.update(id, { status: 'running' });
      for (const message of held) active.worker.postMessage(message);
    }
    this.publish();
  }

  get currentApproval(): ApprovalRequest | null {
    return this.approvals.current;
  }

  owns(callOrRunId: string) {
    return (
      this.runs.has(callOrRunId) ||
      [...this.steps.values()].some(list => list.some(step => step.callId === callOrRunId))
    );
  }

  respondToApproval(callId: string, decision: 'approve' | 'approve-always' | 'deny') {
    const head = this.approvals.current;
    if (!head || head.callId !== callId) throw new Error('That approval is no longer pending.');
    const taskId = this.runs.get(head.runId);
    const rule = decision === 'approve-always' ? this.options.rules?.save(head) : null;
    if (decision === 'approve-always' && !rule && taskId) {
      const set = this.allowed.get(taskId) ?? new Set<string>();
      set.add(head.capability.id);
      this.allowed.set(taskId, set);
    }
    this.approvals.respond(
      callId,
      decision === 'deny' ? 'denied' : 'approved',
      rule ? request => ruleAllows(rule, request) : decision === 'approve-always',
    );
  }

  list(limit = 50): Task[] {
    return this.options.repositories.tasks.list(limit).map(record => this.toTask(record));
  }

  task(id: string): Task | undefined {
    const record = this.options.repositories.tasks.get(id);
    return record ? this.toTask(record) : undefined;
  }

  dispose() {
    for (const active of [...this.active.values()]) this.finish(active, 'interrupted', 'Edi quit.');
  }

  private pump() {
    const max = this.options.maxRunning ?? 2;
    if (this.active.size >= max) return;
    const queued = this.options.repositories.tasks
      .list(100)
      .filter(record => record.status === 'queued');
    for (const record of queued) {
      if (this.active.size >= max) break;
      this.launch(record);
    }
  }

  private launch(record: TaskRecord) {
    const { credentials, repositories } = this.options;
    const runId = randomUUID();
    const at = this.now();
    repositories.runs.start({
      id: runId,
      prompt: record.prompt,
      model: credentials.model,
      screens: 0,
      startedAt: at,
      taskId: record.id,
    });
    repositories.tasks.update(record.id, { status: 'running', startedAt: at });
    const readerModel = modelIdSchema.safeParse(this.options.readerModel?.()).data;
    const data: WorkerInput = {
      apiKey: credentials.apiKey,
      model: credentials.model,
      name: this.options.assistantName?.() ?? 'Edi',
      prompt: record.prompt,
      history: repositories.runs.recentExchanges(HISTORY_TURNS, record.conversationId),
      screenshots: [],
      spoken: false,
      mode: 'task',
      maxSteps: TASK_STEPS,
      expressiveVoice: false,
      selfContext: this.options.selfContext?.() ?? '',
      desktopContext: null,
      ...(readerModel ? { readerModel } : {}),
      tools: this.broker.manifest(),
    };
    const worker = (this.options.createWorker ?? spawnWorker)(data);
    const active: ActiveTask = {
      id: record.id,
      runId,
      worker,
      abort: new AbortController(),
      deadline: new PausableTimer(TASK_BUDGET_MS, () => {
        if (active.wrappingUp) return this.finish(active, 'failed', 'The task ran out of time.');
        active.wrappingUp = true;
        active.worker.postMessage({ type: 'wrap-up' });
        active.deadline.restart(WRAP_UP_MS);
      }),
      wrappingUp: false,
      text: '',
      held: null,
    };
    this.active.set(record.id, active);
    this.runs.set(runId, record.id);
    worker.on('message', raw => this.onMessage(active, raw));
    worker.on('error', () => this.finish(active, 'failed', 'The task worker could not start.'));
    worker.on('exit', () => this.finish(active, 'failed', 'The task worker ended unexpectedly.'));
  }

  private onMessage(active: ActiveTask, raw: unknown) {
    const parsed = workerMessageSchema.safeParse(raw);
    if (!parsed.success)
      return this.finish(active, 'failed', 'The task worker sent something unexpected.');
    const message = parsed.data;
    const { repositories } = this.options;
    if (message.type === 'usage') {
      try {
        repositories.usage.add(message.entry, this.now(), active.runId);
      } catch {
        // Usage records are best effort.
      }
      const record = repositories.tasks.get(active.id);
      if (
        this.active.get(active.id) === active &&
        record &&
        record.spentUsd >= record.budgetUsd &&
        !active.held
      ) {
        active.held = [];
        active.deadline.pause();
        repositories.tasks.update(active.id, { status: 'limited' });
        this.publish();
      }
      return;
    }
    if (this.active.get(active.id) !== active) return;
    if (message.type === 'text') {
      active.text = (active.text + message.text).slice(0, MAX_TEXT);
    } else if (message.type === 'web-search') {
      recordWebSearch(this.stepRecorder, active.runId, message);
    } else if (message.type === 'tool-call') {
      void this.invokeTool(active, message.id, message.name, message.input);
    } else if (message.type === 'done') {
      this.finish(active, 'done');
    } else if (message.type === 'error') {
      recordFailure(
        this.options.repositories,
        active.runId,
        this.options.credentials.model,
        message,
      );
      this.finish(active, 'failed', failures[message.kind]);
    }
  }

  private async invokeTool(active: ActiveTask, id: string, name: string, input: unknown) {
    let outcome: ToolOutcome;
    try {
      outcome = await this.broker.invoke(active.runId, name, input, active.abort.signal);
    } catch {
      outcome = { status: 'failed', summary: 'Edi could not record or run this action.' };
    }
    if (this.active.get(active.id) !== active) return;
    const reply: HostMessage = { type: 'tool-result', id, outcome };
    if (active.held) active.held.push(reply);
    else active.worker.postMessage(reply);
  }

  private finish(
    active: ActiveTask,
    status: Extract<TaskStatus, 'done' | 'failed' | 'cancelled' | 'interrupted'>,
    error = '',
  ) {
    if (this.active.get(active.id) !== active) return;
    this.active.delete(active.id);
    active.deadline.clear();
    active.abort.abort();
    active.worker.postMessage({ type: 'stop' });
    void active.worker.terminate();
    const { repositories } = this.options;
    const at = this.now();
    const result = presentationText(active.text).trim();
    repositories.runs.finish(active.runId, {
      status: status === 'done' ? 'done' : status === 'failed' ? 'error' : 'stopped',
      text: result,
      error,
      at,
    });
    repositories.tasks.update(active.id, { status, result, error, finishedAt: at });
    const task = this.task(active.id);
    this.pump();
    this.publish();
    if (task && status !== 'interrupted') this.options.finished?.(task);
  }

  private onApprovals() {
    const head = this.approvals.current;
    for (const active of this.active.values()) {
      const waiting = head?.runId === active.runId;
      const record = this.options.repositories.tasks.get(active.id);
      if (!record || record.status === 'limited') continue;
      if (waiting && record.status !== 'waiting') {
        active.deadline.pause();
        this.options.repositories.tasks.update(active.id, { status: 'waiting' });
      } else if (!waiting && record.status === 'waiting') {
        active.deadline.resume();
        this.options.repositories.tasks.update(active.id, { status: 'running' });
      }
    }
    this.publish();
  }

  private recorder(): ToolCallRecorder {
    const { toolCalls } = this.options.repositories;
    const patch = (callId: string, change: Partial<ToolStep>) => {
      for (const [taskId, list] of this.steps) {
        if (!list.some(step => step.callId === callId)) continue;
        this.steps.set(
          taskId,
          list.map(step => (step.callId === callId ? { ...step, ...change } : step)),
        );
      }
      this.publish();
    };
    return {
      created: call => {
        toolCalls.create({ ...call, at: this.now() });
        const taskId = this.runs.get(call.runId);
        if (!taskId) return;
        const step: ToolStep = {
          callId: call.id,
          capability: call.capability,
          title: call.title,
          status: call.status,
          summary: '',
        };
        this.steps.set(taskId, [...(this.steps.get(taskId) ?? []), step].slice(-40));
        this.publish();
      },
      decided: (id, decision) => {
        toolCalls.decide(id, decision, this.now());
        if (decision === 'approved') patch(id, { status: 'running' });
      },
      finished: (id, outcome) => {
        toolCalls.finish(id, outcome.status, outcome.summary, outcome.output, this.now());
        patch(id, { status: outcome.status, summary: outcome.summary.slice(0, 400) });
      },
    };
  }

  private toTask(record: TaskRecord): Task {
    const { repositories } = this.options;
    const active = this.active.get(record.id);
    const steps = active
      ? (this.steps.get(record.id) ?? [])
      : repositories.tasks.steps(record.id).slice(-40);
    const latest = [...steps].reverse()[0];
    const head = this.approvals.current;
    const runIds = repositories.tasks.runIds(record.id);
    const artifactIds = runIds.length
      ? repositories.toolCalls
          .shown(['workspace.show'], { runIds })
          .map(call => call.id)
          .slice(-10)
      : [];
    const progress =
      record.status === 'limited'
        ? `Reached its $${record.budgetUsd.toFixed(2)} cap`
        : latest
          ? `${latest.title}${latest.summary ? `: ${latest.summary}` : ''}`
          : record.status === 'queued'
            ? 'Waiting to start'
            : '';
    return {
      id: record.id,
      title: record.title,
      prompt: record.prompt,
      status: record.status,
      createdAt: record.createdAt,
      startedAt: record.startedAt,
      finishedAt: record.finishedAt,
      budgetUsd: record.budgetUsd,
      spentUsd: Math.round(record.spentUsd * 10_000) / 10_000,
      scheduleId: record.scheduleId,
      progress: progress.slice(0, 200),
      steps,
      result: record.result,
      error: record.error,
      artifactIds,
      approval: head && active && head.runId === active.runId ? head : null,
    };
  }

  private publish() {
    if (!this.listeners.size) return;
    const tasks = this.list();
    for (const listener of this.listeners) listener(tasks);
  }
}

function spawnWorker(data: WorkerInput): WorkerLike {
  return new Worker(join(__dirname, 'agent-worker.js'), { workerData: data });
}
