import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cartesiaTranscriber,
  streamCartesiaSpeech,
  type SocketLike,
} from '../../apps/desktop/src/main/voice/cartesia-realtime';
import { localTranscriber } from '../../apps/desktop/src/main/voice/transcription-server';

const tick = () => new Promise(resolve => setImmediate(resolve));

class FakeSocket implements SocketLike {
  readyState = 0;
  binaryType = 'blob';
  sent: (string | Uint8Array)[] = [];
  closed = false;
  private listeners = new Map<string, ((event: { data: unknown }) => void)[]>();

  constructor(
    readonly url: string,
    readonly headers: Record<string, string>,
  ) {}

  addEventListener(type: string, listener: (event: { data: unknown }) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  send(data: string | ArrayBufferView | ArrayBuffer) {
    this.sent.push(typeof data === 'string' ? data : new Uint8Array(data as ArrayBuffer));
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.readyState = 3;
    this.emit('close');
  }
  open() {
    this.readyState = 1;
    this.emit('open');
  }
  message(value: unknown) {
    this.emit('message', JSON.stringify(value));
  }
  emit(type: string, data?: unknown) {
    for (const listener of this.listeners.get(type) ?? []) listener({ data });
  }
  json() {
    return this.sent
      .filter(item => typeof item === 'string')
      .map(item => JSON.parse(item as string));
  }
}

function factory() {
  const sockets: FakeSocket[] = [];
  return {
    sockets,
    socket: (url: string, headers: Record<string, string>) => {
      const socket = new FakeSocket(url, headers);
      sockets.push(socket);
      return socket;
    },
  };
}

const pcmChunk = (samples: number) =>
  Buffer.from(new Int16Array(samples).fill(16384).buffer).toString('base64');

test('a streamed reply sends sentences as they come, in one context, and plays the audio', async () => {
  const f = factory();
  const frames: Float32Array[] = [];
  const stream = streamCartesiaSpeech(
    'key-123',
    'voice_1',
    new AbortController().signal,
    async pcm => {
      frames.push(pcm);
    },
    { socket: f.socket },
  );
  const socket = f.sockets[0]!;
  // The key travels as a header, never in the address.
  assert.equal(socket.headers['X-API-Key'], 'key-123');
  assert.ok(!socket.url.includes('key-123'));
  stream.say('Sure, checking.');
  assert.equal(socket.sent.length, 0, 'queued until the socket opens');
  socket.open();
  stream.say('You have two meetings.');
  const [first, second] = socket.json();
  assert.equal(first.transcript, 'Sure, checking. ');
  assert.equal(first.continue, true);
  assert.equal(first.context_id, second.context_id);
  assert.deepEqual(first.voice, { mode: 'id', id: 'voice_1' });

  const ending = stream.end();
  assert.equal(socket.json().at(-1).continue, false);
  socket.message({ type: 'chunk', context_id: first.context_id, data: pcmChunk(36_000) });
  socket.message({ type: 'done', context_id: first.context_id });
  await ending;
  // 36,000 samples become one full second and a half-second frame.
  assert.deepEqual(
    frames.map(frame => frame.length),
    [24_000, 12_000],
  );
  assert.ok(Math.abs((frames[0]?.[0] ?? 0) - 0.5) < 1e-6);
  assert.equal(stream.characters, 'Sure, checking.'.length + 'You have two meetings.'.length);
  assert.equal(socket.closed, true);
});

test('stopping a streamed reply cancels its context; a provider error fails it', async () => {
  const f = factory();
  const abort = new AbortController();
  const stream = streamCartesiaSpeech('k', 'v', abort.signal, async () => {}, { socket: f.socket });
  f.sockets[0]!.open();
  stream.say('Hello there.');
  const ending = stream.end();
  abort.abort();
  await assert.rejects(ending);
  assert.equal(f.sockets[0]!.json().at(-1).cancel, true);
  assert.equal(stream.failed, false, 'a stop is not a failure');

  const broken = streamCartesiaSpeech('k', 'v', new AbortController().signal, async () => {}, {
    socket: f.socket,
  });
  f.sockets[1]!.open();
  broken.say('Hello.');
  f.sockets[1]!.message({ type: 'error', status_code: 401 });
  assert.equal(broken.failed, true);
  await assert.rejects(broken.end(), /rejected the key/);
});

test('realtime recognition returns the words so far at each pause', async () => {
  const f = factory();
  const transcriber = cartesiaTranscriber('k', async () => 'local words', { socket: f.socket });
  const socket = f.sockets[0]!;
  assert.match(socket.url, /model=ink-2&encoding=pcm_s16le&sample_rate=16000/);
  transcriber.push(new Uint8Array(3200));
  socket.open();
  assert.equal(socket.sent.length, 1, 'audio sent once connected');
  const words = transcriber.transcript();
  await tick();
  assert.equal(socket.sent.at(-1), 'finalize');
  socket.message({ type: 'transcript', is_final: true, text: 'Check my ' });
  socket.message({ type: 'transcript', is_final: false, text: 'emai' });
  socket.message({ type: 'transcript', is_final: true, text: 'emails.' });
  socket.message({ type: 'flush_done' });
  assert.equal(await words, 'Check my emails.');
  // Nothing new since: no second finalize.
  assert.equal(await transcriber.transcript(), 'Check my emails.');
  assert.equal(socket.sent.filter(item => item === 'finalize').length, 1);
  transcriber.close();
  assert.equal(socket.closed, true);
});

test('if Cartesia recognition fails, the same audio is transcribed on this Mac', async () => {
  const f = factory();
  let heardBytes = 0;
  const transcriber = cartesiaTranscriber(
    'k',
    async pcm => {
      heardBytes = pcm.byteLength;
      return 'check my calendar';
    },
    { socket: f.socket },
  );
  transcriber.push(new Uint8Array(16_000));
  f.sockets[0]!.emit('error');
  assert.equal(await transcriber.transcript(), 'check my calendar');
  assert.equal(heardBytes, 16_000);
});

test('local recognition re-reads only when new audio arrived and skips a blip', async () => {
  let runs = 0;
  const transcriber = localTranscriber(async pcm => {
    runs++;
    return `${pcm.byteLength} bytes`;
  });
  transcriber.push(new Uint8Array(1000));
  assert.equal(await transcriber.transcript(), '', 'too short to be words');
  assert.equal(runs, 0);
  transcriber.push(new Uint8Array(16_000));
  assert.equal(await transcriber.transcript(), '17000 bytes');
  assert.equal(await transcriber.transcript(), '17000 bytes');
  assert.equal(runs, 1);
  transcriber.push(new Uint8Array(2000));
  assert.equal(await transcriber.transcript(), '19000 bytes');
  assert.equal(runs, 2);
});
