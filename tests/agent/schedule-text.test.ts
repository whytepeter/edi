import test from 'node:test';
import assert from 'node:assert/strict';
import type { Schedule, Task } from '../../packages/contracts/src/index';
import {
  agoLabel,
  lastRun,
  untilLabel,
} from '../../apps/desktop/src/renderer/src/lib/schedule-text';

const MIN = 60_000;
const HOUR = 60 * MIN;
const now = 1_800_000_000_000;

const schedule = (overrides: Partial<Schedule> = {}): Schedule => ({
  id: '00000000-0000-4000-8000-0000000000aa',
  title: 'Morning brief',
  prompt: 'Summarize the news',
  when: { kind: 'daily', time: '09:00' },
  notify: 'always',
  budgetUsd: 0.5,
  enabled: true,
  unattended: false,
  createdAt: 0,
  lastRunAt: null,
  nextRunAt: now + HOUR,
  lastResult: '',
  ...overrides,
});
const task = (overrides: Partial<Task> = {}): Task => ({
  id: '00000000-0000-4000-8000-000000000001',
  title: 'Morning brief',
  prompt: 'x',
  status: 'done',
  createdAt: now - 2 * HOUR,
  startedAt: now - 2 * HOUR,
  finishedAt: now - 2 * HOUR + MIN,
  budgetUsd: 0.5,
  spentUsd: 0.1,
  scheduleId: '00000000-0000-4000-8000-0000000000aa',
  progress: '',
  steps: [],
  result: 'Here is the news.',
  error: '',
  artifactIds: [],
  approval: null,
  ...overrides,
});

test('how long until the next run, in the words a person would use', () => {
  assert.equal(untilLabel(null, now), 'No more runs');
  assert.equal(untilLabel(now + 20_000, now), 'any moment now');
  assert.equal(untilLabel(now + 12 * MIN, now), 'in 12 min');
  assert.equal(untilLabel(now + 3 * HOUR + 20 * MIN, now), 'in 3h 20m');
  assert.equal(untilLabel(now + 5 * HOUR, now), 'in 5h');
  assert.equal(untilLabel(now + 26 * HOUR, now), 'tomorrow');
  assert.equal(untilLabel(now + 4 * 24 * HOUR, now), 'in 4 days');
  assert.equal(agoLabel(now - 30_000, now), 'just now');
  assert.equal(agoLabel(now - 12 * MIN, now), '12 min ago');
  assert.equal(agoLabel(now - 3 * HOUR, now), '3h ago');
  assert.equal(agoLabel(now - 30 * HOUR, now), 'yesterday');
});

test('the card says how the newest run of a schedule went', () => {
  assert.deepEqual(lastRun(schedule(), [], now), {
    tone: 'quiet',
    text: 'Hasn’t run yet',
    task: null,
  });
  // The newest run wins, whatever order the tasks arrive in.
  const old = task({ id: '00000000-0000-4000-8000-000000000002', createdAt: now - 30 * HOUR });
  const ok = lastRun(schedule(), [old, task()], now);
  assert.equal(ok.tone, 'ok');
  assert.equal(ok.text, 'Ran 1h ago');
  assert.equal(ok.task?.id, '00000000-0000-4000-8000-000000000001');

  const failed = lastRun(
    schedule(),
    [task({ status: 'failed', error: 'The model was unavailable.' })],
    now,
  );
  assert.equal(failed.tone, 'failed');
  assert.equal(failed.text, 'Didn’t finish 1h ago · The model was unavailable.');

  const running = lastRun(
    schedule(),
    [task({ status: 'running', finishedAt: null, progress: 'Searching the web' })],
    now,
  );
  assert.deepEqual([running.tone, running.text], ['running', 'Running now · Searching the web']);
  assert.equal(
    lastRun(schedule(), [task({ status: 'waiting', finishedAt: null })], now).text,
    'Running now · needs your OK',
  );

  // A watch shows what its last check found; another schedule's runs are not its own.
  const watch = schedule({ notify: 'on-change', lastResult: 'Still $999.' });
  assert.equal(lastRun(watch, [task()], now).text, 'Checked 1h ago · Still $999.');
  assert.equal(
    lastRun(schedule(), [task({ scheduleId: '00000000-0000-4000-8000-0000000000bb' })], now).tone,
    'quiet',
  );
});
