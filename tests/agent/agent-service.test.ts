import test from 'node:test';
import assert from 'node:assert/strict';
import { createRepositories, openDatabase } from '../../packages/storage/src/index';
import { AgentService } from '../../apps/desktop/src/main/agent/agent-service';

type Options = ConstructorParameters<typeof AgentService>[0];

/** An agent that gets as far as looking at the screen and is told it may not: no worker starts. */
function service(extra: Partial<Options> = {}) {
  return new AgentService({
    ...extra,
    credentials: { configured: true, model: 'test/model' },
    repositories: createRepositories(openDatabase(':memory:')),
    capabilities: [],
    captureScreens: async () => ({ screenshots: [], access: 'denied' }),
  } as unknown as Options);
}

test('a turn knows it was spoken from its very first state, before it has a worker', async () => {
  const agent = service();
  const seen: (boolean | undefined)[] = [];
  agent.onChange(state => {
    if (state.status === 'running') seen.push(agent.runningSpoken);
  });
  await agent.ask('How are you doing?', { spoken: true });
  // The bubble decides how to show the answer on this first state: words only when spoken.
  assert.equal(seen[0], true);
  assert.equal(agent.runningSpoken, undefined, 'nothing is running afterwards');

  const typed: (boolean | undefined)[] = [];
  const other = service();
  other.onChange(state => {
    if (state.status === 'running') typed.push(other.runningSpoken);
  });
  await other.ask('How are you doing?');
  assert.equal(typed[0], false);
});

test('each turn is weighed for which model it goes to, with what was asked and how', async () => {
  const asked: { prompt: string; spoken: boolean }[] = [];
  const agent = service({
    modelFor: turn => {
      asked.push(turn);
      return 'strong/model';
    },
  });
  await agent.ask('Write a project proposal');
  await agent.ask('How are you?', { spoken: true });
  assert.deepEqual(asked, [
    { prompt: 'Write a project proposal', spoken: false },
    { prompt: 'How are you?', spoken: true },
  ]);
});
