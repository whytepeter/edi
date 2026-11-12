/**
 * The brain's boundary: what a host hands it to start a run, what it reports back, and what the
 * host may tell it while it works. Plain data, validated on both sides, so the same run can
 * cross a worker thread, a socket or a function call.
 */
import { z } from 'zod';
import type { ToolOutcome } from '@edi/capabilities';
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
    app: z.string().min(1).max(60).optional(),
    deferred: z.boolean().optional(),
    /** It only looks things up, so a helper may use it on its own. */
    readOnly: z.boolean().optional(),
  })
  .strict();

/** Passed once at startup. The worker never receives OS handles or other secrets. */
export const workerInputSchema = z
  .object({
    /** The OpenRouter key. */
    apiKey: z.string().max(4_096),
    model: modelIdSchema,
    /** What the person calls their companion. */
    name: assistantNameSchema.default('Edi'),
    /** A fast model that reads fetched pages and answers Edi's question; defaults to `model`. */
    readerModel: modelIdSchema.optional(),
    /**
     * The manner the companion answers in (a character's own), in a sentence or two. Style
     * only: instructions wrap it so it cannot widen what the run may do.
     */
    persona: z.string().max(300).default(''),
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
    /**
     * Where the person's own mouse was when they asked, in that screen's pixels: “this” and
     * “here” mean whatever is under it. Edi never moves their pointer.
     */
    pointer: z
      .object({
        screen: z.number().int().min(1).max(4),
        x: z.number().int().min(0),
        y: z.number().int().min(0),
        closeUp: z
          .object({ label: z.string().min(1).max(160), jpeg: bytesWithin(4 * 1024 * 1024) })
          .strict()
          .optional(),
        /** Boxes the person drew on that screen to say “this bit”. */
        marks: z
          .array(
            z
              .object({
                x: z.number().int(),
                y: z.number().int(),
                width: z.number().int().positive(),
                height: z.number().int().positive(),
              })
              .strict(),
          )
          .max(5)
          .optional(),
        /** What sits under it, and where that control is in the same screen's pixels. */
        element: z
          .object({
            text: z.string().min(1).max(300),
            named: z.boolean().default(false),
            box: z
              .object({
                x: z.number().int(),
                y: z.number().int(),
                width: z.number().int().positive(),
                height: z.number().int().positive(),
              })
              .strict()
              .optional(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .nullish()
      .default(null),
    /** The question was spoken and the reply will be read aloud. */
    spoken: z.boolean(),
    /** A background task works on its own for longer; chat answers the person in front of it. */
    /** `review` checks one action against a task's instructions: one short answer, no tools. */
    mode: z.enum(['chat', 'task', 'review']).default('chat'),
    /**
     * Whether the run may hand independent parts of the work to helpers: short runs on the
     * reader model with read-only tools, several at once. Off for a turn that should answer in
     * a breath (a spoken one).
     */
    delegate: z.boolean().default(false),
    /** Model steps allowed in this run. */
    maxSteps: z.number().int().min(1).max(40).default(10),
    /**
     * How much the model thinks before answering, when main lowers it (spoken turns); absent
     * keeps the model's default. Main picks a level the model's catalog entry allows.
     */
    reasoningEffort: z.enum(['none', 'minimal', 'low', 'medium']).optional(),
    /** Selected speech engine supports Chatterbox paralinguistic expression tags. */
    expressiveVoice: z.boolean().default(false),
    /** What the person had in front of them when they asked; data from other apps. */
    desktopContext: desktopContextSchema.nullable().default(null),
    /** Trusted, current, non-secret product configuration supplied by main. */
    selfContext: z.string().max(12_000).default(''),
    /** Switched-on skills, by name and when to use them; skills_use loads the instructions. */
    skills: z
      .array(
        z.object({ name: z.string().min(1).max(64), description: z.string().max(1024) }).strict(),
      )
      .max(60)
      .default([]),
    // Providers accept up to 128 tools per request. Deferred tools are declared but offered only
    // once found, so the ones sent directly must leave room for those and web search.
    tools: z
      .array(toolManifestEntrySchema)
      .max(400)
      .refine(tools => tools.filter(entry => !entry.deferred).length <= 90, {
        message: 'Too many tools sent directly.',
      }),
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
        .enum(['auth', 'key-limit', 'credits', 'model', 'tools', 'temporary', 'unknown'])
        .default('unknown'),
      detail: providerFailureSchema.optional(),
    })
    .strict(),
]);
export type WorkerMessage = z.infer<typeof workerMessageSchema>;

/** Main → worker. */
export type HostMessage =
  /** A worker loaded ahead of time receives its run. */
  | { type: 'start'; input: WorkerInput }
  | { type: 'stop' }
  /** Time is nearly up: stop using tools and answer from what has been found so far. */
  | { type: 'wrap-up' }
  | { type: 'tool-result'; id: string; outcome: ToolOutcome };

/** The same boundary under the names a host that is not a worker thread would use. */
export const agentInputSchema = workerInputSchema;
export type AgentInput = WorkerInput;
/** What the caller passes: fields with defaults may be left out. */
export type AgentRequest = z.input<typeof workerInputSchema>;
/** Everything a run reports except tool calls, which a host answers through `callTool`. */
export type AgentEvent = Exclude<WorkerMessage, { type: 'tool-call' }>;
