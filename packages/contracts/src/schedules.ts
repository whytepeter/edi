import { z } from 'zod';
import { taskBudgetSchema } from './tasks';

/**
 * Schedules start background tasks at set times; a watch is a schedule that compares each
 * check with the last one and only speaks up when something changed. Times are the Mac's local
 * time, so "every day at 9:00" follows the person across time zones and daylight saving.
 */
export const weekdaySchema = z.enum(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']);
export type Weekday = z.infer<typeof weekdaySchema>;
const weekdays = weekdaySchema.options;
const timeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const scheduleWhenSchema = z.discriminatedUnion('kind', [
  /** Once, at a local date and time. */
  z
    .object({ kind: z.literal('once'), at: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/) })
    .strict(),
  /** Every chosen day (all days when none are listed) at a local time. */
  z
    .object({
      kind: z.literal('daily'),
      time: timeOfDay,
      days: z.array(weekdaySchema).max(7).optional(),
    })
    .strict(),
  /** Every few hours, from when it was created. */
  z.object({ kind: z.literal('every'), hours: z.number().int().min(1).max(24) }).strict(),
]);
export type ScheduleWhen = z.infer<typeof scheduleWhenSchema>;

export const scheduleNotifySchema = z.enum(['always', 'on-change']);

export const scheduleSchema = z
  .object({
    id: z.string().uuid(),
    title: z.string().min(1).max(120),
    prompt: z.string().min(1).max(8000),
    when: scheduleWhenSchema,
    /** on-change makes it a watch. */
    notify: scheduleNotifySchema,
    budgetUsd: taskBudgetSchema,
    enabled: z.boolean(),
    createdAt: z.number().int().nonnegative(),
    lastRunAt: z.number().int().nonnegative().nullable(),
    /** Null once a one-time schedule has run. */
    nextRunAt: z.number().int().nonnegative().nullable(),
    /** The latest result, which a watch compares its next check with. */
    lastResult: z.string().max(8000),
  })
  .strict();
export type Schedule = z.infer<typeof scheduleSchema>;
export const scheduleListSchema = z.array(scheduleSchema).max(100);

/** The first run strictly after `after` (ms), in local time; null when none remains. */
export function nextRunAt(when: ScheduleWhen, after: number, createdAt = after): number | null {
  if (when.kind === 'once') {
    const [date, time] = when.at.split('T') as [string, string];
    const [year, month, day] = date.split('-').map(Number) as [number, number, number];
    const [hour, minute] = time.split(':').map(Number) as [number, number];
    const at = new Date(year, month - 1, day, hour, minute).getTime();
    return at > after ? at : null;
  }
  if (when.kind === 'every') {
    const step = when.hours * 60 * 60 * 1000;
    const elapsed = Math.max(0, after - createdAt);
    return createdAt + (Math.floor(elapsed / step) + 1) * step;
  }
  const [hour, minute] = when.time.split(':').map(Number) as [number, number];
  const allowed = new Set(when.days?.length ? when.days : weekdays);
  const start = new Date(after);
  for (let offset = 0; offset <= 7; offset++) {
    const candidate = new Date(
      start.getFullYear(),
      start.getMonth(),
      start.getDate() + offset,
      hour,
      minute,
    );
    if (candidate.getTime() > after && allowed.has(weekdays[candidate.getDay()]!))
      return candidate.getTime();
  }
  return null;
}

const dayNames: Record<Weekday, string> = {
  sun: 'Sunday',
  mon: 'Monday',
  tue: 'Tuesday',
  wed: 'Wednesday',
  thu: 'Thursday',
  fri: 'Friday',
  sat: 'Saturday',
};

/** “Every weekday at 9:00”, “Every 4 hours”, “Once on Sep 20 at 15:00”. */
export function describeWhen(when: ScheduleWhen): string {
  if (when.kind === 'every') return when.hours === 1 ? 'Every hour' : `Every ${when.hours} hours`;
  if (when.kind === 'once') {
    const [date, time] = when.at.split('T') as [string, string];
    const [year, month, day] = date.split('-').map(Number) as [number, number, number];
    const label = new Date(year, month - 1, day).toLocaleDateString('en', {
      month: 'short',
      day: 'numeric',
    });
    return `Once on ${label} at ${time}`;
  }
  const days = new Set(when.days?.length ? when.days : weekdays);
  const everyDay = days.size === 7;
  const weekdaysOnly = days.size === 5 && !days.has('sat') && !days.has('sun');
  const weekend = days.size === 2 && days.has('sat') && days.has('sun');
  const which = everyDay
    ? 'Every day'
    : weekdaysOnly
      ? 'Every weekday'
      : weekend
        ? 'Every weekend day'
        : `Every ${weekdays
            .filter(day => days.has(day))
            .map(day => dayNames[day])
            .join(', ')}`;
  return `${which} at ${when.time}`;
}
