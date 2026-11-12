import test from 'node:test';
import assert from 'node:assert/strict';
import type { Schedule, Task } from '../../packages/contracts/src/index';
import {
  quickActions,
  statusLine,
} from '../../apps/desktop/src/renderer/src/features/home/home-brief';

const HOUR = 60 * 60 * 1000;
const now = 1_800_000_000_000;
const labels = (hour: number, has: Partial<Parameters<typeof quickActions>[1]> = {}) =>
  quickActions(hour, {
    calendar: true,
    savedItems: false,
    finishedTask: false,
    asked: true,
    ...has,
  }).map(action => action.label);

const schedule = (title: string, nextRunAt: number | null, enabled = true) =>
  ({ id: title, title, enabled, nextRunAt }) as unknown as Schedule;
const task = (title: string, status: Task['status']) => ({ title, status }) as unknown as Task;

test('Home offers what is useful at this hour, never more than four', () => {
  assert.deepEqual(labels(8), ['Plan my day', 'Today', 'What’s on my screen?']);
  assert.deepEqual(labels(14), ['Today', 'What’s on my screen?']);
  assert.deepEqual(labels(21), ['Wrap up my day', 'Tomorrow', 'What’s on my screen?']);
  // What just finished and what was saved become one tap too.
  assert.deepEqual(labels(14, { finishedTask: true, savedItems: true }), [
    'Today',
    'What’s on my screen?',
    'What did you find?',
    'Pick up where I left off',
  ]);
  assert.equal(labels(21, { finishedTask: true, savedItems: true }).length, 4);
  // Someone new is offered the obvious first question.
  assert.equal(labels(14, { asked: false })[0], 'What can you do?');
  // Every action asks something complete on its own.
  for (const action of quickActions(8, {
    calendar: true,
    savedItems: true,
    finishedTask: true,
    asked: false,
  }))
    assert.ok(action.prompt.length >= action.label.length);
});

test('the line under the greeting says the one thing most worth knowing', () => {
  const state = { approval: false, attention: 0, tasks: [] as Task[], schedules: [] as Schedule[] };
  assert.equal(statusLine(state, now), 'What can I help with?');
  assert.equal(
    statusLine({ ...state, schedules: [schedule('Morning brief', now + 20 * 60_000)] }, now),
    'Next: Morning brief, in 20 min.',
  );
  // Tomorrow's run, a paused one and a finished one are not news today.
  assert.equal(
    statusLine(
      {
        ...state,
        schedules: [
          schedule('Weekly', now + 30 * HOUR),
          schedule('Paused', now + HOUR, false),
          schedule('Done', null),
        ],
      },
      now,
    ),
    'What can I help with?',
  );
  const busy = { ...state, tasks: [task('Research desks', 'running'), task('Old', 'done')] };
  assert.equal(statusLine(busy, now), 'Working on “Research desks” in the background.');
  assert.equal(
    statusLine({ ...busy, tasks: [...busy.tasks, task('Compare', 'waiting')] }, now),
    'Working on 2 things in the background.',
  );
  // Something waiting for the person comes before everything else.
  assert.equal(statusLine({ ...busy, attention: 2 }, now), '2 things need you.');
  assert.equal(
    statusLine({ ...busy, attention: 2, approval: true }, now),
    'One thing is waiting for your okay.',
  );
});
