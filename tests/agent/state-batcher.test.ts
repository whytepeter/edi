import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyAgentState, type AgentState } from '../../packages/contracts/src/index';
import { batchTextUpdates } from '../../apps/desktop/src/main/agent/state-batcher';

/** What a streaming run looks like: each update spreads the last one, as AgentService does. */
function stream() {
  let state = emptyAgentState({ configured: true, status: 'running', runId: 'run-1' });
  return {
    get state() {
      return state;
    },
    write(text: string) {
      state = { ...state, text: state.text + text, messages: [] };
      return state;
    },
    change(patch: Partial<AgentState>) {
      state = { ...state, ...patch, messages: [] };
      return state;
    },
  };
}

test('streamed words reach the card in batches, always as the newest text', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const sent: AgentState[] = [];
  const push = batchTextUpdates(state => sent.push(state), 33);
  const run = stream();

  push(run.state);
  assert.equal(sent.length, 1, 'the first state goes at once');
  for (const word of ['Here ', 'is ', 'your ', 'answer']) push(run.write(word));
  assert.equal(sent.length, 1, 'words wait for the next batch');
  t.mock.timers.tick(33);
  assert.equal(sent.length, 2);
  assert.equal(sent[1]!.text, 'Here is your answer');
  t.mock.timers.tick(100);
  assert.equal(sent.length, 2, 'nothing new, nothing sent');
});

test('anything other than text goes at once, carrying the words still waiting', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const sent: AgentState[] = [];
  const push = batchTextUpdates(state => sent.push(state), 33);
  const run = stream();

  push(run.state);
  push(run.write('Checking'));
  push(
    run.change({
      steps: [
        { callId: 'c1', capability: 'web.fetch', title: 'Read', status: 'running', summary: '' },
      ],
    }),
  );
  assert.equal(sent.length, 2, 'a new step is not held back');
  assert.equal(sent[1]!.text, 'Checking');
  assert.equal(sent[1]!.steps.length, 1);

  push(run.write(' done.'));
  push(run.change({ status: 'done' }));
  assert.equal(sent.length, 3, 'the end of the reply is sent at once');
  assert.equal(sent[2]!.status, 'done');
  assert.equal(sent[2]!.text, 'Checking done.');
  t.mock.timers.tick(100);
  assert.equal(sent.length, 3, 'the timer that was waiting sends nothing twice');
});
