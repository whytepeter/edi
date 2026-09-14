import { z } from 'zod';
import { approvalRequestSchema, toolStepSchema } from './capabilities';

/**
 * Background tasks: work Edi does while the person carries on. A task has its own runs, steps,
 * approvals and spending cap, and ends with a result (text, plus anything it saved to Library).
 */
export const taskStatusSchema = z.enum([
  'queued',
  'running',
  /** A review is waiting for the person. */
  'waiting',
  /** The spending cap was reached; the person can allow more or stop it. */
  'limited',
  'done',
  'failed',
  'cancelled',
  /** Edi quit while it ran; nothing is re-run automatically. */
  'interrupted',
]);
export type TaskStatus = z.infer<typeof taskStatusSchema>;

/** Dollars a single task may spend on OpenRouter; the person's default lives in Settings. */
export const taskBudgetSchema = z.number().min(0.05).max(50);
export const defaultTaskBudgetUsd = 0.5;

export const taskSchema = z
  .object({
    id: z.string().uuid(),
    title: z.string().min(1).max(120),
    prompt: z.string().min(1).max(8000),
    status: taskStatusSchema,
    createdAt: z.number().int().nonnegative(),
    startedAt: z.number().int().nonnegative().nullable(),
    finishedAt: z.number().int().nonnegative().nullable(),
    budgetUsd: taskBudgetSchema,
    spentUsd: z.number().nonnegative(),
    /** The schedule or watch that started it, if any. */
    scheduleId: z.string().uuid().nullable(),
    /** What it is doing now, or what it last did. */
    progress: z.string().max(200),
    steps: z.array(toolStepSchema).max(40),
    result: z.string().max(32000),
    error: z.string().max(400),
    /** Content it showed, saved to Library (workspace.show call ids). */
    artifactIds: z.array(z.string().uuid()).max(10),
    approval: approvalRequestSchema.nullable(),
  })
  .strict();
export type Task = z.infer<typeof taskSchema>;
export const taskListSchema = z.array(taskSchema).max(100);

export const isActiveTask = (status: TaskStatus) =>
  status === 'queued' || status === 'running' || status === 'waiting' || status === 'limited';
