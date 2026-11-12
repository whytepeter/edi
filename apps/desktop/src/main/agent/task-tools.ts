import { z } from 'zod';
import { defineCapability, type Capability } from '@edi/capabilities';
import {
  describeWhen,
  isActiveTask,
  normalizeScheduleWhen,
  scheduleWhenHelp,
  scheduleWhenSchema,
  taskBudgetSchema,
  type Schedule,
} from '@edi/contracts';
import type { Scheduler } from './scheduler';
import type { TaskService } from './task-service';

/**
 * What `schedules_create` takes, as the model is shown it: `when` is described with the exact
 * shape and an example of each kind, so a daily schedule doesn't fail on a guessed format.
 */
const scheduleInput = z
  .object({
    title: z.string().trim().min(1).max(80).describe('A short name'),
    instructions: z.string().trim().min(1).max(8000).describe('What each run should do'),
    when: scheduleWhenSchema.describe(scheduleWhenHelp),
    notify: z
      .enum(['always', 'on-change'])
      .describe('always: tell the user each result; on-change: a watch'),
    budgetUsd: taskBudgetSchema.optional().describe('Spending cap per run, if the user named one'),
    unattended: z
      .boolean()
      .optional()
      .describe(
        'true when the user wants it to run without asking them each time (“just do it”, “don’t ' +
          'ask me”): its runs then add reminders and calendar events and save notes on their own, ' +
          'and anything else still waits for the user',
      ),
  })
  .strict();

/** What the task and schedule tools reach for. Services are asked for when a tool runs, since
 * the tools are handed to the agent before those services exist. */
export interface TaskToolDependencies {
  tasks(): TaskService;
  scheduler(): Scheduler;
  /** Looks a schedule up by id, for the tools that change or remove one. */
  schedules: { get(id: string): Schedule | undefined };
  /** The person's own spending cap, used when they named no amount. */
  defaultBudgetUsd(): number;
  /** The conversation a task started from, so its result can be found again. */
  conversationId(): string | null;
}

/**
 * Edi's tools for work that outlives a reply: starting, listing and stopping background tasks,
 * and making, changing, listing and removing schedules and watches. Every change is reviewed.
 */
export function taskCapabilities(deps: TaskToolDependencies): Capability[] {
  return [
    defineCapability({
      id: 'deps.tasks().start',
      title: 'Start a background task',
      description:
        'Hand longer work to a background task that keeps running while the user does other ' +
        'things: research across many pages, comparing options, organizing lots of files, ' +
        'drafting a report. Use it when the user asks for something to happen in the background ' +
        'or while they work, or when the work clearly needs many steps. Give a short title and ' +
        'complete instructions (the task cannot ask questions). Pass budgetUsd only when the user ' +
        'named an amount; otherwise their default cap applies. Then tell the user it is running ' +
        'and that they can follow it in Tasks.',
      effect: 'write',
      timeoutMs: 5_000,
      input: z
        .object({
          title: z.string().trim().min(1).max(80).describe('A short name for the task'),
          instructions: z
            .string()
            .trim()
            .min(1)
            .max(8000)
            .describe('Everything the task needs to know, written as a request'),
          budgetUsd: taskBudgetSchema
            .optional()
            .describe('Spending cap in US dollars, only if the user named one'),
        })
        .strict(),
      prepare({ title, instructions, budgetUsd }) {
        const budget = budgetUsd ?? deps.defaultBudgetUsd();
        return {
          preview: {
            title: 'Start a background task',
            action: 'Start Task',
            summary: `Work on “${title}” in the background, spending up to $${budget.toFixed(2)}.`,
            fields: [{ label: 'Spending cap', value: `$${budget.toFixed(2)}` }],
            body: instructions.slice(0, 4000),
          },
          async execute() {
            const task = deps.tasks().start({
              prompt: instructions,
              title,
              budgetUsd: budget,
              conversationId: deps.conversationId(),
            });
            return {
              summary: `Started “${task.title}” in the background (up to $${budget.toFixed(2)}).`,
              output: { taskId: task.id, status: task.status },
            };
          },
        };
      },
    }),
    defineCapability({
      id: 'deps.tasks().list',
      title: 'Check background tasks',
      description:
        'See background tasks: status, progress, spending, and the results of finished ones. Use ' +
        'it when the user asks how a task is going or what it found.',
      effect: 'read',
      timeoutMs: 5_000,
      input: z.object({}).strict(),
      prepare() {
        return {
          preview: {
            title: 'Check tasks',
            action: 'Check',
            summary: 'Check deps.tasks().',
            fields: [],
          },
          async execute() {
            const list = deps
              .tasks()
              .list(10)
              .map(task => ({
                id: task.id,
                title: task.title,
                status: task.status,
                progress: task.progress,
                spent: `$${task.spentUsd.toFixed(2)} of $${task.budgetUsd.toFixed(2)}`,
                result: task.result.slice(0, 2000),
                error: task.error,
              }));
            return {
              summary: list.length === 1 ? '1 task.' : `${list.length} deps.tasks().`,
              output: { tasks: list },
            };
          },
        };
      },
    }),
    defineCapability({
      id: 'deps.tasks().stop',
      title: 'Stop a background task',
      description:
        'Stop a background task that is running, waiting or queued, by its id from tasks_list. ' +
        'Use it when the user asks to stop or cancel one. What it already did is not undone.',
      effect: 'write',
      timeoutMs: 5_000,
      input: z.object({ id: z.string().uuid() }).strict(),
      prepare({ id }) {
        const task = deps.tasks().task(id);
        if (!task) throw new Error('That task no longer exists. Check tasks_list.');
        if (!isActiveTask(task.status))
          throw new Error('That task has already ended, so there is nothing to stop.');
        return {
          preview: {
            title: 'Stop a task',
            action: 'Stop',
            summary: 'Stop “' + task.title + '”.',
            fields: [],
          },
          async execute() {
            deps.tasks().stop(id);
            return { summary: 'Stopped “' + task.title + '”.' };
          },
        };
      },
    }),
    defineCapability({
      id: 'schedules.create',
      title: 'Schedule a task',
      description:
        'Run a task later or repeatedly, as a background task each time: “every weekday at 9 ' +
        'summarize my tech news”, “tomorrow at 3pm check the order status”, “every 4 hours”. For ' +
        '“tell me when X changes” make it a watch (notify on-change): it compares each check with ' +
        'the last and only tells the user when something changed. Instructions must stand on ' +
        'their own. Use local times. Pass budgetUsd only when the user named an amount per run.',
      effect: 'write',
      timeoutMs: 5_000,
      // Shorthand timings ("09:00", {"time": "9:00"}) are read the way they were meant; the
      // model is shown the exact shape, with examples, and told precisely what didn't fit.
      input: scheduleInput
        .extend({ when: z.preprocess(normalizeScheduleWhen, scheduleWhenSchema) })
        .strict(),
      inputSchema: z.toJSONSchema(scheduleInput) as Record<string, unknown>,
      prepare({ title, instructions, when, notify, budgetUsd, unattended }) {
        const budget = budgetUsd ?? deps.defaultBudgetUsd();
        const rhythm = describeWhen(when);
        return {
          preview: {
            title: notify === 'on-change' ? 'Start a watch' : 'Schedule a task',
            action: notify === 'on-change' ? 'Start Watch' : 'Schedule',
            summary: `${rhythm}: “${title}”, up to $${budget.toFixed(2)} each time.`,
            fields: [
              { label: 'When', value: rhythm },
              {
                label: 'Tells you',
                value: notify === 'on-change' ? 'Only when something changes' : 'Each result',
              },
              {
                label: 'Each run',
                value: unattended
                  ? 'Adds reminders, events and notes without asking'
                  : 'Asks you before it changes anything',
              },
            ],
            body: instructions.slice(0, 4000),
          },
          async execute() {
            const schedule = deps.scheduler().create({
              title,
              prompt: instructions,
              when,
              notify,
              budgetUsd: budget,
              unattended: unattended ?? false,
            });
            return {
              summary: `${notify === 'on-change' ? 'Watching' : 'Scheduled'} “${schedule.title}”: ${rhythm.toLowerCase()}.`,
              output: {
                scheduleId: schedule.id,
                nextRun: schedule.nextRunAt ? new Date(schedule.nextRunAt).toString() : null,
              },
            };
          },
        };
      },
    }),
    defineCapability({
      id: 'schedules.list',
      title: 'Check schedules',
      description:
        'List schedules and watches: what they do, when they run next, and their latest result. ' +
        'Use it before changing or removing one, or when the user asks what is scheduled.',
      effect: 'read',
      timeoutMs: 5_000,
      input: z.object({}).strict(),
      prepare() {
        return {
          preview: {
            title: 'Check schedules',
            action: 'Check',
            summary: 'Check schedules.',
            fields: [],
          },
          async execute() {
            const list = deps
              .scheduler()
              .list()
              .map(schedule => ({
                id: schedule.id,
                title: schedule.title,
                when: describeWhen(schedule.when),
                watch: schedule.notify === 'on-change',
                enabled: schedule.enabled,
                nextRun: schedule.nextRunAt ? new Date(schedule.nextRunAt).toString() : null,
                latest: schedule.lastResult.slice(0, 1000),
              }));
            return {
              summary: list.length === 1 ? '1 schedule.' : `${list.length} schedules.`,
              output: { schedules: list },
            };
          },
        };
      },
    }),
    defineCapability({
      id: 'schedules.update',
      title: 'Change a schedule',
      description:
        'Change an existing schedule or watch by id from schedules_list: its name, what it ' +
        'does, or when it runs (“move my morning brief to 8”). Pass only what changes. Use this ' +
        'instead of removing one and making another.',
      effect: 'write',
      timeoutMs: 5_000,
      input: z
        .object({
          id: z.string().uuid(),
          title: z.string().trim().min(1).max(120).optional(),
          instructions: z.string().trim().min(1).max(8000).optional(),
          when: z.preprocess(normalizeScheduleWhen, scheduleWhenSchema).optional(),
        })
        .strict(),
      inputSchema: z.toJSONSchema(
        z
          .object({
            id: z.string().uuid(),
            title: z.string().max(120).optional(),
            instructions: z.string().max(8000).optional(),
            when: z.unknown().optional().describe(scheduleWhenHelp),
          })
          .strict(),
      ) as Record<string, unknown>,
      prepare({ id, title, instructions, when }) {
        const schedule = deps.schedules.get(id);
        if (!schedule) throw new Error('That schedule no longer exists.');
        if (!title && !instructions && !when)
          throw new Error('Say what to change: the title, instructions or when.');
        const changes = [
          ...(title ? [{ label: 'Name', value: title }] : []),
          ...(when ? [{ label: 'When', value: describeWhen(when) }] : []),
          ...(instructions ? [{ label: 'Does', value: instructions.slice(0, 600) }] : []),
        ];
        return {
          preview: {
            title: 'Change a schedule',
            action: 'Change',
            summary: `Change “${schedule.title}” (${describeWhen(schedule.when).toLowerCase()}).`,
            fields: changes,
          },
          async execute() {
            const updated = deps.scheduler().update(id, {
              ...(title ? { title } : {}),
              ...(instructions ? { prompt: instructions } : {}),
              ...(when ? { when } : {}),
            });
            return {
              summary: `Changed “${updated.title}”: ${describeWhen(updated.when).toLowerCase()}.`,
              output: {
                scheduleId: updated.id,
                nextRun: updated.nextRunAt ? new Date(updated.nextRunAt).toString() : null,
              },
            };
          },
        };
      },
    }),
    defineCapability({
      id: 'schedules.delete',
      title: 'Remove a schedule',
      description: 'Stop and remove a schedule or watch by id from schedules_list.',
      effect: 'write',
      timeoutMs: 5_000,
      input: z.object({ id: z.string().uuid() }).strict(),
      prepare({ id }) {
        const schedule = deps.schedules.get(id);
        if (!schedule) throw new Error('That schedule no longer exists.');
        return {
          preview: {
            title: 'Remove a schedule',
            action: 'Remove',
            summary: `Stop “${schedule.title}” (${describeWhen(schedule.when).toLowerCase()}).`,
            fields: [],
          },
          async execute() {
            deps.scheduler().remove(id);
            return { summary: `Removed “${schedule.title}”.` };
          },
        };
      },
    }),
  ] as Capability[];
}
