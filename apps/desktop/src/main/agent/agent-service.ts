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
  emptyAgentState,
  parsePresentation,
  resolvePresentation,
  type AgentState,
  type ApprovalRequest,
  type ChatMessage,
  type ToolStep,
} from '@edi/contracts';
import type { Repositories, ThreadTurn } from '@edi/storage';
import type { Screenshot, ScreenAccess } from '../capture/screens';

type CapturedScreens = { screenshots: Screenshot[]; access: ScreenAccess };
import { ApprovalQueue } from './approvals';
import type { OpenRouterCredentials } from './credentials';
import { workerMessageSchema, type HostMessage, type WorkerInput } from './worker-protocol';

/** Wall-clock budget for a run, excluding time spent waiting for a person to decide. */
const RUN_BUDGET_MS = 120_000;
/** Conversation context: completed exchanges sent with each request. */
const HISTORY_TURNS = 10;
const MAX_TEXT = 32_000;
const MAX_STEPS_SHOWN = 20;

interface AgentServiceOptions {
  credentials: OpenRouterCredentials;
  repositories: Repositories;
  capabilities: readonly Capability[];
  /** Called on every request; there is no per-request screen prompt. */
  captureScreens: () => Promise<CapturedScreens>;
  /** A finished reply pointed at something on screen (global logical coordinates). */
  point?: (target: PointTarget) => void;
}

export type PointTarget = NonNullable<ReturnType<typeof resolvePresentation>>;

interface ActiveRun {
  id: string;
  /** Kept in memory for this run only (to map pointing back to displays). Never stored. */
  screenshots: Screenshot[];
  worker: Worker;
  abort: AbortController;
  deadline: PausableTimer;
}

type FinishedStatus = Extract<AgentState['status'], 'done' | 'stopped' | 'error'>;

/**
 * One foreground run at a time. Owns the worker, the run record, tool steps and
 * approvals; knows nothing about windows.
 */
export class AgentService {
  state: AgentState = emptyAgentState();
  private run?: ActiveRun;
  /** Finished turns shown in the card; refreshed on load and when a run ends. */
  private cachedThread: ThreadTurn[] = [];
  /** Set while screens are being captured, so a second ask or a Stop is handled. */
  private starting?: object;
  private configuring = false;
  private readonly listeners = new Set<(state: AgentState) => void>();
  private readonly approvals = new ApprovalQueue(head => this.onApprovalChange(head));
  private readonly broker: CapabilityBroker;

  constructor(private readonly options: AgentServiceOptions) {
    this.broker = new CapabilityBroker(options.capabilities, {
      approvals: this.approvals,
      recorder: this.recorder(),
    });
  }

  onChange(listener: (state: AgentState) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Launch / Settings flow updates this before the first ask. */
  rememberScreenAccess(access: ScreenAccess) {
    this.update({ ...this.state, screenAccess: access });
  }

  async load() {
    await this.options.credentials.load();
    const { configured, model } = this.options.credentials;
    this.refreshThread();
    this.state = this.withMessages({ ...this.state, configured, model });
  }

  async configure(apiKey: string, model: string) {
    if (this.configuring || this.run)
      throw new Error('Stop the response before changing the connection.');
    this.configuring = true;
    try {
      await this.options.credentials.save(apiKey, model);
      this.update({ ...idle(), configured: true, model });
    } finally {
      this.configuring = false;
    }
  }

  async disconnect() {
    if (this.configuring) throw new Error('Connection update in progress.');
    this.configuring = true;
    try {
      this.stop();
      await this.options.credentials.clear();
      this.update(idle());
    } finally {
      this.configuring = false;
    }
  }

  /**
   * Starts a run and resolves with its ID. Screens are captured now unless the caller
   * already captured them (voice takes them the moment the question ends).
   * `spoken` asks for a short answer that will be read aloud.
   */
  async ask(
    prompt: string,
    options: { screens?: CapturedScreens; spoken?: boolean } = {},
  ): Promise<string | undefined> {
    const { credentials, repositories } = this.options;
    if (!credentials.configured || this.configuring) throw new Error('Set up OpenRouter first.');
    if (this.run || this.starting) throw new Error('A response is already running.');

    const starting = {};
    this.starting = starting;
    this.update({
      ...this.state,
      status: 'running',
      runId: null,
      prompt,
      text: '',
      error: '',
      steps: [],
      approval: null,
    });
    const { screenshots, access } = await (
      options.screens ? Promise.resolve(options.screens) : this.options.captureScreens()
    ).catch((): CapturedScreens => ({ screenshots: [], access: 'unknown' }));
    if (this.starting !== starting) return undefined; // stopped while capturing
    this.starting = undefined;

    const id = randomUUID();
    repositories.runs.start({
      id,
      prompt,
      model: credentials.model,
      screens: screenshots.length,
      startedAt: Date.now(),
    });
    const workerData: WorkerInput = {
      apiKey: credentials.apiKey,
      model: credentials.model,
      prompt,
      history: repositories.runs.recentExchanges(HISTORY_TURNS),
      screenshots: screenshots.map(({ label, jpeg }) => ({ label, jpeg })),
      spoken: options.spoken ?? false,
      tools: this.broker.manifest(),
    };
    const run: ActiveRun = {
      id,
      screenshots,
      worker: new Worker(join(__dirname, 'agent-worker.js'), { workerData }),
      abort: new AbortController(),
      deadline: new PausableTimer(RUN_BUDGET_MS, () =>
        this.finish(run, 'error', 'The response timed out. You can try again.'),
      ),
    };
    this.run = run;
    this.update({ ...this.state, runId: id, screenAccess: access });

    run.worker.on('message', raw => this.onWorkerMessage(run, raw));
    run.worker.on('error', () => this.finish(run, 'error', 'The response worker could not start.'));
    run.worker.on('exit', () =>
      this.finish(run, 'error', 'The response worker ended unexpectedly.'),
    );
    return id;
  }

  /** Resolves with the final state of `runId`, or rejects if `signal` aborts first. */
  whenFinished(runId: string, signal: AbortSignal): Promise<AgentState> {
    return new Promise((resolve, reject) => {
      const check = (state: AgentState) => {
        if (state.runId !== runId || state.status === 'running') return;
        unsubscribe();
        resolve(state);
      };
      const unsubscribe = this.onChange(check);
      signal.addEventListener(
        'abort',
        () => {
          unsubscribe();
          reject(new Error('Stopped'));
        },
        { once: true },
      );
      check(this.state);
    });
  }

  stop() {
    if (this.starting) {
      this.starting = undefined;
      this.update({ ...this.state, status: 'stopped' });
    }
    if (this.run) this.finish(this.run, 'stopped');
  }

  /** Bound to the pending call: a decision for any other call ID is rejected. */
  respondToApproval(callId: string, decision: 'approve' | 'deny') {
    if (!this.run || this.state.approval?.callId !== callId) {
      throw new Error('That approval is no longer pending.');
    }
    this.approvals.respond(callId, decision === 'approve' ? 'approved' : 'denied');
  }

  private onWorkerMessage(run: ActiveRun, raw: unknown) {
    if (this.run !== run) return;
    const parsed = workerMessageSchema.safeParse(raw);
    if (!parsed.success) {
      this.finish(run, 'error', 'The response worker sent something unexpected.');
      return;
    }
    const message = parsed.data;
    if (message.type === 'text') {
      if (this.state.text.length + message.text.length > MAX_TEXT) {
        this.finish(run, 'error', 'Response reached the display limit. Ask for a shorter answer.');
        return;
      }
      this.update({ ...this.state, text: this.state.text + message.text });
    } else if (message.type === 'tool-call') {
      void this.invokeTool(run, message.id, message.name, message.input);
    } else if (message.type === 'done') {
      const produced = this.state.text || this.state.steps.length;
      this.finish(
        run,
        produced ? 'done' : 'error',
        produced ? '' : 'No text was returned. Try a text-capable model.',
      );
    } else {
      this.finish(
        run,
        'error',
        'OpenRouter could not complete this response. Check your key, model ID, credits, and connection.',
      );
    }
  }

  private async invokeTool(run: ActiveRun, id: string, name: string, input: unknown) {
    let outcome: ToolOutcome;
    try {
      outcome = await this.broker.invoke(run.id, name, input, run.abort.signal);
    } catch {
      outcome = { status: 'failed', summary: 'Edi could not record or run this action.' };
    }
    if (this.run === run)
      run.worker.postMessage({ type: 'tool-result', id, outcome } satisfies HostMessage);
  }

  private finish(run: ActiveRun, status: FinishedStatus, error = '') {
    if (this.run !== run) return;
    this.run = undefined;
    run.deadline.clear();
    // Aborting cancels pending approvals and in-flight tools; the broker records each.
    run.abort.abort();
    run.worker.postMessage({ type: 'stop' } satisfies HostMessage);
    void run.worker.terminate();
    // The pointing tag is an instruction for Edi, not part of the answer.
    const presentation = parsePresentation(this.state.text);
    const { text } = presentation;
    this.options.repositories.runs.finish(run.id, { status, text, error, at: Date.now() });
    this.refreshThread();
    this.update({ ...this.state, status, text, error, approval: null });
    const target = status === 'done' ? resolvePresentation(presentation, run.screenshots) : null;
    if (target) this.options.point?.(target);
  }

  private onApprovalChange(head: ApprovalRequest | null) {
    if (!this.run) return;
    if (head) this.run.deadline.pause();
    else this.run.deadline.resume();
    this.update({ ...this.state, approval: head });
  }

  /** Persists every transition and mirrors the current run's steps into state. */
  private recorder(): ToolCallRecorder {
    const { toolCalls } = this.options.repositories;
    const patch = (callId: string, change: Partial<ToolStep>) => {
      if (!this.state.steps.some(step => step.callId === callId)) return; // a previous run
      this.update({
        ...this.state,
        steps: this.state.steps.map(step =>
          step.callId === callId ? { ...step, ...change } : step,
        ),
      });
    };
    return {
      created: call => {
        toolCalls.create({ ...call, at: Date.now() });
        if (call.runId !== this.state.runId) return;
        const step: ToolStep = {
          callId: call.id,
          capability: call.capability,
          title: call.title,
          status: call.status,
          summary: '',
        };
        this.update({ ...this.state, steps: [...this.state.steps, step].slice(-MAX_STEPS_SHOWN) });
      },
      decided: (id, decision) => {
        toolCalls.decide(id, decision, Date.now());
        if (decision === 'approved') patch(id, { status: 'running' });
      },
      finished: (id, outcome) => {
        toolCalls.finish(id, outcome.status, outcome.summary, outcome.output, Date.now());
        patch(id, { status: outcome.status, summary: outcome.summary.slice(0, 400) });
      },
    };
  }

  private refreshThread() {
    this.cachedThread = this.options.repositories.runs.thread(HISTORY_TURNS);
  }

  private withMessages(state: AgentState): AgentState {
    return { ...state, messages: this.buildMessages(state) };
  }

  private buildMessages(state: AgentState): ChatMessage[] {
    const messages: ChatMessage[] = [];
    const seen = new Set<string>();
    for (const turn of this.cachedThread) {
      if (state.status === 'running' && turn.id === state.runId) continue;
      seen.add(turn.id);
      messages.push({ id: `${turn.id}-u`, role: 'user', text: turn.prompt });
      const reply = turn.reply || turn.error;
      if (reply) messages.push({ id: `${turn.id}-a`, role: 'assistant', text: reply });
    }
    const live =
      Boolean(state.prompt) &&
      (state.status === 'running' || !state.runId || !seen.has(state.runId));
    if (live) {
      const id = state.runId ?? 'pending';
      messages.push({ id: `${id}-u`, role: 'user', text: state.prompt });
      if (state.text || state.status === 'running') {
        messages.push({ id: `${id}-a`, role: 'assistant', text: state.text });
      } else if (state.error) {
        messages.push({ id: `${id}-a`, role: 'assistant', text: state.error });
      }
    }
    return messages.slice(-24);
  }

  private update(state: AgentState) {
    this.state = this.withMessages(state);
    const snapshot = { ...this.state };
    for (const listener of this.listeners) listener(snapshot);
  }
}

function idle(): AgentState {
  return emptyAgentState();
}

/** A one-shot timer whose remaining time survives pause/resume. */
class PausableTimer {
  private timer?: ReturnType<typeof setTimeout>;
  private startedAt = 0;

  constructor(
    private remaining: number,
    private readonly onExpire: () => void,
  ) {
    this.resume();
  }

  pause() {
    if (!this.timer) return;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.remaining -= Date.now() - this.startedAt;
  }

  resume() {
    if (this.timer) return;
    this.startedAt = Date.now();
    this.timer = setTimeout(this.onExpire, Math.max(0, this.remaining));
  }

  clear() {
    clearTimeout(this.timer);
    this.timer = undefined;
  }
}
