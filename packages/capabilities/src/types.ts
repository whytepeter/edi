import type { z } from 'zod';
import type { ApprovalPreview, ApprovalScope, ToolCallStatus } from '@edi/contracts';

/** read: no approval. write: changes something outside Edi and always needs review. */
export type Effect = 'read' | 'write';

export interface CallContext {
  callId: string;
  runId: string;
}

/** An action whose exact effect is fixed before review. Approval binds to this plan. */
export interface PreparedAction {
  preview: ApprovalPreview;
  /** Where "Always allow" may apply beyond this conversation; absent means this chat only. */
  scope?: ApprovalScope;
  execute(signal: AbortSignal): Promise<ActionResult>;
}

export interface ActionResult {
  /** One sentence for people and the model, e.g. “Saved “Groceries” to ~/Documents/…”. */
  summary: string;
  /** JSON-serializable detail returned to the model. */
  output?: unknown;
}

export interface Capability<Input = unknown> {
  /** Namespaced and stable, e.g. `notes.save`. */
  id: string;
  /** Short label people see in approvals and Activity. */
  title: string;
  /** Written for the model: when to use it and what it does. */
  description: string;
  effect: Effect;
  input: z.ZodType<Input>;
  /** The JSON Schema shown to the model, when it comes from elsewhere (an MCP server's tool). */
  inputSchema?: Record<string, unknown>;
  /** The connected app a tool comes from; built-in tools have none. */
  app?: string;
  timeoutMs: number;
  prepare(input: Input, context: CallContext): Promise<PreparedAction> | PreparedAction;
}

/** Keeps the input type linked between `input` and `prepare` at definition sites. */
export function defineCapability<Input>(capability: Capability<Input>): Capability<Input> {
  return capability;
}

/**
 * Throw from `execute` when the effect may already have happened (for example a
 * write interrupted part-way). The broker records `unknown`, never `failed`.
 */
export class OutcomeUnknownError extends Error {}

export type ToolOutcome = {
  status: Extract<ToolCallStatus, 'succeeded' | 'denied' | 'failed' | 'cancelled' | 'unknown'>;
  summary: string;
  output?: unknown;
};

/** Persists and publishes each transition. Implemented by the host (main process). */
export interface ToolCallRecorder {
  created(call: {
    id: string;
    runId: string;
    capability: string;
    title: string;
    effect: Effect;
    input: unknown;
    status: ToolCallStatus;
  }): void;
  decided(id: string, decision: 'approved' | 'denied'): void;
  finished(id: string, outcome: ToolOutcome): void;
}

/** Asks a person. Must reject with an AbortError if `signal` aborts first. */
export interface ApprovalGate {
  request(
    request: {
      callId: string;
      runId: string;
      /** Which kind of action this is, so a person can allow it for the rest of a chat. */
      capability: { id: string; title: string };
      preview: ApprovalPreview;
    },
    signal: AbortSignal,
  ): Promise<'approved' | 'denied'>;
}

/** What the agent worker exposes to the model. Names match /^[a-zA-Z0-9_-]{1,64}$/. */
export interface ToolManifestEntry {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  /** The connected app it comes from. */
  app?: string;
  /** Declared but shown to the model only after it finds the tool with `find_app_tools`. */
  deferred?: boolean;
}
