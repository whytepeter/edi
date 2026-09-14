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
  assert.ok(activity[0]);
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
  assert.ok(recovered);
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
  assert.equal(repos.runs.recentExchanges(10, { prompt: 4, reply: 3 })[0]?.reply, 'ans');
});

test('thread includes finished turns for the chat, oldest first', () => {
  const repos = createRepositories(openDatabase(':memory:'));
  for (const [n, status, text, error] of [
    [1, 'done', 'answer 1', ''],
    [2, 'error', '', 'Could not reach the model.'],
    [3, 'stopped', 'partial', ''],
    [4, 'done', 'answer 4', ''],
  ] as const) {
    repos.runs.start({ ...run(uuid(n), n), prompt: `question ${n}` });
    repos.runs.finish(uuid(n), { status, text, error, at: n });
  }
  const turns = repos.runs.thread(3);
  assert.equal(turns.length, 3);
  assert.deepEqual(
    turns.map(turn => turn.prompt),
    ['question 2', 'question 3', 'question 4'],
  );
  assert.ok(turns[0]);
  assert.ok(turns[1]);
  assert.equal(turns[0].error, 'Could not reach the model.');
  assert.equal(turns[1].reply, 'partial');
});

test('activity reports how many screens were sent', () => {
  const repos = createRepositories(openDatabase(':memory:'));
  repos.runs.start({ ...run(uuid(1)), screens: 2 });
  assert.equal(repos.activity(1)[0]?.screens, 2);
});

test('notes can be looked up, updated and removed', () => {
  const repos = createRepositories(openDatabase(':memory:'));
  const id = uuid(30);
  repos.notes.add({
    id,
    title: 'Groceries',
    path: '/tmp/groceries.md',
    bytes: 12,
    toolCallId: null,
    createdAt: 1,
  });
  assert.equal(repos.notes.get(id)?.title, 'Groceries');
  repos.notes.update({ id, title: 'Shopping', bytes: 20 });
  assert.deepEqual(repos.notes.get(id), {
    id,
    title: 'Shopping',
    path: '/tmp/groceries.md',
    bytes: 20,
    createdAt: 1,
  });
  repos.notes.remove(id);
  assert.equal(repos.notes.get(id), undefined);
  assert.throws(() => repos.notes.update({ id, title: 'Gone', bytes: 1 }));
  assert.throws(() => repos.notes.remove(id));
});

test('shown content is found by run or id, and moved notes keep working', () => {
  const repos = createRepositories(openDatabase(':memory:'));
  repos.runs.start(run(uuid(1)));
  const shown = { runId: uuid(1), title: 'Show', effect: 'read' as const, at: 1 };
  repos.toolCalls.create({
    ...shown,
    id: uuid(2),
    capability: 'workspace.show',
    input: { kind: 'document' },
    status: 'running',
  });
  repos.toolCalls.finish(uuid(2), 'succeeded', 'Shown', { shown: true }, 2);
  repos.toolCalls.create({
    ...shown,
    id: uuid(3),
    capability: 'workspace.show',
    input: {},
    status: 'running',
  });
  repos.toolCalls.finish(uuid(3), 'failed', 'Nope', undefined, 2);
  repos.toolCalls.create({
    ...shown,
    id: uuid(4),
    capability: 'notes.list',
    input: {},
    status: 'running',
  });
  repos.toolCalls.finish(uuid(4), 'succeeded', 'Listed', {}, 2);

  const byRun = repos.toolCalls.shown(['workspace.show', 'notes.show'], { runIds: [uuid(1)] });
  assert.deepEqual(
    byRun.map(call => [call.id, call.input, call.output]),
    [[uuid(2), { kind: 'document' }, { shown: true }]],
  );
  assert.equal(byRun[0]?.createdAt, 1);
  assert.equal(repos.toolCalls.shown(['workspace.show'], { id: uuid(3) }).length, 0);

  repos.notes.add({
    id: uuid(5),
    title: 'A',
    path: '/Users/x/Documents/Edi Notes/a.md',
    bytes: 1,
    toolCallId: null,
    createdAt: 1,
  });
  repos.notes.add({
    id: uuid(6),
    title: 'B',
    path: '/Users/x/Documents/Edi Notes Old/b.md',
    bytes: 1,
    toolCallId: null,
    createdAt: 2,
  });
  assert.equal(
    repos.notes.relocate('/Users/x/Documents/Edi Notes', '/Users/x/Documents/Edi/Notes'),
    1,
  );
  assert.equal(repos.notes.get(uuid(5))?.path, '/Users/x/Documents/Edi/Notes/a.md');
  // A sibling folder that merely shares the prefix is untouched.
  assert.equal(repos.notes.get(uuid(6))?.path, '/Users/x/Documents/Edi Notes Old/b.md');
});

test('migration 3 records existing shown content as workspace artifacts under the call id', () => {
  const db = openDatabase(':memory:');
  const repos = createRepositories(db);
  repos.runs.start(run(uuid(1), 100));
  const shown = (id: number, input: unknown, output: unknown, status = 'succeeded' as const) => {
    repos.toolCalls.create({
      id: uuid(id),
      runId: uuid(1),
      capability: 'workspace.show',
      title: 'Show content',
      effect: 'read',
      input,
      status: 'running',
      at: id,
    });
    repos.toolCalls.finish(uuid(id), status, 'Showed', output, id + 1);
  };
  shown(
    20,
    { kind: 'table', title: 'Costs', columns: ['A'], rows: [['1']] },
    { shown: true, path: 'Artifacts/Tables/costs.csv', bytes: 4 },
  );
  shown(21, { kind: 'document', title: 'Failed', markdown: 'x' }, undefined, 'failed' as never);
  // Replay the migration on a database that predates it.
  db.exec('DROP TABLE usage; DROP TABLE artifacts; PRAGMA user_version = 2;');
  migrate(db);
  assert.deepEqual(repos.artifacts.list(10), [
    {
      id: uuid(20),
      kind: 'table',
      title: 'Costs',
      content: { kind: 'table', title: 'Costs', columns: ['A'], rows: [['1']] },
      path: 'Artifacts/Tables/costs.csv',
      bytes: 4,
      createdAt: 20,
      updatedAt: 21,
    },
  ]);
  repos.artifacts.update({ id: uuid(20), title: 'Costs Q3', content: {}, bytes: 9, updatedAt: 30 });
  assert.equal(repos.artifacts.get(uuid(20))?.title, 'Costs Q3');
  repos.artifacts.remove(uuid(20));
  assert.equal(repos.artifacts.get(uuid(20)), undefined);
  assert.throws(() => repos.artifacts.remove(uuid(20)), /no longer/);
});

test('usage totals by kind, model and local day; voice counts characters apart from model cost', () => {
  const repos = createRepositories(openDatabase(':memory:'));
  const now = new Date(2026, 8, 14, 15, 0).getTime();
  const earlier = new Date(2026, 8, 12, 9, 0).getTime();
  const tooOld = new Date(2026, 8, 1, 9, 0).getTime();
  const call = (kind: 'answer' | 'page-reader', model: string, costUsd: number | null) => ({
    kind,
    provider: 'openrouter' as const,
    model,
    inputTokens: 1000,
    outputTokens: 100,
    cachedTokens: kind === 'answer' ? 800 : 0,
    costUsd,
    characters: 0,
  });
  repos.usage.add(call('answer', 'anthropic/claude-sonnet-5', 0.01), now - 60_000, uuid(1));
  repos.usage.add(call('answer', 'anthropic/claude-sonnet-5', 0.02), now - 30_000, uuid(1));
  repos.usage.add(call('page-reader', 'google/gemini-3.5-flash-lite', null), now, uuid(1));
  repos.usage.add(call('answer', 'anthropic/claude-sonnet-5', 0.5), earlier, uuid(2));
  repos.usage.add(call('answer', 'anthropic/claude-sonnet-5', 9), tooOld, uuid(3));
  repos.usage.add(
    { ...call('answer', 'sonic-3.6', null), kind: 'voice', provider: 'cartesia', characters: 42 },
    now,
  );

  const today = repos.usage.summary(1, now);
  assert.equal(today.answers, 1);
  assert.equal(today.total.calls, 3);
  assert.equal(today.total.unpricedCalls, 1);
  assert.ok(Math.abs(today.total.costUsd - 0.03) < 1e-9);
  assert.deepEqual(
    today.byKind.map(entry => [entry.kind, entry.calls, entry.cachedTokens]),
    [
      ['answer', 2, 1600],
      ['page-reader', 1, 0],
    ],
  );
  assert.deepEqual(today.voice, [{ provider: 'cartesia', replies: 1, characters: 42 }]);
  assert.equal(today.daily.length, 1);

  const week = repos.usage.summary(7, now);
  assert.equal(week.answers, 2);
  assert.equal(week.daily.length, 7);
  assert.equal(week.daily.at(-1)?.day, '2026-09-14');
  assert.ok(Math.abs(week.daily.find(day => day.day === '2026-09-12')!.costUsd - 0.5) < 1e-9);
  assert.equal(week.byModel[0]?.model, 'anthropic/claude-sonnet-5');
  assert.throws(() => repos.usage.add({ ...call('answer', 'x', -1) }, now));
});
