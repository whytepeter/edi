import test from 'node:test';
import assert from 'node:assert/strict';
import { createRepositories, openDatabase } from '../../packages/storage/src/index';
import type { Task } from '../../packages/contracts/src/index';
import {
  Scheduler,
  readWatchResult,
  scheduledPrompt,
} from '../../apps/desktop/src/main/agent/scheduler';

const local = (d: number, h: number, min = 0) => new Date(2026, 8, d, h, min).getTime();

function harness(start: number) {
  const repositories = createRepositories(openDatabase(':memory:'));
  let clock = start;
  const started: { prompt: string; scheduleId?: string | null }[] = [];
  const active = new Set<string>();
  const notified: string[] = [];
  const task = (scheduleId: string, result: string, status: Task['status'] = 'done'): Task => ({
    id: '00000000-0000-4000-8000-000000000001',
    title: 'x',
    prompt: 'x',
    status,
    createdAt: 0,
    startedAt: 0,
    finishedAt: 0,
    budgetUsd: 0.25,
    spentUsd: 0,
    scheduleId,
    progress: '',
    steps: [],
    result,
    error: '',
    artifactIds: [],
    approval: null,
  });
  const scheduler = new Scheduler({
    repositories,
    now: () => clock,
    tasks: {
      start: input => {
        started.push(input);
        if (input.scheduleId) active.add(input.scheduleId);
        return task(input.scheduleId ?? '', '', 'queued');
      },
      list: () => [...active].map(id => task(id, '', 'running')),
    },
    notify: (schedule, _task, summary) => notified.push(`${schedule.title}: ${summary}`),
  });
  return {
    repositories,
    scheduler,
    started,
    notified,
    task,
    finish: (id: string) => active.delete(id),
    at: (time: number) => {
      clock = time;
    },
  };
}

test('a daily schedule starts one task when due, skips a turn while its last run is going, and catches up once', () => {
  const h = harness(local(14, 8));
  const schedule = h.scheduler.create({
    prompt: 'Summarize the news',
    when: { kind: 'daily', time: '09:00' },
    notify: 'always',
    budgetUsd: 0.25,
  });
  assert.equal(schedule.nextRunAt, local(14, 9));
  h.scheduler.tick();
  assert.equal(h.started.length, 0);

  h.at(local(14, 9, 0));
  h.scheduler.tick();
  assert.equal(h.started.length, 1);
  assert.match(h.started[0]!.prompt, /scheduled task that runs every day at 09:00/);
  assert.equal(h.repositories.schedules.get(schedule.id)?.nextRunAt, local(15, 9));

  // The Mac slept for three days while that run was still going: one turn skipped, no burst.
  h.at(local(17, 12));
  h.scheduler.tick();
  assert.equal(h.started.length, 1);
  assert.equal(h.repositories.schedules.get(schedule.id)?.nextRunAt, local(18, 9));
  h.finish(schedule.id);
  h.at(local(18, 9, 5));
  h.scheduler.tick();
  h.scheduler.tick();
  assert.equal(h.started.length, 2);

  h.scheduler.setEnabled(schedule.id, false);
  h.at(local(19, 9, 5));
  h.scheduler.tick();
  assert.equal(h.started.length, 2);
  assert.throws(
    () =>
      h.scheduler.create({
        prompt: 'Too late',
        when: { kind: 'once', at: '2026-09-01T10:00' },
        notify: 'always',
        budgetUsd: 0.25,
      }),
    /already passed/,
  );
});

test('a watch compares with its last check and only speaks up when something changed', () => {
  const h = harness(local(14, 8));
  const watch = h.scheduler.create({
    title: 'MacBook price',
    prompt: 'Check the MacBook Air price on apple.com',
    when: { kind: 'every', hours: 4 },
    notify: 'on-change',
    budgetUsd: 0.1,
  });
  assert.match(scheduledPrompt(watch), /first check/);

  // First check: a baseline, kept but not announced.
  h.scheduler.finished(h.task(watch.id, 'UNCHANGED: $999 for the 13-inch.'));
  assert.deepEqual(h.notified, []);
  const stored = h.repositories.schedules.get(watch.id)!;
  assert.equal(stored.lastResult, '$999 for the 13-inch.');
  assert.match(scheduledPrompt(stored), /previous check found:\n"""\n\$999 for the 13-inch\./);

  h.scheduler.finished(h.task(watch.id, 'UNCHANGED: Still $999.'));
  assert.deepEqual(h.notified, []);
  h.scheduler.finished(h.task(watch.id, '**CHANGED:** Now $899 in the back-to-school sale.'));
  assert.deepEqual(h.notified, ['MacBook price: Now $899 in the back-to-school sale.']);

  // Failed checks don't overwrite what the watch knows.
  h.scheduler.finished(h.task(watch.id, '', 'failed'));
  assert.equal(
    h.repositories.schedules.get(watch.id)?.lastResult,
    'Now $899 in the back-to-school sale.',
  );
  assert.deepEqual(readWatchResult('A new version is out.'), {
    changed: true,
    summary: 'A new version is out.',
  });
});
