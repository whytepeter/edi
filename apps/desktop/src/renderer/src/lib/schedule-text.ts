import { isActiveTask, type Schedule, type Task } from '@edi/contracts';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** “in 12 min”, “in 3h 20m”, “in 2 days”: how long until a schedule runs next. */
export function untilLabel(at: number | null, now: number) {
  if (at === null) return 'No more runs';
  const left = at - now;
  if (left <= MINUTE) return 'any moment now';
  if (left < HOUR) return `in ${Math.round(left / MINUTE)} min`;
  if (left < DAY) {
    const hours = Math.floor(left / HOUR);
    const minutes = Math.round((left - hours * HOUR) / MINUTE);
    return minutes ? `in ${hours}h ${minutes}m` : `in ${hours}h`;
  }
  const days = Math.round(left / DAY);
  return days === 1 ? 'tomorrow' : `in ${days} days`;
}

/** “just now”, “12 min ago”, “3h ago”, “yesterday”, “4 days ago”. */
export function agoLabel(at: number, now: number) {
  const past = Math.max(0, now - at);
  if (past < MINUTE) return 'just now';
  if (past < HOUR) return `${Math.round(past / MINUTE)} min ago`;
  if (past < DAY) return `${Math.floor(past / HOUR)}h ago`;
  const days = Math.floor(past / DAY);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

export interface LastRun {
  /** How it went, for the dot beside the line. */
  tone: 'running' | 'ok' | 'failed' | 'quiet';
  text: string;
  /** The run itself, to open its result. */
  task: Task | null;
}

/** The newest run a schedule started and how it went, from the tasks the card already has. */
export function lastRun(schedule: Schedule, tasks: readonly Task[], now: number): LastRun {
  const task =
    tasks
      .filter(entry => entry.scheduleId === schedule.id)
      .sort((a, b) => b.createdAt - a.createdAt)[0] ?? null;
  if (!task)
    return {
      tone: 'quiet',
      text: schedule.lastRunAt ? `Last ran ${agoLabel(schedule.lastRunAt, now)}` : 'Hasn’t run yet',
      task: null,
    };
  if (isActiveTask(task.status))
    return {
      tone: 'running',
      text:
        task.status === 'waiting'
          ? 'Running now · needs your OK'
          : task.status === 'limited'
            ? 'Running now · paused at its cap'
            : `Running now${task.progress ? ` · ${task.progress}` : ''}`,
      task,
    };
  const when = agoLabel(task.finishedAt ?? task.createdAt, now);
  if (task.status === 'failed')
    return {
      tone: 'failed',
      text: `Didn’t finish ${when}${task.error ? ` · ${task.error}` : ''}`,
      task,
    };
  if (task.status === 'done') {
    const watch = schedule.notify === 'on-change';
    return {
      tone: 'ok',
      text:
        watch && schedule.lastResult ? `Checked ${when} · ${schedule.lastResult}` : `Ran ${when}`,
      task,
    };
  }
  return { tone: 'quiet', text: `Stopped ${when}`, task };
}
