import { z } from 'zod';
import type { ToolManifestEntry, ToolOutcome } from '@edi/capabilities';

/** Passed once at startup. The worker never receives OS handles or other secrets. */
export interface WorkerInput {
  apiKey: string;
  model: string;
  prompt: string;
  /** Earlier completed exchanges, oldest first, text only. */
  history: { prompt: string; reply: string }[];
  /** Taken when the person asked; JPEG bytes, labelled for the model. */
  screenshots: { label: string; jpeg: Uint8Array }[];
  tools: ToolManifestEntry[];
}

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
