import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import type { ToolCallRecorder, ToolOutcome } from '@edi/capabilities';
import type { Repositories } from '@edi/storage';
import {
  assistantNameSchema,
  desktopContextSchema,
  modelIdSchema,
  providerFailureSchema,
  usageEntrySchema,
} from '@edi/contracts';

const bytesWithin = (limit: number) =>
  z.custom<Uint8Array>(
    value => value instanceof Uint8Array && value.byteLength > 0 && value.byteLength <= limit,
  );

const toolManifestEntrySchema = z
  .object({
    name: z.string().min(1).max(64),
    description: z.string().min(1).max(2_000),
    inputSchema: z.record(z.string(), z.unknown()),
  })
  .strict();

/** Passed once at startup. The worker never receives OS handles or other secrets. */
export const workerInputSchema = z
  .object({
    apiKey: z.string().min(10).max(4_096),
    model: modelIdSchema,
    /** What the person calls their companion. */
    name: assistantNameSchema.default('Edi'),
    /** A fast model that reads fetched pages and answers Edi's question; defaults to `model`. */
    readerModel: modelIdSchema.optional(),
    prompt: z.string().min(1).max(8_000),
    /** Earlier completed exchanges, oldest first, text only. */
    history: z
      .array(z.object({ prompt: z.string().max(8_000), reply: z.string().max(32_000) }).strict())
      .max(10),
    /** Taken when the person asked; JPEG bytes, labelled for the model. */
    screenshots: z
      .array(
        z
          .object({ label: z.string().min(1).max(160), jpeg: bytesWithin(8 * 1024 * 1024) })
          .strict(),
      )
      .max(4),
    /** The question was spoken and the reply will be read aloud. */
    spoken: z.boolean(),
    /** A background task works on its own for longer; chat answers the person in front of it. */
    mode: z.enum(['chat', 'task']).default('chat'),
    /** Model steps allowed in this run. */
    maxSteps: z.number().int().min(1).max(40).default(10),
    /** Selected speech engine supports Chatterbox paralinguistic expression tags. */
    expressiveVoice: z.boolean().default(false),
    /** What the person had in front of them when they asked; data from other apps. */
    desktopContext: desktopContextSchema.nullable().default(null),
    /** Trusted, current, non-secret product configuration supplied by main. */
    selfContext: z.string().max(12_000).default(''),
    tools: z.array(toolManifestEntrySchema).max(64),
  })
  .strict();
export type WorkerInput = z.infer<typeof workerInputSchema>;

/** Worker → main. Validated in main: the worker runs provider code on untrusted output. */
export const workerMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string().max(32_000) }).strict(),
  z
    .object({
      type: z.literal('tool-call'),
      id: z.string().uuid(),
      name: z.string().min(1).max(64),
      input: z.unknown(),
    })
    .strict(),
  z.object({ type: z.literal('done') }).strict(),
  /** Tokens and cost of one model call, as the provider reported them. */
  z.object({ type: z.literal('usage'), entry: usageEntrySchema }).strict(),
  /**
   * OpenRouter ran a web search during a step. Recorded as a step so the person (and a later
   * look at the run) can see that the web was searched and which pages it found.
   */
  z
    .object({
      type: z.literal('web-search'),
      query: z.string().max(300),
      pages: z
        .array(z.object({ url: z.string().url().max(2048), title: z.string().max(300) }).strict())
        .max(10),
    })
    .strict(),
  /** A closed set of progress hints; provider output never becomes free text here. */
  z.object({ type: z.literal('activity'), activity: z.enum(['searching-web']) }).strict(),
  z
    .object({
      type: z.literal('error'),
      kind: z
        .enum(['auth', 'credits', 'model', 'tools', 'temporary', 'unknown'])
        .default('unknown'),
      detail: providerFailureSchema.optional(),
    })
    .strict(),
]);
export type WorkerMessage = z.infer<typeof workerMessageSchema>;

/** Main → worker. */
export type HostMessage =
  | { type: 'stop' }
  /** Time is nearly up: stop using tools and answer from what has been found so far. */
  | { type: 'wrap-up' }
  | { type: 'tool-result'; id: string; outcome: ToolOutcome };

/** Records a search OpenRouter ran as a finished, read-only step of `runId`. */
export function recordWebSearch(
  recorder: ToolCallRecorder,
  runId: string,
  search: Extract<WorkerMessage, { type: 'web-search' }>,
) {
  const id = randomUUID();
  const hosts = [...new Set(search.pages.map(page => new URL(page.url).hostname))].slice(0, 3);
  recorder.created({
    id,
    runId,
    capability: 'web.search',
    title: 'Search the web',
    effect: 'read',
    input: { query: search.query },
    status: 'running',
  });
  recorder.finished(id, {
    status: 'succeeded',
    summary:
      (search.query ? `Searched “${search.query}”. ` : '') +
      (search.pages.length
        ? `Found ${search.pages.length === 1 ? '1 page' : `${search.pages.length} pages`} (${hosts.join(', ')}).`
        : 'Found nothing to cite.'),
    output: search,
  });
}

/** Keeps a failed call's safe summary for diagnosis; best effort, never blocks the run. */
export function recordFailure(
  repositories: Pick<Repositories, 'failures'>,
  runId: string,
  model: string,
  failure: Extract<WorkerMessage, { type: 'error' }>,
) {
  if (!failure.detail) return;
  try {
    repositories.failures.add({ runId, model, kind: failure.kind, ...failure.detail }, Date.now());
  } catch {
    // Diagnostics never get in the way of telling the person what happened.
  }
}
