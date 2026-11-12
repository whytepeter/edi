import { isActiveTask, type Schedule, type Task } from '@edi/contracts';
import { untilLabel } from '../../lib/schedule-text';

/** A one-tap request on Home: its short label and what it asks. */
export interface QuickAction {
  label: string;
  prompt: string;
}

/**
 * Things worth asking right now, most likely first. They change through the day (planning in
 * the morning, wrapping up in the evening) and with what is set up, so Home offers what is
 * useful at this hour rather than the same three lines for ever.
 */
export function quickActions(
  hour: number,
  has: { calendar: boolean; savedItems: boolean; finishedTask: boolean; asked: boolean },
): QuickAction[] {
  const morning = hour >= 5 && hour < 12;
  const evening = hour >= 18 || hour < 5;
  const actions: QuickAction[] = [];
  if (morning)
    actions.push({
      label: 'Plan my day',
      prompt: 'Plan my day: what’s on my calendar and reminders today, and what should I do first?',
    });
  if (evening)
    actions.push({
      label: 'Wrap up my day',
      prompt: 'Wrap up my day: what did you help me with today, and what’s on tomorrow?',
    });
  if (has.calendar)
    actions.push(
      evening
        ? { label: 'Tomorrow', prompt: 'What’s on my calendar tomorrow?' }
        : { label: 'Today', prompt: 'What’s on my calendar today?' },
    );
  actions.push({ label: 'What’s on my screen?', prompt: 'Summarize what’s on my screen.' });
  if (has.finishedTask)
    actions.push({
      label: 'What did you find?',
      prompt: 'Summarize what your last background task found.',
    });
  if (has.savedItems && !morning)
    actions.push({
      label: 'Pick up where I left off',
      prompt: 'What was I working on most recently in Edi? Show it.',
    });
  // Someone who has never asked anything starts by finding out what Edi is for.
  if (!has.asked) actions.unshift({ label: 'What can you do?', prompt: 'What can you do?' });
  return actions.slice(0, 4);
}

/**
 * The line under the greeting: the one thing most worth knowing right now, in order — something
 * waits for the person, work is running, something is about to run — or an invitation to ask.
 */
export function statusLine(
  state: {
    approval: boolean;
    attention: number;
    tasks: readonly Task[];
    schedules: readonly Schedule[];
  },
  now: number,
): string {
  if (state.approval) return 'One thing is waiting for your okay.';
  if (state.attention > 0)
    return state.attention === 1 ? 'One thing needs you.' : `${state.attention} things need you.`;
  const active = state.tasks.filter(task => isActiveTask(task.status));
  if (active.length === 1) return `Working on “${active[0]!.title}” in the background.`;
  if (active.length > 1) return `Working on ${active.length} things in the background.`;
  const next = state.schedules
    .filter(schedule => schedule.enabled && schedule.nextRunAt !== null)
    .sort((a, b) => a.nextRunAt! - b.nextRunAt!)[0];
  // Only what is close enough to matter today.
  if (next && next.nextRunAt! - now < 12 * 60 * 60 * 1000)
    return `Next: ${next.title}, ${untilLabel(next.nextRunAt, now)}.`;
  return 'What can I help with?';
}
