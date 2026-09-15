import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { CapabilityBroker, defineCapability, type ToolCallRecorder } from './index';

const run = '00000000-0000-4000-8000-000000000001';
const live = () => new AbortController().signal;
const recorder: ToolCallRecorder = { created: () => {}, decided: () => {}, finished: () => {} };

const when = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('daily'), time: z.string() }).strict(),
  z.object({ kind: z.literal('every'), hours: z.number() }).strict(),
]);
const schedule = defineCapability({
  id: 'schedules.create',
  title: 'Schedule a task',
  description: 'Schedule',
  effect: 'read',
  timeoutMs: 1000,
  input: z.object({ title: z.string(), when }).strict(),
  prepare: () => ({
    preview: { title: 'x', action: 'x', summary: 'x', fields: [] },
    execute: async () => ({ summary: 'Scheduled.' }),
  }),
});

type Guide = {
  error: string;
  attempt: number;
  problems: { field: string; problem: string; sent: string; expected: Record<string, unknown> }[];
  next: string;
};

test('invalid input tells the model the field, what it sent and the exact shape expected', async () => {
  const broker = new CapabilityBroker([schedule], {
    approvals: { request: async () => 'approved' },
    recorder,
  });
  const outcome = await broker.invoke(
    run,
    'schedules_create',
    { title: 'Daily brief', when: 'every day at 9' },
    live(),
  );
  assert.equal(outcome.status, 'failed');
  // People see one short line.
  assert.match(outcome.summary, /^Invalid input: when: /);
  assert.ok(outcome.summary.length <= 160);
  // The model sees what to change, down to the literal "kind" values it must use.
  const guide = outcome.output as Guide;
  assert.equal(guide.error, 'invalid_input');
  assert.equal(guide.problems[0]!.field, 'when');
  assert.equal(guide.problems[0]!.sent, '"every day at 9"');
  const expected = JSON.stringify(guide.problems[0]!.expected);
  assert.match(expected, /"const":"daily"/);
  assert.match(expected, /"time"/);
  assert.match(guide.next, /Call schedules_create again/);
});

test('after three invalid calls in a run, the model is told to stop and ask', async () => {
  const broker = new CapabilityBroker([schedule], {
    approvals: { request: async () => 'approved' },
    recorder,
  });
  const attempt = async (runId = run) =>
    (await broker.invoke(runId, 'schedules_create', { title: 'x', when: 'nope' }, live()))
      .output as Guide;
  assert.match((await attempt()).next, /Call schedules_create again/);
  assert.match((await attempt()).next, /Call schedules_create again/);
  const third = await attempt();
  assert.equal(third.attempt, 3);
  assert.match(third.next, /Do not call it again in this reply/);
  // A new run starts counting afresh.
  assert.equal((await attempt('00000000-0000-4000-8000-000000000002')).attempt, 1);
});
