import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import {
  CapabilityBroker,
  type Capability,
  type ToolCallRecorder,
  type ToolOutcome,
} from '@edi/capabilities';
import type { AgentState, ApprovalRequest, ToolStep } from '@edi/contracts';
import type { Repositories } from '@edi/storage';
import type { Screenshot, ScreenAccess } from '../capture/screens';
import { ApprovalQueue } from './approvals';
import type { OpenRouterCredentials } from './credentials';
import { workerMessageSchema, type HostMessage, type WorkerInput } from './worker-protocol';

/** Wall-clock budget for a run, excluding time spent waiting for a person to decide. */
const RUN_BUDGET_MS = 120_000;
/** Conversation context: completed exchanges sent with each request (heyclicky uses 10). */
const HISTORY_TURNS = 10;
const MAX_TEXT = 32_000;
const MAX_STEPS_SHOWN = 20;

interface AgentServiceOptions {
  credentials: OpenRouterCredentials;
  repositories: Repositories;
  capabilities: readonly Capability[];
  /** Called on every request; there is no per-request screen prompt. */
  captureScreens: () => Promise<{ screenshots: Screenshot[]; access: ScreenAccess }>;
}

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
  state: AgentState = {
    configured: false,
    model: '',
    status: 'idle',
    runId: null,
    text: '',
    error: '',
    steps: [],
    approval: null,
    screenAccess: null,
  };
  private run?: ActiveRun;
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

  async load() {
    await this.options.credentials.load();
    const { configured, model } = this.options.credentials;
    this.state = { ...this.state, configured, model };
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

  async ask(prompt: string) {
    const { credentials, repositories } = this.options;
    if (!credentials.configured || this.configuring) throw new Error('Set up OpenRouter first.');
    if (this.run || this.starting) throw new Error('A response is already running.');

    const starting = {};
    this.starting = starting;
    this.update({
      ...this.state,
      status: 'running',
      runId: null,
      text: '',
      error: '',
      steps: [],
      approval: null,
    });
    const { screenshots, access } = await this.options.captureScreens().catch(() => ({
      screenshots: [] as Screenshot[],
      access: 'unknown' as const,
    }));
    if (this.starting !== starting) return; // stopped while capturing
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
    this.options.repositories.runs.finish(run.id, {
      status,
      text: this.state.text,
      error,
      at: Date.now(),
    });
    this.update({ ...this.state, status, error, approval: null });
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

  private update(state: AgentState) {
    this.state = state;
    const snapshot = { ...state };
    for (const listener of this.listeners) listener(snapshot);
  }
}

function idle(): AgentState {
  return {
    configured: false,
    model: '',
    status: 'idle',
    runId: null,
    text: '',
    error: '',
    steps: [],
    approval: null,
    screenAccess: null,
  };
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
