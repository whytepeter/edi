import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { speakPocket } from '../../apps/desktop/src/main/voice/pocket-process';

const runtime = { python: '/usr/bin/python3', worker: resolve('tests/audio/worker-fixture.py'), cache: '/private/tmp/edi-unused-cache' };
test('worker credits deliver validated frames in order', async () => {
  let count = 0;
  await speakPocket(runtime, 'normal', new AbortController().signal, async pcm => {
    assert.equal(pcm[0], 0.25);
    count++;
  });
  assert.equal(count, 2);
});
test('crash and malformed output reject', async () => {
  for (const mode of ['crash', 'invalid']) {
    await assert.rejects(speakPocket(runtime, mode, new AbortController().signal, async () => {}));
  }
});
test('deadline kills a hung worker', async () => {
  await assert.rejects(speakPocket(runtime, 'hang', new AbortController().signal, async () => {}, 100), /timed out/);
});
test('abort interrupts even a blocked audio consumer', async () => {
  const controller = new AbortController();
  await assert.rejects(speakPocket(runtime, 'normal', controller.signal, async () => {
    controller.abort();
    await new Promise(() => {});
  }), /cancelled/);
});
