import test from 'node:test';
import assert from 'node:assert/strict';
import { sleepAfterReply } from '../../apps/desktop/src/main/character/sleep-after-reply';

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function reply() {
  const state = { writing: true, speaking: true, exchange: 'turn-1', asking: false };
  let slept = 0;
  const cancel = sleepAfterReply(
    {
      writing: () => state.writing,
      speaking: () => state.speaking,
      exchange: () => state.exchange,
      asking: () => state.asking,
    },
    () => slept++,
    { pollMs: 2, maxSpeechMs: 200 },
  );
  return { state, slept: () => slept, cancel };
}

test('"go to sleep" waits for the goodnight to be written and spoken, then sleeps once', async () => {
  const r = reply();
  await wait(15);
  assert.equal(r.slept(), 0, 'still writing');
  r.state.writing = false;
  await wait(15);
  assert.equal(r.slept(), 0, 'still speaking');
  r.state.speaking = false;
  await wait(15);
  assert.equal(r.slept(), 1);
  await wait(15);
  assert.equal(r.slept(), 1);
});

test('a new question, or holding to talk, keeps Edi awake', async () => {
  const next = reply();
  next.state.writing = false;
  next.state.exchange = 'turn-2';
  next.state.speaking = false;
  await wait(20);
  assert.equal(next.slept(), 0);

  const holding = reply();
  holding.state.writing = false;
  holding.state.speaking = false;
  holding.state.asking = true;
  await wait(20);
  assert.equal(holding.slept(), 0);
});

test('speech that never ends does not keep Edi awake forever', async () => {
  const r = reply();
  r.state.writing = false;
  await wait(260);
  assert.equal(r.slept(), 1);
});
