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

/** A scheduler over a task list the test controls, so ended runs are visible too. */
function withTasks(start: number) {
  const repositories = createRepositories(openDatabase(':memory:'));
  let clock = start;
  let count = 0;
  const tasks: Task[] = [];
  const notices: { kind: string; title: string; summary: string }[] = [];
  const scheduler = new Scheduler({
    repositories,
    now: () => clock,
    tasks: {
      start: input => {
        const task: Task = {
          id: `00000000-0000-4000-8000-${String(++count).padStart(12, '0')}`,
          title: input.title ?? 'x',
          prompt: input.prompt,
          status: 'running',
          createdAt: clock,
          startedAt: clock,
          finishedAt: null,
          budgetUsd: input.budgetUsd,
          spentUsd: 0,
          scheduleId: input.scheduleId ?? null,
          progress: '',
          steps: [],
          result: '',
          error: '',
          artifactIds: [],
          approval: null,
        };
        tasks.push(task);
        return task;
      },
      list: () => [...tasks].reverse(),
    },
    notify: (schedule, _task, summary, kind) =>
      notices.push({ kind, title: schedule.title, summary }),
  });
  /** End the newest run of a schedule and tell the scheduler, as the task service does. */
  const end = (status: Task['status'], detail = '') => {
    const task = tasks.at(-1)!;
    Object.assign(task, {
      status,
      finishedAt: clock,
      ...(status === 'failed' ? { error: detail } : { result: detail }),
    });
    scheduler.finished(task);
  };
  return {
    repositories,
    scheduler,
    tasks,
    notices,
    end,
    at: (time: number) => {
      clock = time;
    },
  };
}

test('run now starts one run at once and leaves the next scheduled time alone', () => {
  const h = withTasks(local(14, 8));
  const schedule = h.scheduler.create({
    prompt: 'Summarize the news',
    when: { kind: 'daily', time: '09:00' },
    notify: 'always',
    budgetUsd: 0.25,
  });
  const run = h.scheduler.runNow(schedule.id);
  assert.equal(run.scheduleId, schedule.id);
  assert.equal(h.tasks.length, 1);
  // Asking again while it is still going returns the same run instead of starting another.
  assert.equal(h.scheduler.runNow(schedule.id).id, run.id);
  assert.equal(h.tasks.length, 1);
  const after = h.repositories.schedules.get(schedule.id)!;
  assert.equal(after.nextRunAt, local(14, 9));
  assert.equal(after.lastRunAt, local(14, 8));
  assert.throws(
    () => h.scheduler.runNow('00000000-0000-4000-8000-00000000dead'),
    /no longer exists/,
  );
});

test('a schedule can be renamed, retimed and given new instructions without being remade', () => {
  const h = withTasks(local(14, 8));
  const watch = h.scheduler.create({
    title: 'Price watch',
    prompt: 'Check the price of the desk',
    when: { kind: 'daily', time: '09:00' },
    notify: 'on-change',
    budgetUsd: 0.25,
  });
  h.repositories.schedules.update(watch.id, { lastResult: 'It costs $300.' });

  const retimed = h.scheduler.update(watch.id, {
    title: 'Desk price',
    when: { kind: 'every', hours: 4 },
  });
  assert.equal(retimed.title, 'Desk price');
  assert.deepEqual(retimed.when, { kind: 'every', hours: 4 });
  // The new rhythm counts from now, and what it last found still stands.
  assert.equal(retimed.nextRunAt, local(14, 12));
  assert.equal(retimed.lastResult, 'It costs $300.');

  // New instructions watch something else, so the old result is no longer a baseline.
  const repointed = h.scheduler.update(watch.id, { prompt: 'Check the price of the chair' });
  assert.equal(repointed.prompt, 'Check the price of the chair');
  assert.equal(repointed.lastResult, '');

  assert.throws(
    () => h.scheduler.update(watch.id, { when: { kind: 'once', at: '2026-09-01T09:00' } }),
    /already passed/,
  );
  assert.throws(() => h.scheduler.update(watch.id, { title: '   ' }), /needs a name/);

  // A paused schedule keeps its new time for when it is turned back on.
  h.scheduler.setEnabled(watch.id, false);
  const paused = h.scheduler.update(watch.id, { when: { kind: 'daily', time: '07:30' } });
  assert.equal(paused.enabled, false);
  h.scheduler.setEnabled(watch.id, true);
  assert.equal(h.repositories.schedules.get(watch.id)!.nextRunAt, local(15, 7, 30));
});

test('a failed run says so, and three in a row pause the schedule', () => {
  const h = withTasks(local(14, 8));
  const schedule = h.scheduler.create({
    title: 'Morning brief',
    prompt: 'Summarize the news',
    when: { kind: 'every', hours: 1 },
    notify: 'always',
    budgetUsd: 0.25,
  });
  const run = (hour: number, status: Task['status'], detail: string) => {
    h.at(local(14, hour));
    h.scheduler.tick();
    h.end(status, detail);
  };

  run(9, 'failed', 'The model was unavailable.');
  assert.deepEqual(h.notices.at(-1), {
    kind: 'failed',
    title: 'Morning brief',
    summary: 'The model was unavailable.',
  });
  assert.equal(h.repositories.schedules.get(schedule.id)!.enabled, true);

  // A good run in between means it is not stuck.
  run(10, 'done', 'Here is the news.');
  assert.equal(h.notices.at(-1)?.kind, 'ready');
  run(11, 'failed', 'No connection.');
  run(12, 'failed', 'No connection.');
  assert.equal(h.repositories.schedules.get(schedule.id)!.enabled, true);

  run(13, 'failed', 'No connection.');
  assert.equal(h.notices.at(-1)?.kind, 'paused');
  assert.equal(h.repositories.schedules.get(schedule.id)!.enabled, false);
  // Paused means paused: nothing more starts until the person turns it back on.
  const before = h.tasks.length;
  h.at(local(14, 15));
  h.scheduler.tick();
  assert.equal(h.tasks.length, before);
});

test('a run the person stopped is not a failure and says nothing', () => {
  const h = withTasks(local(14, 8));
  h.scheduler.create({
    prompt: 'Summarize the news',
    when: { kind: 'every', hours: 1 },
    notify: 'always',
    budgetUsd: 0.25,
  });
  h.at(local(14, 9));
  h.scheduler.tick();
  h.end('cancelled');
  assert.deepEqual(h.notices, []);
});
