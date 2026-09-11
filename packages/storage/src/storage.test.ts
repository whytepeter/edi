import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRepositories, latestVersion, migrate, openDatabase } from './index';

const run = (id: string, startedAt = 1) => ({
  id,
  prompt: 'Save my list',
  model: 'test/model',
  screens: 0,
  startedAt,
});
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

test('migrations are atomic, versioned and idempotent', () => {
  const db = openDatabase(':memory:');
  assert.equal(
    (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version,
    latestVersion,
  );
  migrate(db); // second run is a no-op
  assert.equal(
    db.prepare(`SELECT count(*) AS n FROM sqlite_master WHERE name = 'runs'`).get()?.n,
    1,
  );
  db.exec(`PRAGMA user_version = ${latestVersion + 1}`);
  assert.throws(() => migrate(db), /newer than this app/);
});

test('activity returns runs newest first with their tool steps in order', () => {
  const repos = createRepositories(openDatabase(':memory:'));
  repos.runs.start(run(uuid(1), 100));
  repos.runs.start(run(uuid(2), 200));
  const call = {
    runId: uuid(2),
    capability: 'notes.save',
    title: 'Save a note',
    effect: 'write' as const,
  };
  repos.toolCalls.create({
    ...call,
    id: uuid(10),
    input: { title: 'A' },
    status: 'awaiting-approval',
    at: 201,
  });
  repos.toolCalls.decide(uuid(10), 'approved', 202);
  repos.toolCalls.finish(uuid(10), 'succeeded', 'Saved “A”', { path: '/tmp/a.md' }, 203);
  repos.toolCalls.create({
    ...call,
    id: uuid(11),
    input: {},
    status: 'awaiting-approval',
    at: 204,
  });
  repos.toolCalls.decide(uuid(11), 'denied', 205);
  repos.toolCalls.finish(uuid(11), 'denied', 'Declined', undefined, 205);
  repos.runs.finish(uuid(2), { status: 'done', text: 'Done', error: '', at: 210 });

  const activity = repos.activity(10);
  assert.deepEqual(
    activity.map(r => [r.id, r.status]),
    [
      [uuid(2), 'done'],
      [uuid(1), 'running'],
    ],
  );
  assert.deepEqual(
    activity[0].steps.map(s => [s.callId, s.status]),
    [
      [uuid(10), 'succeeded'],
      [uuid(11), 'denied'],
    ],
  );
});

test('a decision only applies to a call that is still awaiting one', () => {
  const db = openDatabase(':memory:');
  const repos = createRepositories(db);
  repos.runs.start(run(uuid(1)));
  repos.toolCalls.create({
    id: uuid(10),
    runId: uuid(1),
    capability: 'notes.save',
    title: 'Save a note',
    effect: 'write',
    input: {},
    status: 'awaiting-approval',
    at: 1,
  });
  repos.toolCalls.finish(uuid(10), 'cancelled', 'Stopped', undefined, 2);
  repos.toolCalls.decide(uuid(10), 'approved', 3); // stale approval
  const row = db.prepare('SELECT status, decision FROM tool_calls').get();
  assert.deepEqual({ ...row }, { status: 'cancelled', decision: null });
});

test('startup recovery never replays: runs interrupt, approvals cancel, in-flight writes are unknown', () => {
  const repos = createRepositories(openDatabase(':memory:'));
  repos.runs.start(run(uuid(1)));
  const base = {
    runId: uuid(1),
    capability: 'notes.save',
    title: 'Save a note',
    effect: 'write' as const,
    input: {},
    at: 1,
  };
  repos.toolCalls.create({ ...base, id: uuid(10), status: 'awaiting-approval' });
  repos.toolCalls.create({ ...base, id: uuid(11), status: 'running' });
  repos.toolCalls.create({ ...base, id: uuid(12), status: 'succeeded' });

  assert.deepEqual(repos.recoverInterrupted(50), { runs: 1, approvals: 1, uncertain: 1 });
  const [recovered] = repos.activity(1);
  assert.equal(recovered.status, 'interrupted');
  assert.deepEqual(
    recovered.steps.map(s => s.status),
    ['cancelled', 'unknown', 'succeeded'],
  );
  assert.deepEqual(repos.recoverInterrupted(60), { runs: 0, approvals: 0, uncertain: 0 });
});

test('schema rejects impossible states', () => {
  const repos = createRepositories(openDatabase(':memory:'));
  repos.runs.start(run(uuid(1)));
  assert.throws(() =>
    repos.toolCalls.create({
      id: uuid(10),
      runId: uuid(1),
      capability: 'x',
      title: 'x',
      effect: 'write',
      input: {},
      status: 'approved-ish' as never,
      at: 1,
    }),
  );
  assert.throws(() => repos.runs.start(run(uuid(1)))); // duplicate id
});

test('recent exchanges are completed turns, oldest first, clipped', () => {
  const repos = createRepositories(openDatabase(':memory:'));
  for (const [n, status] of [
    [1, 'done'],
    [2, 'error'],
    [3, 'done'],
    [4, 'done'],
  ] as const) {
    repos.runs.start({ ...run(uuid(n), n), prompt: `question ${n}` });
    repos.runs.finish(uuid(n), {
      status,
      text: status === 'done' ? `answer ${n}` : '',
      error: '',
      at: n,
    });
  }
  assert.deepEqual(repos.runs.recentExchanges(2), [
    { prompt: 'question 3', reply: 'answer 3' },
    { prompt: 'question 4', reply: 'answer 4' },
  ]);
  assert.equal(repos.runs.recentExchanges(10, { prompt: 4, reply: 3 })[0].reply, 'ans');
});

test('activity reports how many screens were sent', () => {
  const repos = createRepositories(openDatabase(':memory:'));
  repos.runs.start({ ...run(uuid(1)), screens: 2 });
  assert.equal(repos.activity(1)[0].screens, 2);
});
