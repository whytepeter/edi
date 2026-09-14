import test from 'node:test';
import assert from 'node:assert/strict';
import {
  connectAppCapability,
  resumeWhenConnected,
  type WaitingRequest,
} from '../../apps/desktop/src/main/connectors/connect-offer';
import type { Connector } from '../../packages/contracts/src/index';

const context = {
  callId: '00000000-0000-4000-8000-000000000001',
  runId: '00000000-0000-4000-8000-000000000002',
};
const todoist = { id: 'todoist', name: 'Todoist' };

test('connecting an app is reviewed, opens its sign-in and waits to continue the request', async () => {
  const started: string[] = [];
  const resumed: unknown[] = [];
  const tool = connectAppCapability({
    available: () => [todoist],
    start: appId => {
      started.push(appId);
      return 'connection-1';
    },
    resumeAfter: (...args) => resumed.push(args),
  });
  assert.equal(tool.effect, 'write');
  const input = tool.input.parse({ app: 'todoist', request: 'Add milk to my shopping list' });
  const action = await tool.prepare(input, context);
  assert.deepEqual(action.preview.fields, [
    { label: 'App', value: 'Todoist' },
    { label: 'Then', value: 'Add milk to my shopping list' },
  ]);
  // Nothing happens until the person approves and the action runs.
  assert.deepEqual(started, []);
  const result = await action.execute(new AbortController().signal);
  assert.deepEqual(started, ['todoist']);
  assert.deepEqual(resumed, [
    ['connection-1', todoist, 'Add milk to my shopping list', context.runId],
  ]);
  assert.match(String((result.output as { note: string }).note), /Do not try it now/);

  // Apps that aren't on offer (already connected, or needing the Composio key) are refused.
  await assert.rejects(
    async () => tool.prepare(tool.input.parse({ app: 'gmail', request: 'x' }), context),
    /can’t be connected from here/,
  );
});

test('a waiting request continues once, when its app connects, and not after it is dropped', () => {
  let listener: (list: Connector[]) => void = () => {};
  const continued: WaitingRequest[] = [];
  let clock = 0;
  const waits = resumeWhenConnected({
    onChange: next => {
      listener = next;
    },
    continueRequest: waiting => continued.push(waiting),
    waitMs: 1_000,
    now: () => clock,
  });
  const connector = (id: string, status: Connector['status']) =>
    ({ id, status }) as unknown as Connector;
  const request = { conversationId: 'c1', app: todoist, request: 'Add milk' };

  waits.wait('a', request);
  listener([connector('a', 'signing-in')]);
  listener([connector('a', 'error')]); // a failed sign-in can still be retried
  assert.deepEqual(continued, []);
  listener([connector('a', 'connected')]);
  listener([connector('a', 'connected')]);
  assert.deepEqual(continued, [request]);

  // Switched off, removed, or waited too long: the request is dropped.
  waits.wait('b', request);
  listener([connector('b', 'off')]);
  waits.wait('c', request);
  listener([]);
  waits.wait('d', request);
  clock = 2_000;
  listener([connector('d', 'connected')]);
  assert.equal(continued.length, 1);
  assert.equal(waits.size, 0);
});
