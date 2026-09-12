import test from 'node:test';
import assert from 'node:assert/strict';
import {
  VoiceController,
  cleanTranscript,
  speakable,
  type VoiceDependencies,
  type VoiceStatus,
} from '../../apps/desktop/src/main/voice/voice-controller';
import type { AgentState, VoiceHostEvent } from '../../packages/contracts/src/index';

const runtime = {
  transcription: { executable: 'whisper', model: 'model', vadModel: 'vad' },
  pocket: { python: 'python', worker: 'worker.py', cache: 'cache' },
};
const tick = () => new Promise(resolve => setImmediate(resolve));

function harness(overrides: Partial<VoiceDependencies<string>> = {}) {
  const sent: VoiceHostEvent[] = [];
  const statuses: VoiceStatus[] = [];
  const asked: { prompt: string; screens: string }[] = [];
  const captured: string[] = [];
  let stopped = 0;
  const reply: AgentState = {
    configured: true,
    model: 'm',
    status: 'done',
    runId: 'run-1',
    prompt: 'What is this button?',
    text: 'It is the **Save** button. [POINT:10,20:save]',
    error: '',
    steps: [],
    messages: [],
    approval: null,
    screenAccess: 'granted',
  };
  const deps: VoiceDependencies<string> = {
    runtime,
    send: event => sent.push(event),
    status: status => statuses.push(status),
    microphoneAccess: async () => true,
    captureScreens: async prompt => {
      captured.push(prompt);
      return 'screens-after-transcription';
    },
    ask: async (prompt, { screens }) => {
      asked.push({ prompt, screens });
      return 'run-1';
    },
    whenFinished: async () => reply,
    stopAgent: () => stopped++,
    transcribe: async () => ' What is this button? ',
    warmSpeech: () => {},
    speak: async (_text, _signal, consume) => {
      await consume(new Float32Array(4).fill(0.1), 24000);
    },
    ...overrides,
  };
  const voice = new VoiceController(deps);
  const types = () => sent.map(event => event.type);
  return { voice, sent, statuses, asked, captured, types, stopped: () => stopped };
}

/** Hold, get a live mic, speak, release. Returns the generation of the turn. */
async function holdAndSpeak(h: ReturnType<typeof harness>) {
  h.voice.start('push-to-talk');
  await tick(); // microphone permission
  const open = h.sent.find(event => event.type === 'open') as { generation: number };
  h.voice.clientEvent(open.generation, 'capture-ready');
  h.voice.clientEvent(open.generation, 'speech-detected');
  h.voice.release();
  return open.generation;
}

test('hold-to-talk transcribes before deciding whether the prompt needs screens', async () => {
  const h = harness();
  const generation = await holdAndSpeak(h);
  assert.equal(h.voice.phase, 'processing');
  assert.ok(h.types().includes('finish'));

  const done = h.voice.audio(generation, new Uint8Array(3200));
  await tick();
  await tick();
  const pcm = h.sent.find(event => event.type === 'pcm');
  assert.ok(pcm, 'speech was streamed to the player');
  h.voice.played(generation);
  await done;

  assert.deepEqual(h.captured, ['What is this button?']);
  assert.deepEqual(h.asked, [
    { prompt: 'What is this button?', screens: 'screens-after-transcription' },
  ]);
  assert.equal(h.voice.phase, 'idle');
  // Opening clears any old bubble; listening only appears once capture is confirmed.
  assert.deepEqual(h.statuses.slice(0, 3), ['hidden', 'listening', 'thinking']);
  assert.equal(h.statuses.at(-1), 'hidden');
});

test('releasing without speech submits nothing', async () => {
  const h = harness();
  h.voice.start('push-to-talk');
  await tick();
  const open = h.sent.find(event => event.type === 'open') as { generation: number };
  h.voice.clientEvent(open.generation, 'capture-ready');
  h.voice.release();
  assert.equal(h.voice.phase, 'idle');
  assert.equal(h.types().includes('finish'), false);
  assert.equal(h.asked.length, 0);
});

test('a refused microphone never opens capture and says why', async () => {
  const h = harness({ microphoneAccess: async () => false });
  h.voice.start('push-to-talk');
  await tick();
  assert.equal(h.types().includes('open'), false);
  assert.equal(h.voice.phase, 'error');
  assert.match(JSON.stringify(h.statuses.at(-1)), /microphone/i);
});

test('a spoken turn without OpenRouter says so instead of a generic stop', async () => {
  const h = harness({
    ask: async () => {
      throw new Error('Set up OpenRouter first.');
    },
  });
  const generation = await holdAndSpeak(h);
  await h.voice.audio(generation, new Uint8Array(3200));
  assert.deepEqual(h.statuses.at(-1), { notice: 'Set up OpenRouter first.' });
});

test('an empty transcript asks nothing and says it did not catch that', async () => {
  const h = harness({ transcribe: async () => ' [BLANK_AUDIO] ' });
  const generation = await holdAndSpeak(h);
  await h.voice.audio(generation, new Uint8Array(3200));
  assert.equal(h.asked.length, 0);
  assert.deepEqual(h.statuses.at(-1), { notice: 'I didn’t catch that.' });
});

test('Stop while speaking aborts speech, silences the player and stops the agent', async () => {
  let aborted = false;
  const h = harness({
    speak: (_text, signal) =>
      new Promise((_, reject) =>
        signal.addEventListener('abort', () => {
          aborted = true;
          reject(new Error('stopped'));
        }),
      ),
  });
  const generation = await holdAndSpeak(h);
  const done = h.voice.audio(generation, new Uint8Array(3200));
  await tick();
  await tick();
  assert.equal(h.voice.phase, 'speaking');
  h.voice.stop();
  await done;
  assert.equal(aborted, true);
  assert.ok(h.types().includes('stop-audio'));
  assert.ok(h.stopped() > 0);
  assert.equal(h.voice.phase, 'idle');
});

test('events from an older turn are ignored', async () => {
  const h = harness();
  const old = await holdAndSpeak(h);
  h.voice.start('push-to-talk'); // a new hold replaces the old turn
  await h.voice.audio(old, new Uint8Array(3200));
  assert.equal(h.asked.length, 0);
});

test('without a runtime the controller declines and nothing opens', () => {
  const h = harness({ runtime: null });
  assert.equal(h.voice.start('push-to-talk'), false);
  assert.equal(h.sent.length, 0);
});

test('transcripts and replies are cleaned for listening', () => {
  assert.equal(cleanTranscript(' [BLANK_AUDIO] (music) hello  there '), 'hello there');
  assert.equal(
    speakable('It is the **Save** button. [POINT:10,20:save]'),
    'It is the Save button.',
  );
  const long = `${'Word '.repeat(100)}end. ${'More '.repeat(100)}`;
  assert.ok(speakable(long).length <= 601);
});
