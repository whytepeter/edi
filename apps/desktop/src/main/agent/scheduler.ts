import { randomUUID } from 'node:crypto';
import {
  describeWhen,
  isActiveTask,
  nextRunAt,
  type Schedule,
  type ScheduleWhen,
  type Task,
} from '@edi/contracts';
import type { Repositories } from '@edi/storage';

const TICK_MS = 30_000;

interface SchedulerOptions {
  repositories: Repositories;
  tasks: {
    start(input: {
      prompt: string;
      title?: string;
      budgetUsd: number;
      conversationId: string | null;
      scheduleId?: string | null;
    }): Task;
    list(limit?: number): Task[];
  };
  now?: () => number;
  /**
   * Something about a schedule worth telling the person: its result is `ready`, a watch
   * `changed`, a run `failed`, or the schedule was `paused` after failing several times.
   */
  notify?: (schedule: Schedule, task: Task, summary: string, kind: ScheduleNotice) => void;
}

export type ScheduleNotice = 'ready' | 'changed' | 'failed' | 'paused';

/** A schedule that fails this many times running pauses itself rather than keep spending. */
export const FAILURES_BEFORE_PAUSE = 3;

/** A watch's result starts with CHANGED: or UNCHANGED:; anything else counts as changed. */
export function readWatchResult(result: string) {
  const match = /^\s*\**\s*(CHANGED|UNCHANGED)\s*\**\s*[:\-–—]\s*\**\s*/i.exec(result);
  if (!match) return { changed: true, summary: result.trim() };
  return {
    changed: match[1]!.toUpperCase() === 'CHANGED',
    summary: result.slice(match[0].length).trim(),
  };
}

/** What a scheduled task is asked, including the last result for a watch to compare with. */
export function scheduledPrompt(schedule: Schedule) {
  const rhythm = describeWhen(schedule.when).toLowerCase();
  if (schedule.notify === 'always')
    return `${schedule.prompt}\n\n(This is a scheduled task that runs ${rhythm}.)`;
  const previous = schedule.lastResult
    ? `The previous check found:\n"""\n${schedule.lastResult}\n"""\nCompare what you find now with it.`
    : 'This is the first check: describe the current state as the starting point.';
  return [
    schedule.prompt,
    '',
    `This is a watch that checks ${rhythm}. ${previous}`,
    'Start your final reply with "CHANGED:" if something meaningful changed since the previous check,',
    'or "UNCHANGED:" if not (always "UNCHANGED:" for the first check), then a short summary.',
  ].join('\n');
}

/**
 * Starts tasks when schedules come due. It checks every 30 seconds and when the Mac wakes; a
 * schedule missed while asleep or quit runs once, never in a burst. A schedule whose previous
 * run is still going skips a turn rather than piling up. A run that fails says so, and a
 * schedule that fails three times running pauses itself until the person looks at it.
 */
export class Scheduler {
  private timer?: ReturnType<typeof setInterval>;
  private readonly now: () => number;
  private readonly listeners = new Set<(schedules: Schedule[]) => void>();

  constructor(private readonly options: SchedulerOptions) {
    this.now = options.now ?? Date.now;
  }

  onChange(listener: (schedules: Schedule[]) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  start() {
    this.tick();
    this.timer = setInterval(() => this.tick(), TICK_MS);
    this.timer.unref?.();
  }

  dispose() {
    clearInterval(this.timer);
  }

  list(): Schedule[] {
    return this.options.repositories.schedules.list(100);
  }

  create(input: {
    title?: string;
    prompt: string;
    when: ScheduleWhen;
    notify: Schedule['notify'];
    budgetUsd: number;
    /** Let its runs act on their own, for the small reversible actions. */
    unattended?: boolean;
  }): Schedule {
    const now = this.now();
    const next = nextRunAt(input.when, now, now);
    if (next === null) throw new Error('That time has already passed.');
    const id = randomUUID();
    this.options.repositories.schedules.create({
      id,
      title:
        input.title?.trim().slice(0, 120) ||
        input.prompt.replace(/\s+/g, ' ').trim().slice(0, 80) ||
        'Scheduled task',
      prompt: input.prompt,
      when: input.when,
      notify: input.notify,
      budgetUsd: input.budgetUsd,
      enabled: true,
      unattended: input.unattended ?? false,
      createdAt: now,
      nextRunAt: next,
    });
    this.publish();
    return this.options.repositories.schedules.get(id)!;
  }

  setEnabled(id: string, enabled: boolean) {
    const schedule = this.options.repositories.schedules.get(id);
    if (!schedule) throw new Error('That schedule no longer exists.');
    const now = this.now();
    // Turning one back on picks up from now, without making up for the time it was off.
    this.options.repositories.schedules.update(id, {
      enabled,
      ...(enabled ? { nextRunAt: nextRunAt(schedule.when, now, schedule.createdAt) } : {}),
    });
    this.publish();
  }

  /** Let a schedule act on its own, or make it wait for a review again. */
  setUnattended(id: string, unattended: boolean) {
    if (!this.options.repositories.schedules.get(id))
      throw new Error('That schedule no longer exists.');
    this.options.repositories.schedules.update(id, { unattended });
    this.publish();
  }

  remove(id: string) {
    this.options.repositories.schedules.remove(id);
    this.publish();
  }

  /**
   * Change what a schedule is called, what it does or when it runs. A new time takes effect
   * from now. New instructions give a watch a fresh starting point: its last result described
   * something else.
   */
  update(id: string, change: { title?: string; prompt?: string; when?: ScheduleWhen }): Schedule {
    const { schedules } = this.options.repositories;
    const schedule = schedules.get(id);
    if (!schedule) throw new Error('That schedule no longer exists.');
    const title = change.title?.trim();
    const prompt = change.prompt?.trim();
    if (change.title !== undefined && !title) throw new Error('A schedule needs a name.');
    if (change.prompt !== undefined && !prompt)
      throw new Error('A schedule needs something to do.');
    const now = this.now();
    const next = change.when ? nextRunAt(change.when, now, now) : undefined;
    if (next === null) throw new Error('That time has already passed.');
    schedules.update(id, {
      ...(title ? { title } : {}),
      ...(prompt ? { prompt } : {}),
      ...(prompt && prompt !== schedule.prompt ? { lastResult: '' } : {}),
      // A paused schedule keeps its new time for when it is turned back on.
      ...(change.when
        ? { when: change.when, ...(schedule.enabled ? { nextRunAt: next } : {}) }
        : {}),
    });
    this.publish();
    return schedules.get(id)!;
  }

  /**
   * Run it once now, without moving its next scheduled time. One run at a time: while the last
   * one is still going, this returns that run.
   */
  runNow(id: string): Task {
    const { repositories, tasks } = this.options;
    const schedule = repositories.schedules.get(id);
    if (!schedule) throw new Error('That schedule no longer exists.');
    const running = tasks
      .list(100)
      .find(task => task.scheduleId === id && isActiveTask(task.status));
    if (running) return running;
    const task = tasks.start({
      prompt: scheduledPrompt(schedule),
      title: schedule.title,
      budgetUsd: schedule.budgetUsd,
      conversationId: null,
      scheduleId: schedule.id,
    });
    repositories.schedules.update(id, { lastRunAt: this.now() });
    this.publish();
    return task;
  }

  tick() {
    const { repositories, tasks } = this.options;
    const now = this.now();
    const due = repositories.schedules.due(now);
    if (!due.length) return;
    const running = new Set(
      tasks
        .list(100)
        .filter(task => isActiveTask(task.status) && task.scheduleId)
        .map(task => task.scheduleId),
    );
    for (const schedule of due) {
      const next = nextRunAt(schedule.when, now, schedule.createdAt);
      if (!running.has(schedule.id)) {
        tasks.start({
          prompt: scheduledPrompt(schedule),
          title: schedule.title,
          budgetUsd: schedule.budgetUsd,
          conversationId: null,
          scheduleId: schedule.id,
        });
        repositories.schedules.update(schedule.id, { lastRunAt: now, nextRunAt: next });
      } else {
        repositories.schedules.update(schedule.id, { nextRunAt: next });
      }
    }
    this.publish();
  }

  /** Called when any task ends: records a scheduled result and decides whether to speak up. */
  finished(task: Task): boolean {
    if (!task.scheduleId) return false;
    const schedule = this.options.repositories.schedules.get(task.scheduleId);
    if (!schedule) return true;
    if (task.status === 'failed') {
      this.failed(schedule, task);
      return true;
    }
    // Stopped by the person or by Edi quitting: nothing to report.
    if (task.status !== 'done') return true;
    const watch = schedule.notify === 'on-change';
    const { changed, summary } = watch
      ? readWatchResult(task.result)
      : { changed: true, summary: task.result.trim() };
    const first = watch && !schedule.lastResult;
    this.options.repositories.schedules.update(schedule.id, { lastResult: summary });
    if (!watch || (changed && !first))
      this.options.notify?.(schedule, task, summary, watch ? 'changed' : 'ready');
    this.publish();
    return true;
  }

  /**
   * A scheduled run failed. The person is told (a schedule that quietly stops working is worse
   * than none), and after several in a row it pauses, so it stops spending on something broken.
   */
  private failed(schedule: Schedule, task: Task) {
    const reason = task.error.trim() || 'It didn’t finish.';
    const latest = this.options.tasks
      .list(100)
      .filter(entry => entry.scheduleId === schedule.id && !isActiveTask(entry.status))
      .sort((a, b) => (b.finishedAt ?? b.createdAt) - (a.finishedAt ?? a.createdAt))
      .slice(0, FAILURES_BEFORE_PAUSE);
    const stuck =
      schedule.enabled &&
      latest.length === FAILURES_BEFORE_PAUSE &&
      latest.every(entry => entry.status === 'failed');
    if (stuck) this.options.repositories.schedules.update(schedule.id, { enabled: false });
    this.options.notify?.(schedule, task, reason, stuck ? 'paused' : 'failed');
    this.publish();
  }

  private publish() {
    if (!this.listeners.size) return;
    const list = this.list();
    for (const listener of this.listeners) listener(list);
  }
}
