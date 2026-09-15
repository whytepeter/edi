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
import type { Transcriber } from '../../apps/desktop/src/main/voice/speech-io';
import {
  cueSegments,
  type AgentState,
  type VoiceHostEvent,
} from '../../packages/contracts/src/index';

const runtime = {
  transcription: { executable: 'whisper', model: 'model', vadModel: 'vad' },
  transcriptionServer: null,
  mlx: null,
};
const tick = () => new Promise(resolve => setImmediate(resolve));
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** A recognizer that answers with whatever `words` holds when asked. */
function fakeListener(words: () => string | Promise<string>) {
  const pushed: Uint8Array[] = [];
  let closed = 0;
  const listen = (): Transcriber => ({
    push: pcm => pushed.push(pcm),
    transcript: async () => words(),
    close: () => closed++,
  });
  return { listen, pushed, closed: () => closed };
}

const runningState: AgentState = {
  configured: true,
  conversationId: null,
  model: 'm',
  status: 'running',
  runId: 'run-1',
  prompt: 'What is this button?',
  note: '',
  text: '',
  error: '',
  steps: [],
  artifacts: [],
  messages: [],
  approval: null,
  screenAccess: 'granted',
};

function harness(overrides: Partial<VoiceDependencies<string>> = {}) {
  const sent: VoiceHostEvent[] = [];
  const statuses: VoiceStatus[] = [];
  const asked: { prompt: string; screens: string }[] = [];
  const captured: string[] = [];
  let stopped = 0;
  const reply: AgentState = {
    ...runningState,
    status: 'done',
    text: 'It is the **Save** button. [POINT:10,20:save]',
  };
  const listener = fakeListener(() => ' What is this button? ');
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
    listen: listener.listen,
    warmSpeech: () => {},
    speak: async (_text, _signal, consume) => {
      await consume(new Float32Array(4).fill(0.1), 24000);
    },
    ...overrides,
  };
  const voice = new VoiceController(deps);
  const types = () => sent.map(event => event.type);
  /** Answer every chunk the controller sends, like the pet's player. */
  const autoPlay = () => {
    const timer = setInterval(() => {
      const last = sent.at(-1);
      if (last?.type === 'pcm') voice.played(last.generation, last.turn);
    }, 1);
    return () => clearInterval(timer);
  };
  return {
    voice,
    sent,
    statuses,
    asked,
    captured,
    types,
    listener,
    autoPlay,
    stopped: () => stopped,
  };
}

/** Hold, get a live mic, speak, release. Returns the generation of the turn. */
async function holdAndSpeak(h: ReturnType<typeof harness>) {
  h.voice.start('push-to-talk');
  await tick(); // microphone permission
  const open = h.sent.find(event => event.type === 'open') as { generation: number };
  h.voice.clientEvent(open.generation, 'capture-ready');
  h.voice.pcm(open.generation, new Uint8Array(3200));
  h.voice.clientEvent(open.generation, 'speech-detected');
  h.voice.release();
  return open.generation;
}

/** Start a hands-free conversation with a live microphone. */
async function converse(h: ReturnType<typeof harness>) {
  h.voice.start('push-to-talk');
  assert.equal(h.voice.converse(), true);
  await tick();
  const open = h.sent.findLast(event => event.type === 'open') as {
    generation: number;
    mode: string;
  };
  assert.equal(open.mode, 'conversation');
  h.voice.clientEvent(open.generation, 'capture-ready');
  return open.generation;
}

test('hold-to-talk transcribes before deciding whether the prompt needs screens', async () => {
  const h = harness();
  const generation = await holdAndSpeak(h);
  assert.equal(h.voice.phase, 'processing');
  assert.ok(h.types().includes('finish'));

  assert.equal(h.listener.pushed.length, 1, 'microphone audio streamed while holding');
  h.voice.clientEvent(generation, 'captured');
  for (let i = 0; i < 6; i++) await tick();
  const pcm = h.sent.find(event => event.type === 'pcm');
  assert.ok(pcm && pcm.type === 'pcm', 'speech was streamed to the player');
  h.voice.played(generation, pcm.turn);
  await wait(5);

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
  h.voice.clientEvent(generation, 'captured');
  await wait(5);
  assert.deepEqual(h.statuses.at(-1), { notice: 'Set up OpenRouter first.' });
});

test('an empty transcript asks nothing and says it did not catch that', async () => {
  const h = harness({ listen: fakeListener(() => ' [BLANK_AUDIO] ').listen });
  const generation = await holdAndSpeak(h);
  h.voice.clientEvent(generation, 'captured');
  await wait(5);
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
  h.voice.clientEvent(generation, 'captured');
  await wait(5);
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
  h.voice.clientEvent(generation, 'captured');
  for (let i = 0; i < 6; i++) await tick();
  assert.equal(h.voice.phase, 'speaking');
  h.voice.stop();
  await tick();
  assert.equal(aborted, true);
  assert.ok(h.types().includes('stop-audio'));
  assert.ok(h.stopped() > 0);
  assert.equal(h.voice.phase, 'idle');
});

test('events from an older turn are ignored', async () => {
  const h = harness();
  const old = await holdAndSpeak(h);
  h.voice.start('push-to-talk'); // a new hold replaces the old turn
  h.voice.clientEvent(old, 'captured');
  await wait(5);
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
  h.voice.clientEvent(generation, 'captured');
  for (let i = 0; i < 6; i++) await tick();
  // The reply text is ready and handed to the voice, but no sound exists yet.
  assert.equal(h.statuses.includes('speaking'), false);
  assert.equal(h.voice.phase, 'processing');
  deliver();
  await tick();
  assert.ok(h.statuses.includes('speaking'));
  assert.equal(h.voice.phase, 'speaking');
  h.voice.stop();
});

test('speech starts on the first spoken sentence before the run ends', async () => {
  const spoken: string[] = [];
  let report: ((state: AgentState) => void) | undefined;
  let finish!: (state: AgentState) => void;
  const h = harness({
    whenFinished: (_runId, _signal, onUpdate) => {
      report = onUpdate;
      return new Promise(resolve => {
        finish = resolve;
      });
    },
    speak: async (text, _signal, consume) => {
      spoken.push(text);
      await consume(new Float32Array(4).fill(0.1), 24000);
    },
  });
  const stopPlaying = h.autoPlay();
  const generation = await holdAndSpeak(h);
  h.voice.clientEvent(generation, 'captured');
  await wait(5);
  report?.({ ...runningState, text: 'It is the Save button. ' });
  await wait(5);
  assert.deepEqual(spoken, ['It is the Save button.']);
  assert.ok(h.statuses.includes('speaking'));
  const finished: AgentState = {
    ...runningState,
    status: 'done',
    text: 'It is the Save button. I can also open it.',
  };
  report?.(finished);
  finish(finished);
  await wait(20);
  stopPlaying();
  assert.deepEqual(spoken, ['It is the Save button.', 'I can also open it.']);
  assert.equal(h.voice.phase, 'idle');
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
  h.voice.played(0, 0);
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
  assert.deepEqual(cueSegments('[chuckle] Sure. [cough] Fine.'), [
    { text: '[chuckle] Sure. [cough] Fine.', lead: 'chuckle', trailing: null },
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
    h.voice.played(0, 0);
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
  plain.voice.played(0, 0);
  await done;
  assert.deepEqual(once, ['Ha [laugh] okay.']);
  assert.ok(!plain.types().includes('cue'));
});

test('hands-free: a pause after unfinished words waits; a finished request is answered', async () => {
  let words = 'Can you um';
  const listener = fakeListener(() => words);
  const h = harness({ listen: listener.listen });
  const stopPlaying = h.autoPlay();
  const generation = await converse(h);
  h.voice.clientEvent(generation, 'speech-detected');
  h.voice.pcm(generation, new Uint8Array(3200));
  h.voice.clientEvent(generation, 'pause');
  await wait(5);
  assert.equal(h.asked.length, 0, '"Can you um" is not the end of a turn');
  assert.equal(h.voice.phase, 'listening');

  h.voice.clientEvent(generation, 'speech-detected');
  words = 'Can you um check my calendar tomorrow?';
  h.voice.clientEvent(generation, 'pause');
  await wait(20);
  stopPlaying();
  assert.deepEqual(
    h.asked.map(item => item.prompt),
    ['Can you um check my calendar tomorrow?'],
  );
  assert.ok(h.types().includes('utterance-done'));
  assert.equal(h.voice.mode, 'conversation');
  assert.equal(h.voice.phase, 'listening', 'still listening after the reply');
  assert.equal(h.voice.wantsMicrophone, true);
});

test('hands-free: speech resuming while a pause is checked keeps the turn open', async () => {
  let release!: (words: string) => void;
  const listener = fakeListener(
    () =>
      new Promise<string>(resolve => {
        release = resolve;
      }),
  );
  const h = harness({ listen: listener.listen });
  const generation = await converse(h);
  h.voice.clientEvent(generation, 'speech-detected');
  h.voice.clientEvent(generation, 'pause');
  await tick();
  h.voice.clientEvent(generation, 'speech-detected'); // they carried on
  release('Check my emails.');
  await wait(5);
  assert.equal(h.asked.length, 0);
});

test('hands-free: a long pause ends the turn even on a trailing word', async () => {
  const h = harness({ listen: fakeListener(() => 'Remind me to call mum and').listen });
  const stopPlaying = h.autoPlay();
  const generation = await converse(h);
  h.voice.clientEvent(generation, 'speech-detected');
  h.voice.clientEvent(generation, 'pause');
  await wait(5);
  assert.equal(h.asked.length, 0);
  h.voice.clientEvent(generation, 'long-pause');
  await wait(10);
  stopPlaying();
  assert.equal(h.asked.length, 1);
});

test('talking over Edi pauses her; words stop the reply and the work, then ask again', async () => {
  let words = 'Check my emails from today.';
  const runs: AbortSignal[] = [];
  const h = harness({
    listen: fakeListener(() => words).listen,
    whenFinished: (_runId, signal) => {
      runs.push(signal);
      return new Promise((_, reject) =>
        signal.addEventListener('abort', () => reject(new Error('Stopped'))),
      );
    },
  });
  const generation = await converse(h);
  h.voice.clientEvent(generation, 'speech-detected');
  h.voice.clientEvent(generation, 'pause');
  await wait(5);
  assert.equal(h.voice.phase, 'processing');

  // A tool is still running when the person changes their mind.
  h.voice.clientEvent(generation, 'speech-detected');
  assert.ok(h.types().includes('pause-audio'));
  assert.equal(h.statuses.at(-1), 'listening');
  words = 'Actually, only emails from Sarah.';
  const stoppedBefore = h.stopped();
  h.voice.clientEvent(generation, 'pause');
  await wait(5);
  assert.equal(runs[0]?.aborted, true, 'the first request was cancelled');
  assert.ok(h.stopped() > stoppedBefore, 'the agent was stopped');
  assert.ok(h.types().includes('stop-audio'));
  assert.deepEqual(
    h.asked.map(item => item.prompt),
    ['Check my emails from today.', 'Actually, only emails from Sarah.'],
  );
  assert.equal(h.voice.phase, 'processing');
  h.voice.stop();
});

test('noise over Edi resumes her reply without cancelling anything', async () => {
  let words = 'What time is it?';
  let finish!: (state: AgentState) => void;
  const h = harness({
    listen: fakeListener(() => words).listen,
    whenFinished: () => new Promise(resolve => (finish = resolve)),
  });
  const generation = await converse(h);
  h.voice.clientEvent(generation, 'speech-detected');
  h.voice.clientEvent(generation, 'pause');
  await wait(5);
  h.voice.clientEvent(generation, 'speech-detected');
  words = '';
  h.voice.clientEvent(generation, 'long-pause');
  await wait(5);
  assert.ok(h.types().includes('resume-audio'));
  assert.equal(h.asked.length, 1);
  assert.equal(h.voice.phase, 'processing');
  finish({ ...runningState, status: 'done', text: 'It is noon.' });
  h.voice.stop();
});

test('a tool starting without an acknowledgement gets a short spoken one first', async () => {
  const spoken: string[] = [];
  let report!: (state: AgentState) => void;
  let finish!: (state: AgentState) => void;
  const h = harness({
    whenFinished: (_runId, _signal, onUpdate) => {
      report = onUpdate!;
      return new Promise(resolve => (finish = resolve));
    },
    speak: async (text, _signal, consume) => {
      spoken.push(text);
      await consume(new Float32Array(4).fill(0.1), 24000);
    },
    timing: { stepQuietMs: 30, stillQuietMs: 10_000, tickMs: 5 },
  });
  const stopPlaying = h.autoPlay();
  const generation = await holdAndSpeak(h);
  h.voice.clientEvent(generation, 'captured');
  await wait(5);
  const step = {
    callId: '00000000-0000-4000-8000-000000000001',
    capability: 'calendar.events',
    title: 'Calendar events',
    status: 'running' as const,
    summary: '',
  };
  report({ ...runningState, steps: [step] });
  await wait(5);
  assert.equal(spoken.length, 1);
  assert.match(spoken[0] ?? '', /check|look/i);
  // Still quiet while the tool runs: say what is happening, once.
  await wait(80);
  assert.deepEqual(spoken.slice(1), ['Checking your calendar.']);
  const done = { ...runningState, status: 'done' as const, text: 'You have two meetings.' };
  report(done);
  finish(done);
  await wait(20);
  stopPlaying();
  assert.deepEqual(spoken.at(-1), 'You have two meetings.');
});

test('words the model writes before a tool are spoken before the tool finishes', async () => {
  const spoken: string[] = [];
  let report!: (state: AgentState) => void;
  const h = harness({
    whenFinished: (_runId, signal, onUpdate) => {
      report = onUpdate!;
      return new Promise((_, reject) =>
        signal.addEventListener('abort', () => reject(new Error('Stopped'))),
      );
    },
    speak: async (text, _signal, consume) => {
      spoken.push(text);
      await consume(new Float32Array(4).fill(0.1), 24000);
    },
  });
  const stopPlaying = h.autoPlay();
  const generation = await holdAndSpeak(h);
  h.voice.clientEvent(generation, 'captured');
  await wait(5);
  report({ ...runningState, text: 'Sure' });
  await wait(5);
  assert.deepEqual(spoken, [], 'half a word is not spoken');
  report({
    ...runningState,
    text: 'Sure, checking',
    steps: [
      {
        callId: '00000000-0000-4000-8000-000000000002',
        capability: 'mcp_gmail.fetch',
        title: 'Gmail: Fetch emails',
        status: 'running',
        summary: '',
      },
    ],
  });
  await wait(5);
  stopPlaying();
  assert.deepEqual(spoken, ['Sure, checking']);
  h.voice.stop();
});

test('a streaming voice gets the whole reply; if it fails before any sound, clips take over', async () => {
  const streamed: string[] = [];
  const clips: string[] = [];
  const h = harness({
    speechStream: (_signal, consume) => ({
      say: text => {
        streamed.push(text);
        void consume(new Float32Array(4).fill(0.1), 24000);
      },
      failed: false,
      end: async () => {},
    }),
    speak: async text => {
      clips.push(text);
    },
    whenFinished: async () => ({
      ...runningState,
      status: 'done',
      text: 'First sentence here. Second one.',
    }),
  });
  const stopPlaying = h.autoPlay();
  const generation = await holdAndSpeak(h);
  h.voice.clientEvent(generation, 'captured');
  await wait(20);
  assert.deepEqual(streamed, ['First sentence here. Second one.']);
  assert.deepEqual(clips, []);

  const broken = harness({
    speechStream: () => ({
      say: () => {},
      failed: true,
      end: async () => {
        throw new Error('Cartesia could not be reached.');
      },
    }),
    speak: async (text, _signal, consume) => {
      clips.push(text);
      await consume(new Float32Array(4).fill(0.1), 24000);
    },
    whenFinished: async () => ({ ...runningState, status: 'done', text: 'Hello there, friend.' }),
  });
  const stopBroken = broken.autoPlay();
  const second = await holdAndSpeak(broken);
  broken.voice.clientEvent(second, 'captured');
  await wait(20);
  stopPlaying();
  stopBroken();
  assert.deepEqual(clips, ['Hello there, friend.']);
  assert.equal(broken.voice.phase, 'idle');
});

test('a quick tap after speech is not a conversation; hands-free ends after a quiet spell', async () => {
  const h = harness({ timing: { idleMs: 20 } });
  h.voice.start('push-to-talk');
  await tick();
  const open = h.sent.find(event => event.type === 'open') as { generation: number };
  h.voice.clientEvent(open.generation, 'capture-ready');
  h.voice.clientEvent(open.generation, 'speech-detected');
  assert.equal(h.voice.converse(), false);
  h.voice.stop();

  const generation = await converse(h);
  assert.equal(h.voice.phase, 'listening');
  await wait(40);
  assert.equal(h.voice.phase, 'idle');
  assert.equal(h.voice.wantsMicrophone, false);
  assert.ok(h.sent.some(event => event.type === 'cancel' && event.generation === generation));
});

test('an answer after a long tool is still spoken when the first stream was closed meanwhile', async () => {
  // Recorded run 0499a0e8: Cartesia voiced "On it. Let me check…" (47 characters), the connection
  // closed during 50 s of tools, and the answer was never heard.
  const streams: { said: string[]; failed: boolean; ended: boolean }[] = [];
  let report!: (state: AgentState) => void;
  let finish!: (state: AgentState) => void;
  const h = harness({
    speechStream: (_signal, consume) => {
      const record = { said: [] as string[], failed: false, ended: false };
      streams.push(record);
      return {
        say: text => {
          if (record.failed) return;
          record.said.push(text);
          void consume(new Float32Array(240).fill(0.1), 24000).catch(() => {});
        },
        get failed() {
          return record.failed;
        },
        end: async () => {
          record.ended = true;
          if (record.failed) throw new Error('Cartesia closed the connection.');
        },
      };
    },
    whenFinished: (_runId, _signal, onUpdate) => {
      report = onUpdate!;
      return new Promise(resolve => (finish = resolve));
    },
    timing: { stepQuietMs: 10_000, stillQuietMs: 60_000, tickMs: 5 },
  });
  const stopPlaying = h.autoPlay();
  const generation = await holdAndSpeak(h);
  h.voice.clientEvent(generation, 'captured');
  await wait(5);
  const step = {
    callId: '00000000-0000-4000-8000-000000000003',
    capability: 'calendar.events',
    title: 'Check the calendar',
    status: 'running' as const,
    summary: '',
  };
  report({
    ...runningState,
    text: 'On it. Let me check your schedule and reminders.',
    steps: [step],
  });
  await wait(20);
  assert.deepEqual(streams[0]?.said, ['On it. Let me check your schedule and reminders.']);
  assert.equal(streams[0]?.ended, true, 'the burst closes while the tool runs');
  // The acknowledgement finished playing: after a short silence the bubble goes back to thinking.
  await wait(450);
  assert.equal(h.voice.phase, 'processing');
  assert.equal(h.statuses.at(-1), 'thinking');
  streams[0]!.failed = true; // the provider dropped the idle connection

  const answer =
    'On it. Let me check your schedule and reminders.\n\n[MOOD:happy] You have two meetings today.';
  const done = {
    ...runningState,
    status: 'done' as const,
    text: answer,
    steps: [{ ...step, status: 'succeeded' as const }],
  };
  report(done);
  finish(done);
  await wait(40);
  stopPlaying();
  assert.equal(streams.length, 2, 'a fresh stream for the answer');
  assert.deepEqual(streams[1]?.said, ['You have two meetings today.']);
  assert.equal(h.voice.phase, 'idle');
});
