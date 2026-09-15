import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  SpeechActivity,
  type SpeechActivityEvent,
} from '../../packages/contracts/src/voice-turns';
import {
  SileroVad,
  SpeechDetector,
  type Heard,
} from '../../apps/desktop/src/main/voice/speech-detector';

/**
 * Hands-free listening in a real room: steady noise must not drown the person out, and other
 * people talking must not start turns or keep one going once their level is known.
 */

/** [rms, voice, frames] runs of 20 ms frames; returns events with their frame index. */
function run(activity: SpeechActivity, plan: [number, boolean, number][]) {
  const events: [number, SpeechActivityEvent][] = [];
  let index = 0;
  for (const [rms, voice, count] of plan)
    for (let i = 0; i < count; i++, index++)
      for (const event of activity.frame(rms, 20, false, voice)) events.push([index, event]);
  return events;
}

test('steady noise that is not a voice no longer drowns out the person', () => {
  // A fan at 0.03, then the person at 0.07 over it: loud enough to hear, not 3× the fan.
  const plan: [number, boolean, number][] = [
    [0.03, false, 100],
    [0.07, true, 50],
    [0.03, false, 100],
  ];
  const withVoices = run(new SpeechActivity({ voiceDetector: true }), plan);
  assert.deepEqual(
    withVoices.map(([, event]) => event),
    ['speech', 'pause', 'long-pause'],
  );
  // Loudness alone (no voice detector) still needs 3× the room, as before.
  assert.deepEqual(run(new SpeechActivity(), plan), []);
});

test('talk the room keeps up sets the bar: it starts no turn, the person up close does', () => {
  const activity = new SpeechActivity({ voiceDetector: true });
  // A TV across the room comes up to 0.02 over 4 s, as the room is heard (the bar learns over ~1 s).
  const ramp: [number, boolean, number][] = Array.from({ length: 40 }, (_, i) => [
    0.002 + (0.018 * (i + 1)) / 40,
    true,
    5,
  ]);
  const events = run(activity, [
    [0.002, false, 25],
    ...ramp,
    [0.02, true, 250], // and keeps talking for 5 s
    [0.08, true, 60], // the person speaks, up close, over it
    [0.02, true, 60], // and stops while the TV goes on
  ]);
  assert.deepEqual(
    events.map(([, event]) => event),
    ['speech', 'pause'],
    'one turn, the person’s, which pauses when they stop',
  );
  const start = 25 + 200 + 250;
  assert.ok(events[0]![0] >= start && events[0]![0] <= start + 15);
  assert.ok(events[1]![0] <= start + 60 + 35, 'the pause comes about 600 ms after they stop');
});

test('Silero itself: a request over a loud fan is heard and answered', async () => {
  const RATE = 16_000;
  const wav = readFileSync(resolve('tests/fixtures/speech-16k.wav'));
  const data = wav.subarray(wav.indexOf(Buffer.from('data')) + 8);
  const speech = new Float32Array(Math.floor(data.byteLength / 2)).map(
    (_, i) => data.readInt16LE(i * 2) / 32768,
  );
  const scale = (x: Float32Array, rms: number) => {
    const now = Math.sqrt(x.reduce((sum, v) => sum + v * v, 0) / x.length) || 1;
    return x.map(v => (v * rms) / now);
  };
  let seed = 5;
  let last = 0;
  const fan = scale(
    new Float32Array(8 * RATE).map(() => {
      seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31;
      return (last = 0.98 * last + 0.02 * ((seed / 2 ** 31) * 2 - 1));
    }),
    0.03,
  );
  const near = scale(speech, 0.06);
  near.forEach((v, i) => (fan[2 * RATE + i]! += v));

  const vad = await SileroVad.load(resolve('apps/desktop/voice/silero_vad.onnx'));
  const detector = new SpeechDetector(vad.stream());
  const pcm = new Uint8Array(fan.length * 2);
  const view = new DataView(pcm.buffer);
  fan.forEach((v, i) =>
    view.setInt16(i * 2, Math.round(Math.max(-1, Math.min(1, v)) * 32767), true),
  );
  const events: { event: string; at: number }[] = [];
  for (let offset = 0; offset < pcm.byteLength; offset += 3200)
    for (const item of (await detector.push(pcm.subarray(offset, offset + 3200), false)) as Heard[])
      if ('event' in item) events.push({ event: item.event, at: offset / 2 / RATE });

  const end = 2 + speech.length / RATE;
  assert.ok(
    events[0]?.event === 'speech' && events[0].at >= 1.9 && events[0].at <= 3,
    JSON.stringify(events),
  );
  assert.ok(
    events.some(e => e.event === 'pause' && e.at >= end && e.at <= end + 1.6),
    JSON.stringify(events),
  );
});
