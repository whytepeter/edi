import test from 'node:test';
import assert from 'node:assert/strict';
import {
  VoiceController,
  cleanTranscript,
  speakable,
  takeSpeech,
  type VoiceDependencies,
  type VoiceStatus,
} from '../../apps/desktop/src/main/voice/voice-controller';
import {
  cueSegments,
  type AgentState,
  type VoiceHostEvent,
} from '../../packages/contracts/src/index';

const runtime = {
  transcription: { executable: 'whisper', model: 'model', vadModel: 'vad' },
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
  // Opening gives immediate character feedback without claiming the mic is ready.
  assert.deepEqual(h.statuses.slice(0, 3), ['opening', 'listening', 'thinking']);
  assert.ok(h.statuses.includes('speaking'));
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

test('a refused microphone leaves guidance to the just-in-time permission card', async () => {
  const h = harness({ microphoneAccess: async () => false });
  h.voice.start('push-to-talk');
  await tick();
  assert.equal(h.types().includes('open'), false);
  assert.equal(h.voice.phase, 'error');
  assert.equal(h.statuses.at(-1), 'hidden');
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

test('with spoken replies off, the answer stays in the conversation and nothing plays', async () => {
  let spoke = false;
  const h = harness({
    speakReplies: () => false,
    speak: async () => {
      spoke = true;
    },
  });
  const generation = await holdAndSpeak(h);
  await h.voice.audio(generation, new Uint8Array(3200));
  assert.equal(h.asked.length, 1);
  assert.equal(spoke, false);
  assert.equal(h.statuses.includes('speaking'), false);
  assert.deepEqual(h.statuses.at(-1), { notice: 'Answered in Conversations.' });
});

test('Stop while speaking aborts speech, silences the player and stops the agent', async () => {
  let aborted = false;
  const h = harness({
    speak: (_text, signal, consume) => {
      void consume(new Float32Array(4).fill(0.1), 24000).catch(() => {});
      return new Promise((_, reject) =>
        signal.addEventListener('abort', () => {
          aborted = true;
          reject(new Error('stopped'));
        }),
      );
    },
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

test('Edi shows speaking only when synthesized audio arrives, not while it is generated', async () => {
  let deliver!: () => void;
  const h = harness({
    speak: (_text, _signal, consume) =>
      new Promise<void>(resolve => {
        deliver = () => void consume(new Float32Array(4).fill(0.1), 24000).then(resolve, resolve);
      }),
  });
  const generation = await holdAndSpeak(h);
  const done = h.voice.audio(generation, new Uint8Array(3200));
  for (let i = 0; i < 6; i++) await tick();
  // The reply text is ready and handed to the voice, but no sound exists yet.
  assert.equal(h.statuses.includes('speaking'), false);
  assert.equal(h.voice.phase, 'processing');
  deliver();
  await tick();
  assert.ok(h.statuses.includes('speaking'));
  assert.equal(h.voice.phase, 'speaking');
  h.voice.stop();
  await done;
});

test('speech starts on the first spoken sentence before the run ends', async () => {
  const spoken: string[] = [];
  let report: ((state: AgentState) => void) | undefined;
  let finish!: (state: AgentState) => void;
  const running: AgentState = {
    ...{
      configured: true,
      model: 'm',
      status: 'running',
      runId: 'run-1',
      prompt: 'What is this button?',
      text: '',
      error: '',
      steps: [],
      messages: [],
      approval: null,
      screenAccess: 'granted',
    },
  };
  const h = harness({
    whenFinished: (_runId, _signal, onUpdate) => {
      report = onUpdate;
      return new Promise(resolve => {
        finish = resolve;
      });
    },
    speak: async (text, _signal, consume) => {
      spoken.push(text);
      void consume(new Float32Array(4).fill(0.1), 24000).catch(() => {});
    },
  });
  const generation = await holdAndSpeak(h);
  const done = h.voice.audio(generation, new Uint8Array(3200));
  await tick();
  await tick();
  report?.({ ...running, text: 'It is the Save button. ' });
  await tick();
  assert.deepEqual(spoken, ['It is the Save button.']);
  assert.ok(h.statuses.includes('speaking'));
  const finished: AgentState = {
    ...running,
    status: 'done',
    text: 'It is the Save button. I can also open it.',
  };
  report?.(finished);
  finish(finished);
  await done;
  assert.deepEqual(spoken, ['It is the Save button.', 'I can also open it.']);
});

test('transcripts and replies are cleaned for listening', () => {
  assert.equal(cleanTranscript(' [BLANK_AUDIO] (music) hello  there '), 'hello there');
  assert.equal(
    speakable('It is the **Save** button. [POINT:10,20:save]'),
    'It is the Save button.',
  );
  const long = `${'Word '.repeat(100)}end. ${'More '.repeat(100)}`;
  assert.ok(speakable(long).length <= 601);
  assert.equal(speakable('That worked. [laugh]'), 'That worked.');
  // Web sources: link text is spoken, addresses are not.
  assert.equal(
    speakable('It rained, says [BBC Weather](https://www.bbc.co.uk/weather). See https://x.io/a.'),
    'It rained, says BBC Weather. See.',
  );
  assert.equal(speakable('That worked. [laugh]', true), 'That worked. [laugh]');
  assert.deepEqual(takeSpeech('Hello there. More coming', '', false, false), {
    say: 'Hello there.',
    spoken: 'Hello there.',
  });
  assert.deepEqual(takeSpeech('Hello there. I can help.', 'Hello there.', false, true), {
    say: 'I can help.',
    spoken: 'Hello there. I can help.',
  });
  // No fixed word count: the first clip waits for a sentence end or a natural clause break.
  assert.equal(takeSpeech('one two three four five six seven', '', false, false).say, '');
  assert.equal(
    takeSpeech('Sure, here is what I found in your notes, and more', '', false, false).say,
    'Sure, here is what I found in your notes,',
  );
  assert.equal(takeSpeech('Sure, I can', '', false, false).say, '');
  // The first clip is short even when several sentences already arrived; the rest go together.
  const all = 'Sure thing. Here it is. Your list is open. I added three items.';
  const first = takeSpeech(all, '', false, false);
  assert.equal(first.say, 'Sure thing. Here it is.');
  assert.equal(
    takeSpeech(all, first.spoken, false, true).say,
    'Your list is open. I added three items.',
  );
  // A long first sentence starts at a clause break.
  const longFirst =
    'I looked through everything in your workspace, and the palette you liked is in Reports. More';
  assert.equal(
    takeSpeech(longFirst, '', false, false).say,
    'I looked through everything in your workspace,',
  );
});

test('a voice preview plays through the speaker only while idle, and Stop cancels it', async () => {
  const h = harness();
  let aborted = false;
  const playing = h.voice.preview('Hi.', async (_text, signal, consume) => {
    signal.addEventListener('abort', () => (aborted = true));
    await consume(new Float32Array(4).fill(0.1), 24000);
  });
  await tick();
  assert.deepEqual(h.types().slice(0, 2), ['stop-audio', 'pcm']);
  h.voice.played(0);
  assert.equal(await playing, true);

  const long = h.voice.preview(
    'Hi.',
    (_text, signal, consume) =>
      new Promise((_, reject) => {
        void consume(new Float32Array(4), 24000).catch(() => {});
        signal.addEventListener('abort', () => reject(new Error('stopped')));
      }),
  );
  await tick();
  // A second preview while one plays is refused; Stop ends the first.
  assert.equal(await h.voice.preview('Hi.', async () => {}), false);
  h.voice.stop();
  await assert.rejects(long);
  assert.equal(h.voice.phase, 'idle');
  assert.equal(aborted, false);

  // During a voice turn, no preview starts.
  h.voice.start('push-to-talk');
  assert.equal(await h.voice.preview('Hi.', async () => {}), false);
});

test('laughs and chuckles start their own utterance, with a cue just ahead of their audio', async () => {
  assert.deepEqual(cueSegments('Oh wow [laugh] that is funny.'), [
    { text: 'Oh wow', lead: null, trailing: null },
    { text: '[laugh] that is funny.', lead: 'laugh', trailing: null },
  ]);
  assert.deepEqual(cueSegments('[chuckle] Sure. [sigh] Fine.'), [
    { text: '[chuckle] Sure. [sigh] Fine.', lead: 'chuckle', trailing: null },
  ]);
  // Nothing to say after the tag: it ends the clip and plays near the end of that audio.
  assert.deepEqual(cueSegments('That worked [LAUGH]'), [
    { text: 'That worked [LAUGH]', lead: null, trailing: 'laugh' },
  ]);

  const h = harness();
  const spoken: string[] = [];
  const preview = h.voice.preview(
    'Hi, I am Edi. [chuckle] This is how I sound. Great [laugh]',
    async (text, _signal, consume) => {
      spoken.push(text);
      await consume(new Float32Array(4).fill(0.1), 24000);
    },
    true,
  );
  for (let i = 0; i < 2; i++) {
    await tick();
    h.voice.played(0);
  }
  assert.equal(await preview, true);
  assert.deepEqual(spoken, ['Hi, I am Edi.', '[chuckle] This is how I sound. Great [laugh]']);
  const events = h.sent
    .filter(event => event.type !== 'stop-audio')
    .map(event => (event.type === 'cue' ? `${event.cue}@${event.at}` : event.type));
  assert.deepEqual(events, ['pcm', 'chuckle@next', 'pcm', 'laugh@end']);

  // A voice without expressions speaks the clip as one, with no cues.
  const plain = harness();
  const once: string[] = [];
  const done = plain.voice.preview('Ha [laugh] okay.', async (text, _signal, consume) => {
    once.push(text);
    await consume(new Float32Array(4), 24000);
  });
  await tick();
  plain.voice.played(0);
  await done;
  assert.deepEqual(once, ['Ha [laugh] okay.']);
  assert.ok(!plain.types().includes('cue'));
});
