import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  SileroVad,
  SpeechDetector,
  type Heard,
  type VoiceProbability,
} from '../../apps/desktop/src/main/voice/speech-detector';

/** 16 kHz PCM16 of `seconds` at a steady level (a tone stands in for loudness). */
function tone(seconds: number, level: number) {
  const pcm = new Uint8Array(Math.round(seconds * 16_000) * 2);
  const view = new DataView(pcm.buffer);
  for (let i = 0; i < pcm.byteLength / 2; i++)
    view.setInt16(i * 2, Math.round(Math.sin(i / 3) * level * 32767), true);
  return pcm;
}

/** A voice model whose verdict the test controls. */
function fakeVoice(isVoice: () => boolean): VoiceProbability {
  return { next: async () => (isVoice() ? 0.9 : 0.05) };
}

const events = (heard: Heard[]) => heard.flatMap(item => ('event' in item ? [item.event] : []));
const audioBytes = (heard: Heard[]) =>
  heard.reduce((total, item) => total + ('audio' in item ? item.audio.byteLength : 0), 0);

async function feed(detector: SpeechDetector, parts: [Uint8Array, boolean?][]) {
  const heard: Heard[] = [];
  // In chunks of five 20 ms frames, like the pet sends.
  for (const [pcm, speaking = false] of parts)
    for (let offset = 0; offset < pcm.byteLength; offset += 3200)
      heard.push(...(await detector.push(pcm.subarray(offset, offset + 3200), speaking)));
  return heard;
}

test('loud sound that is not a voice never starts a turn', async () => {
  const detector = new SpeechDetector(fakeVoice(() => false));
  const heard = await feed(detector, [[tone(1, 0.001)], [tone(1.5, 0.3)], [tone(1, 0.001)]]);
  assert.deepEqual(events(heard), []);
  assert.equal(audioBytes(heard), 0, 'nothing reaches the recognizer');
});

test('a voice starts a turn, with the moment before it, and its pauses are reported', async () => {
  let voice = false;
  const detector = new SpeechDetector(fakeVoice(() => voice));
  const quiet = await feed(detector, [[tone(1, 0.001)]]);
  voice = true;
  const speech = await feed(detector, [[tone(1, 0.2)]]);
  voice = false;
  const after = await feed(detector, [[tone(2.2, 0.001)]]);
  assert.deepEqual(events([...quiet, ...speech, ...after]), ['speech', 'pause', 'long-pause']);
  // Speech, plus up to 400 ms before it and the silence after it until the turn is handed off.
  assert.ok(audioBytes(speech) >= 32_000);
  assert.ok(audioBytes(speech) <= 32_000 + 12_800);
  detector.finishUtterance();
  assert.equal(audioBytes(await feed(detector, [[tone(0.5, 0.001)]])), 0);
});

test('without a voice model, loudness alone decides, as before', async () => {
  const detector = new SpeechDetector(null);
  const heard = await feed(detector, [[tone(1, 0.001)], [tone(1, 0.2)], [tone(0.8, 0.001)]]);
  assert.deepEqual(events(heard), ['speech', 'pause']);
});

test('while Edi speaks, a quieter voice (her echo) does not count', async () => {
  const detector = new SpeechDetector(fakeVoice(() => true));
  const heard = await feed(detector, [[tone(1, 0.001)], [tone(1, 0.025), true]]);
  assert.deepEqual(events(heard), []);
});

test('Silero itself: loud noise is ignored, a spoken request is heard', async () => {
  const vad = await SileroVad.load(resolve('apps/desktop/voice/silero_vad.onnx'));
  const wav = readFileSync(resolve('tests/fixtures/speech-16k.wav'));
  const speech = new Uint8Array(wav.subarray(wav.indexOf(Buffer.from('data')) + 8));
  const noise = new Uint8Array(speech.byteLength);
  const view = new DataView(noise.buffer);
  let seed = 7;
  for (let i = 0; i < noise.byteLength / 2; i++) {
    seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31;
    view.setInt16(i * 2, Math.round((seed / 2 ** 31 - 0.5) * 12_000), true);
  }
  const quiet = tone(1, 0.001);

  const noisy = await feed(new SpeechDetector(vad.stream()), [[quiet], [noise], [quiet]]);
  assert.deepEqual(events(noisy), [], 'white noise, louder than the speech, is not a voice');

  const spoken = await feed(new SpeechDetector(vad.stream()), [
    [quiet],
    [speech],
    [quiet],
    [quiet],
  ]);
  assert.deepEqual(events(spoken), ['speech', 'pause', 'long-pause']);
  assert.ok(audioBytes(spoken) >= speech.byteLength * 0.8, 'the request reaches the recognizer');
});
