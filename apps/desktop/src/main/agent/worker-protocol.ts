import { z } from 'zod';
import type { ToolOutcome } from '@edi/capabilities';
import { modelIdSchema } from '@edi/contracts';

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
  z.object({ type: z.literal('error') }).strict(),
]);
export type WorkerMessage = z.infer<typeof workerMessageSchema>;

/** Main → worker. */
export type HostMessage =
  { type: 'stop' } | { type: 'tool-result'; id: string; outcome: ToolOutcome };
