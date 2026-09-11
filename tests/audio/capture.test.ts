import test from 'node:test';
import assert from 'node:assert/strict';
import {
  openMicrophone,
  type CaptureDependencies,
} from '../../apps/desktop/src/renderer/src/features/voice/MicrophoneCapture';

function fixture() {
  const track = new EventTarget() as EventTarget & { readyState: string; stop(): void };
  track.readyState = 'live';
  track.stop = () => {
    track.readyState = 'ended';
  };
  const stream = {
    getTracks: () => [track],
    getAudioTracks: () => [track],
  } as unknown as MediaStream;
  const recorder = {
    state: 'inactive',
    mimeType: 'audio/webm;codecs=opus',
    onstart: null as null | (() => void),
    onstop: null as null | (() => void),
    onerror: null as null | (() => void),
    ondataavailable: null as null | ((event: { data: Blob }) => void),
    start() {
      this.state = 'recording';
      queueMicrotask(() => this.onstart?.());
    },
    stop() {
      this.state = 'inactive';
      queueMicrotask(() => {
        this.ondataavailable?.({ data: new Blob(['final']) });
        this.onstop?.();
      });
    },
  };
  const deps: CaptureDependencies = {
    getUserMedia: async () => stream,
    createRecorder: () => recorder as unknown as MediaRecorder,
  };
  return { track, stream, recorder, deps };
}
test('finish releases hardware immediately and includes the final encoder chunk once', async () => {
  const f = fixture();
  const turn = await openMicrophone(new AbortController().signal, f.deps);
  f.recorder.ondataavailable?.({ data: new Blob(['first']) });
  turn.finish();
  turn.finish();
  assert.equal(f.track.readyState, 'ended');
  assert.equal(await (await turn.result)!.text(), 'firstfinal');
});
test('cancel discards audio and stops all tracks', async () => {
  const f = fixture();
  const controller = new AbortController();
  const turn = await openMicrophone(controller.signal, f.deps);
  f.recorder.ondataavailable?.({ data: new Blob(['private audio']) });
  controller.abort();
  assert.equal(await turn.result, null);
  assert.equal(f.track.readyState, 'ended');
});
test('late permission after cancellation cannot leak a live microphone', async () => {
  const f = fixture();
  let grant!: (stream: MediaStream) => void;
  f.deps.getUserMedia = () =>
    new Promise(resolve => {
      grant = resolve;
    });
  const controller = new AbortController();
  const opening = openMicrophone(controller.signal, f.deps);
  await Promise.resolve();
  controller.abort();
  await assert.rejects(opening, { name: 'AbortError' });
  grant(f.stream);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.track.readyState, 'ended');
});
test('permission denial and unsupported recording fail without retained tracks', async () => {
  const denied = fixture();
  denied.deps.getUserMedia = async () => {
    throw new DOMException('Denied', 'NotAllowedError');
  };
  await assert.rejects(openMicrophone(new AbortController().signal, denied.deps), {
    name: 'NotAllowedError',
  });
  const unsupported = fixture();
  unsupported.deps.createRecorder = () => {
    throw new Error('Unsupported');
  };
  await assert.rejects(openMicrophone(new AbortController().signal, unsupported.deps));
  assert.equal(unsupported.track.readyState, 'ended');
});
test('size overflow and device disconnection discard and release capture', async () => {
  for (const mode of ['size', 'device']) {
    const f = fixture();
    const turn = await openMicrophone(new AbortController().signal, f.deps);
    if (mode === 'size')
      f.recorder.ondataavailable?.({ data: new Blob([new Uint8Array(8 * 1024 * 1024 + 1)]) });
    else f.track.dispatchEvent(new Event('ended'));
    await assert.rejects(turn.result);
    assert.equal(f.track.readyState, 'ended');
  }
});
