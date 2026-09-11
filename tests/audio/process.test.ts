import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { PocketVoice, speakPocket } from '../../apps/desktop/src/main/voice/pocket-process';

const runtime = {
  python: '/usr/bin/python3',
  worker: resolve('tests/audio/worker-fixture.py'),
  cache: '/private/tmp/edi-unused-cache',
};
const live = () => new AbortController().signal;
/** The fixture encodes which utterance a process is serving in its samples. */
const collect = (values: number[]) => async (pcm: Float32Array) => {
  values.push(pcm[0]);
};

test('worker credits deliver validated frames in order', async () => {
  const values: number[] = [];
  await speakPocket(runtime, 'normal', live(), collect(values));
  assert.deepEqual(values, [0.25, 0.25]);
});

test('crash and malformed output reject', async () => {
  for (const mode of ['crash', 'invalid']) {
    await assert.rejects(speakPocket(runtime, mode, live(), async () => {}));
  }
});

test('deadline kills a hung worker', async () => {
  await assert.rejects(
    speakPocket(runtime, 'hang', live(), async () => {}, 100),
    /timed out/,
  );
});

test('abort interrupts even a blocked audio consumer', async () => {
  const controller = new AbortController();
  await assert.rejects(
    speakPocket(runtime, 'normal', controller.signal, async () => {
      controller.abort();
      await new Promise(() => {});
    }),
    /cancelled/,
  );
});

test('a warm voice serves consecutive replies from one loaded process', async () => {
  const voice = new PocketVoice(runtime);
  try {
    const values: number[] = [];
    await voice.speak('normal', live(), collect(values));
    await voice.speak('normal', live(), collect(values));
    assert.deepEqual(values, [0.25, 0.25, 0.5, 0.5]); // second utterance, same process
  } finally {
    voice.dispose();
  }
});

test('Stop mid-reply cancels at a frame boundary and keeps the model loaded', async () => {
  const voice = new PocketVoice(runtime);
  try {
    const controller = new AbortController();
    const heard: number[] = [];
    await assert.rejects(
      voice.speak('long', controller.signal, async pcm => {
        heard.push(pcm[0]);
        controller.abort();
      }),
      /cancelled/,
    );
    assert.deepEqual(heard, [0.25]); // nothing after Stop
    const values: number[] = [];
    await voice.speak('normal', live(), collect(values));
    assert.deepEqual(values, [0.5, 0.5]); // still the same warm process
  } finally {
    voice.dispose();
  }
});

test('an idle voice unloads, and the next reply loads a fresh process', async () => {
  const voice = new PocketVoice(runtime, { idleMs: 50 });
  try {
    const values: number[] = [];
    await voice.speak('normal', live(), collect(values));
    await new Promise(resolve => setTimeout(resolve, 150));
    await voice.speak('normal', live(), collect(values));
    assert.deepEqual(values, [0.25, 0.25, 0.25, 0.25]);
  } finally {
    voice.dispose();
  }
});

test('a crashed worker is replaced on the next reply', async () => {
  const voice = new PocketVoice(runtime);
  try {
    await assert.rejects(voice.speak('crash', live(), async () => {}));
    const values: number[] = [];
    await voice.speak('normal', live(), collect(values));
    assert.deepEqual(values, [0.25, 0.25]);
  } finally {
    voice.dispose();
  }
});
