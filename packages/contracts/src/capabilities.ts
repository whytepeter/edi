import { z } from 'zod';

/**
 * What a person reviews before Edi performs a write. It describes the exact
 * prepared effect (for example the final file path), not the model's intent.
 */
export const approvalPreviewSchema = z
  .object({
    title: z.string().min(1).max(120),
    /** The confirm button's label: a specific verb, e.g. “Save Note”, never just “OK”. */
    action: z.string().min(1).max(40),
    summary: z.string().min(1).max(240),
    fields: z
      .array(z.object({ label: z.string().min(1).max(40), value: z.string().max(600) }).strict())
      .max(8),
    /** Content preview, truncated by the capability. */
    body: z.string().max(4000).optional(),
  })
  .strict();
export type ApprovalPreview = z.infer<typeof approvalPreviewSchema>;

/**
 * awaiting-approval → denied | running → succeeded | failed | unknown; cancelled from any
 * pending state. `unknown` means the effect may have happened and must not be retried blindly.
 */
export const toolCallStatusSchema = z.enum([
  'awaiting-approval',
  'denied',
  'running',
  'succeeded',
  'failed',
  'cancelled',
  'unknown',
]);
export type ToolCallStatus = z.infer<typeof toolCallStatusSchema>;

export const toolStepSchema = z
  .object({
    callId: z.string().uuid(),
    capability: z.string().min(1).max(80),
    title: z.string().min(1).max(120),
    status: toolCallStatusSchema,
    summary: z.string().max(400),
  })
  .strict();
export type ToolStep = z.infer<typeof toolStepSchema>;

/** Bound to one call in one run; a response for any other call is rejected. */
export const approvalRequestSchema = z
  .object({
    callId: z.string().uuid(),
    runId: z.string().uuid(),
    preview: approvalPreviewSchema,
  })
  .strict();
export type ApprovalRequest = z.infer<typeof approvalRequestSchema>;

export const runStatusSchema = z.enum(['running', 'done', 'stopped', 'error', 'interrupted']);
export type RunStatus = z.infer<typeof runStatusSchema>;

export const activityRunSchema = z
  .object({
    id: z.string().uuid(),
    prompt: z.string().max(8000),
    model: z.string().max(160),
    status: runStatusSchema,
    error: z.string().max(400),
    startedAt: z.number().int().nonnegative(),
    finishedAt: z.number().int().nonnegative().nullable(),
    steps: z.array(toolStepSchema).max(50),
  })
  .strict();
export type ActivityRun = z.infer<typeof activityRunSchema>;
export const activitySchema = z.array(activityRunSchema).max(50);
export type Activity = z.infer<typeof activitySchema>;
