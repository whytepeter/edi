import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  OutcomeUnknownError,
  type ApprovalGate,
  type Capability,
  type ToolCallRecorder,
  type ToolManifestEntry,
  type ToolOutcome,
} from './types';

interface BrokerDependencies {
  approvals: ApprovalGate;
  recorder: ToolCallRecorder;
  id?: () => string;
}

/** Connected-app tools sent to the model directly; more than this and they are found by search. */
export const DIRECT_APP_TOOLS = 40;

/** Model-facing names cannot contain dots: `notes.save` → `notes_save`. */
export const toolNameFor = (capabilityId: string) => capabilityId.replace(/[^a-zA-Z0-9_-]/g, '_');

/**
 * The only path from a model's tool call to an effect:
 *
 *   validate input → prepare exact effect → review (writes) → recheck Stop
 *     → execute with a deadline → record outcome
 *
 * Writes run one at a time; reads may overlap.
 */
export class CapabilityBroker {
  private readonly fixed = new Map<string, Capability>();
  private writeQueue: Promise<unknown> = Promise.resolve();
  private readonly id: () => string;

  /**
   * `extra` supplies capabilities that come and go while Edi runs (connected apps); they never
   * replace a built-in one with the same name.
   */
  constructor(
    capabilities: readonly Capability[],
    private readonly deps: BrokerDependencies,
    private readonly extra: () => readonly Capability[] = () => [],
  ) {
    for (const capability of capabilities) {
      const name = toolNameFor(capability.id);
      if (this.fixed.has(name)) throw new Error(`Duplicate tool name: ${name}`);
      this.fixed.set(name, capability);
    }
    this.id = deps.id ?? randomUUID;
  }

  private get byName() {
    const extra = this.extra();
    if (!extra.length) return this.fixed;
    const all = new Map(this.fixed);
    for (const capability of extra) {
      const name = toolNameFor(capability.id);
      if (!all.has(name)) all.set(name, capability);
    }
    return all;
  }

  /**
   * Every tool, for the model. Past `DIRECT_APP_TOOLS` connected-app tools, all of them are
   * deferred: the model finds the ones it needs by search, keeping each request small and within
   * providers' tool limits. Built-in tools are never deferred.
   */
  manifest(): ToolManifestEntry[] {
    const entries = [...this.byName];
    const defer = entries.filter(([, capability]) => capability.app).length > DIRECT_APP_TOOLS;
    return entries.map(([name, capability]) => ({
      name,
      description: capability.description,
      inputSchema:
        capability.inputSchema ?? (z.toJSONSchema(capability.input) as Record<string, unknown>),
      ...(capability.app ? { app: capability.app } : {}),
      ...(defer && capability.app ? { deferred: true } : {}),
    }));
  }

  async invoke(
    runId: string,
    toolName: string,
    rawInput: unknown,
    signal: AbortSignal,
  ): Promise<ToolOutcome> {
    const capability = this.byName.get(toolName);
    if (!capability) return { status: 'failed', summary: `Edi has no tool named ${toolName}.` };

    const callId = this.id();
    const parsed = capability.input.safeParse(rawInput);
    const needsReview = capability.effect !== 'read';
    const { recorder } = this.deps;
    recorder.created({
      id: callId,
      runId,
      capability: capability.id,
      title: capability.title,
      effect: capability.effect,
      input: parsed.success ? parsed.data : rawInput,
      status: needsReview && parsed.success ? 'awaiting-approval' : 'running',
    });
    const finish = (outcome: ToolOutcome) => {
      recorder.finished(callId, outcome);
      return outcome;
    };

    if (!parsed.success) {
      return finish({
        status: 'failed',
        summary: `Invalid input: ${z.prettifyError(parsed.error).slice(0, 300)}`,
      });
    }
    const run = () => this.review(capability, parsed.data, { callId, runId }, signal);
    const outcome = needsReview ? await this.serialized(run) : await run();
    return finish(outcome);
  }

  private async review(
    capability: Capability,
    input: unknown,
    context: { callId: string; runId: string },
    signal: AbortSignal,
  ): Promise<ToolOutcome> {
    if (signal.aborted) return cancelled;
    let action;
    try {
      action = await capability.prepare(input, context);
    } catch (error) {
      return { status: 'failed', summary: message(error, 'Edi could not prepare this action.') };
    }

    if (capability.effect !== 'read') {
      let decision: 'approved' | 'denied';
      try {
        decision = await this.deps.approvals.request(
          {
            ...context,
            capability: { id: capability.id, title: capability.title },
            preview: action.preview,
            ...(action.scope ? { scope: action.scope } : {}),
          },
          signal,
        );
      } catch {
        return cancelled;
      }
      this.deps.recorder.decided(context.callId, decision);
      if (decision === 'denied') {
        return { status: 'denied', summary: 'You declined this action. Nothing was changed.' };
      }
    }

    // Recheck immediately before the effect: Stop after approval must still prevent it.
    if (signal.aborted) return cancelled;
    return this.execute(capability, action.execute, signal);
  }

  private async execute(
    capability: Capability,
    execute: (signal: AbortSignal) => Promise<{ summary: string; output?: unknown }>,
    signal: AbortSignal,
  ): Promise<ToolOutcome> {
    const deadline = AbortSignal.timeout(capability.timeoutMs);
    const combined = AbortSignal.any([signal, deadline]);
    const interrupted = new Promise<never>((_, reject) => {
      combined.addEventListener('abort', () => reject(combined.reason), { once: true });
    });
    try {
      const result = await Promise.race([execute(combined), interrupted]);
      return { status: 'succeeded', summary: result.summary.slice(0, 400), output: result.output };
    } catch (error) {
      const write = capability.effect !== 'read';
      if (error instanceof OutcomeUnknownError || (write && combined.aborted)) {
        return {
          status: 'unknown',
          summary: deadline.aborted
            ? 'This took too long and was abandoned. It may have partly happened; check before retrying.'
            : 'Stopped while running. It may have partly happened; check before retrying.',
        };
      }
      if (signal.aborted) return cancelled;
      if (deadline.aborted)
        return { status: 'failed', summary: 'This took too long and was stopped.' };
      return { status: 'failed', summary: message(error, `${capability.title} failed.`) };
    }
  }

  private serialized<T>(work: () => Promise<T>): Promise<T> {
    const result = this.writeQueue.then(work, work);
    this.writeQueue = result.catch(() => {});
    return result;
  }
}

const cancelled: ToolOutcome = {
  status: 'cancelled',
  summary: 'Stopped before it ran. Nothing was changed.',
};

function message(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message.slice(0, 300) : fallback;
}
