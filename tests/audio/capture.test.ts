import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FRAME_SAMPLES,
  openPcmCapture,
  Resampler,
  type PcmCaptureDependencies,
} from '../../apps/desktop/src/renderer/src/features/voice/PcmCapture';

function fixture(sampleRate = 48_000) {
  const track = new EventTarget() as EventTarget & { readyState: string; stop(): void };
  track.readyState = 'live';
  track.stop = () => {
    track.readyState = 'ended';
  };
  const stream = {
    getTracks: () => [track],
    getAudioTracks: () => [track],
  } as unknown as MediaStream;
  const processor = {
    onaudioprocess: null as
      null | ((event: { inputBuffer: { getChannelData(): Float32Array } }) => void),
    connect() {},
    disconnect() {},
  };
  const node = { connect() {}, disconnect() {}, gain: { value: 1 } };
  const context = {
    sampleRate,
    state: 'running',
    destination: {},
    resume: async () => {},
    close: async () => {
      context.state = 'closed';
    },
    createMediaStreamSource: () => node,
    createScriptProcessor: () => processor,
    createGain: () => node,
  };
  const deps: PcmCaptureDependencies = {
    getUserMedia: async () => stream,
    createContext: () => context as unknown as AudioContext,
  };
  const feed = (samples: Float32Array) =>
    processor.onaudioprocess?.({ inputBuffer: { getChannelData: () => samples } });
  return { track, context, processor, deps, feed };
}

test('48 kHz input becomes 20 ms PCM16 frames at 16 kHz with their loudness', async () => {
  const f = fixture();
  const frames: { pcm: Int16Array; rms: number }[] = [];
  const capture = await openPcmCapture(
    new AbortController().signal,
    (pcm, rms) => frames.push({ pcm: pcm.slice(), rms }),
    () => {},
    f.deps,
  );
  f.feed(new Float32Array(1024).fill(0.5));
  f.feed(new Float32Array(1024).fill(0.5));
  // 2048 input samples at 48 kHz = 682 output samples = two whole frames.
  assert.equal(frames.length, 2);
  assert.equal(frames[0]?.pcm.length, FRAME_SAMPLES);
  assert.ok(Math.abs((frames[1]?.rms ?? 0) - 0.5) < 0.01);
  assert.equal(frames[1]?.pcm[100], Math.round(0.5 * 32767));
  capture.stop();
  assert.equal(f.track.readyState, 'ended');
  assert.equal(f.context.state, 'closed');
  f.feed(new Float32Array(4096).fill(0.5));
  assert.equal(frames.length, 2, 'nothing after stop');
});

test('the resampler keeps its place across buffers of odd sizes', () => {
  const resampler = new Resampler(44_100);
  let samples = 0;
  for (let i = 0; i < 100; i++)
    resampler.push(new Float32Array(441 + (i % 3)), pcm => (samples += pcm.length));
  // 44,201 input samples at 44.1 kHz ≈ 16,036 samples at 16 kHz, emitted in whole frames.
  assert.ok(Math.abs(samples - 16_036) <= FRAME_SAMPLES);
});

test('cancel before permission resolves cannot leak a live microphone', async () => {
  const f = fixture();
  let grant!: (stream: MediaStream) => void;
  const stream = await f.deps.getUserMedia({});
  f.deps.getUserMedia = () =>
    new Promise(resolve => {
      grant = resolve;
    });
  const controller = new AbortController();
  const opening = openPcmCapture(
    controller.signal,
    () => {},
    () => {},
    f.deps,
  );
  await Promise.resolve();
  controller.abort();
  await assert.rejects(opening, { name: 'AbortError' });
  grant(stream);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.track.readyState, 'ended');
});

test('permission denial fails cleanly; a lost device releases capture and says so', async () => {
  const denied = fixture();
  denied.deps.getUserMedia = async () => {
    throw new DOMException('Denied', 'NotAllowedError');
  };
  await assert.rejects(
    openPcmCapture(
      new AbortController().signal,
      () => {},
      () => {},
      denied.deps,
    ),
    { name: 'NotAllowedError' },
  );

  const f = fixture();
  let lost = 0;
  await openPcmCapture(
    new AbortController().signal,
    () => {},
    () => lost++,
    f.deps,
  );
  f.track.dispatchEvent(new Event('ended'));
  assert.equal(lost, 1);
  assert.equal(f.context.state, 'closed');
  assert.equal(f.processor.onaudioprocess, null);
});
