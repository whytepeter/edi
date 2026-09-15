import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { MlxVoice } from '../../apps/desktop/src/main/voice/mlx-process';

const runtime = {
  python: '/usr/bin/python3',
  worker: resolve('tests/audio/worker-fixture.py'),
  cache: '/private/tmp/edi-unused-cache',
};
const chatterbox = { id: 'chatterbox-turbo', model: 'fixture', label: 'Chatterbox Turbo' } as const;
const kokoro = { id: 'kokoro', model: 'fixture', label: 'Kokoro', voice: 'af_heart' } as const;
const live = () => new AbortController().signal;
/** The fixture encodes which utterance a process is serving in its samples. */
const collect = (values: number[]) => async (pcm: Float32Array) => {
  values.push(pcm[0]);
};

test('worker credits deliver validated frames in order', async () => {
  const voice = new MlxVoice(runtime, kokoro);
  try {
    const values: number[] = [];
    await voice.speak('normal', live(), collect(values));
    assert.deepEqual(values, [0.25, 0.25]);
  } finally {
    voice.dispose();
  }
});

test('crash and malformed output reject', async () => {
  for (const mode of ['crash', 'invalid']) {
    const voice = new MlxVoice(runtime, kokoro);
    try {
      await assert.rejects(voice.speak(mode, live(), async () => {}));
    } finally {
      voice.dispose();
    }
  }
});

test('deadline kills a hung worker', async () => {
  const voice = new MlxVoice(runtime, kokoro);
  try {
    await assert.rejects(
      voice.speak('hang', live(), async () => {}, { timeoutMs: 100 }),
      /timed out/,
    );
  } finally {
    voice.dispose();
  }
});

test('abort interrupts even a blocked audio consumer', async () => {
  const voice = new MlxVoice(runtime, kokoro);
  try {
    const controller = new AbortController();
    await assert.rejects(
      voice.speak('normal', controller.signal, async () => {
        controller.abort();
        await new Promise(() => {});
      }),
    );
  } finally {
    voice.dispose();
  }
});

test('an idle voice unloads, and the next reply loads a fresh process', async () => {
  const voice = new MlxVoice(runtime, kokoro, { idleMs: 50 });
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
  const voice = new MlxVoice(runtime, kokoro);
  try {
    await assert.rejects(voice.speak('crash', live(), async () => {}));
    const values: number[] = [];
    await voice.speak('normal', live(), collect(values));
    assert.deepEqual(values, [0.25, 0.25]);
  } finally {
    voice.dispose();
  }
});

test('Stopping Chatterbox Turbo mid-reply keeps the loaded model for the next reply', async () => {
  const voice = new MlxVoice(runtime, chatterbox);
  const values: number[] = [];
  try {
    const stop = new AbortController();
    await assert.rejects(
      voice.speak('long', stop.signal, async pcm => {
        values.push(pcm[0]!);
        stop.abort();
      }),
    );
    await voice.speak('Again.', live(), collect(values));
    // 0.5 means the same warm process served the second reply.
    assert.deepEqual(values, [0.25, 0.5, 0.5]);
    assert.equal(voice.status, 'ready');
  } finally {
    voice.dispose();
  }
});

test('Chatterbox Turbo keeps a warm worker and accepts expression tags', async () => {
  const voice = new MlxVoice(runtime, chatterbox);
  const values: number[] = [];
  try {
    await voice.speak('That is funny. [laugh]', live(), collect(values));
    await voice.speak('Again.', live(), collect(values));
    assert.deepEqual(values, [0.25, 0.25, 0.5, 0.5]);
  } finally {
    voice.dispose();
  }
});

test('Kokoro names the chosen voice per reply and reuses one warm worker', async () => {
  const voice = new MlxVoice(runtime, kokoro);
  const values: number[] = [];
  try {
    await voice.speak('Hello.', live(), collect(values), { voice: 'bf_emma' });
    await voice.speak('Again.', live(), collect(values), { voice: 'af_heart' });
    assert.deepEqual(values, [0.25, 0.25, 0.5, 0.5]);
    assert.equal(voice.status, 'ready');
    // A worker that dies on a request is replaced for the next reply.
    await assert.rejects(voice.speak('Broken.', live(), async () => {}, { voice: 'bad-voice' }));
    await voice.speak('Fresh.', live(), collect(values));
    assert.deepEqual(values.slice(-2), [0.25, 0.25]);
  } finally {
    voice.dispose();
  }
});

test('an MLX worker reporting a different engine is refused', async () => {
  const voice = new MlxVoice(runtime, { ...kokoro, model: 'wrong-engine' });
  try {
    await assert.rejects(
      voice.speak('Hi.', live(), async () => {}),
      /Invalid Kokoro frame/,
    );
    assert.equal(voice.status, 'off');
  } finally {
    voice.dispose();
  }
});

test('a personal Chatterbox voice reaches the worker with its recording; bad ids never do', async () => {
  const withEdi = new MlxVoice(runtime, {
    ...chatterbox,
    references: () => ({ edi: '/tmp/edi.wav', '../escape': '/tmp/x.wav' }),
  });
  try {
    const values: number[] = [];
    await withEdi.speak('normal', live(), collect(values), { voice: 'edi' });
    assert.ok(values.length > 0);
  } finally {
    withEdi.dispose();
  }
  const without = new MlxVoice(runtime, chatterbox);
  try {
    await assert.rejects(without.speak('normal', live(), async () => {}, { voice: 'edi' }));
  } finally {
    without.dispose();
  }
});
