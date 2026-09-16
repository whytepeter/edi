import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VoicePacks, type VoicePack } from '../../apps/desktop/src/main/voice/voice-packs';

const content = randomBytes(100_000);
const pack = (bytes = content): VoicePack => ({
  id: 'listening',
  name: 'Listening model',
  files: [
    {
      path: 'whisper/ggml-small.en.bin',
      url: 'https://models.example/ggml-small.en.bin',
      bytes: bytes.byteLength,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    },
  ],
});

/**
 * A model host that honours Range, sends 10 kB at a time, and can be told to stall so a test
 * pauses mid-download. `requests` records each Range asked for.
 */
function host(options: { body?: Buffer; ignoreRange?: boolean; status?: number } = {}) {
  const body = options.body ?? content;
  const requests: (string | null)[] = [];
  let stallAfter = Infinity;
  const fetch = (async (_url: string, init: RequestInit = {}) => {
    const range = new Headers(init.headers).get('range');
    requests.push(range);
    if (options.status) return new Response('no', { status: options.status });
    const start = range && !options.ignoreRange ? Number(/bytes=(\d+)-/.exec(range)?.[1]) : 0;
    let offset = start;
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        init.signal?.addEventListener('abort', () =>
          controller.error(new DOMException('Aborted', 'AbortError')),
        );
      },
      async pull(controller) {
        await new Promise(resolve => setTimeout(resolve, 1));
        if (sent >= stallAfter) return new Promise(() => {}); // hangs until aborted
        if (offset >= body.byteLength) return controller.close();
        const chunk = body.subarray(offset, offset + 10_000);
        offset += chunk.byteLength;
        sent++;
        controller.enqueue(new Uint8Array(chunk));
      },
    });
    return new Response(stream, { status: start > 0 ? 206 : 200 });
  }) as typeof fetch;
  return { fetch, requests, stall: (chunks: number) => (stallAfter = chunks) };
}

function setup(server: ReturnType<typeof host>, packs = [pack()], free = 10 ** 12) {
  const dir = mkdtempSync(join(tmpdir(), 'edi-packs-'));
  const manager = new VoicePacks({
    dir,
    fetch: server.fetch,
    freeBytes: async () => free,
    packs,
  });
  const model = join(dir, 'whisper/ggml-small.en.bin');
  return { dir, manager, model, done: () => rmSync(dir, { recursive: true, force: true }) };
}

test('a pack downloads, is checked, and lands where the runtime looks', async () => {
  const server = host();
  const { manager, model, done } = setup(server);
  try {
    assert.equal(manager.status()[0]?.state, 'missing');
    await manager.download('listening');
    assert.deepEqual(readFileSync(model), content);
    assert.equal(existsSync(`${model}.partial`), false);
    assert.deepEqual(manager.status()[0], {
      id: 'listening',
      name: 'Listening model',
      bytes: 100_000,
      received: 100_000,
      state: 'installed',
    });
    await manager.remove('listening');
    assert.equal(existsSync(model), false);
    assert.equal(manager.status()[0]?.state, 'missing');
  } finally {
    done();
  }
});

test('Pause keeps what arrived, and the next download continues from there', async () => {
  const server = host();
  const { manager, model, done } = setup(server);
  try {
    server.stall(3);
    const first = manager.download('listening');
    while ((manager.status()[0]?.received ?? 0) < 30_000)
      await new Promise(resolve => setTimeout(resolve, 2));
    assert.equal(manager.status()[0]?.state, 'downloading');
    manager.pause('listening');
    await first;
    assert.deepEqual(manager.status()[0], {
      id: 'listening',
      name: 'Listening model',
      bytes: 100_000,
      received: 30_000,
      state: 'paused',
    });

    server.stall(Infinity);
    await manager.download('listening');
    assert.deepEqual(server.requests, [null, 'bytes=30000-']);
    assert.deepEqual(readFileSync(model), content, 'the resumed file is whole and exact');
    assert.equal(manager.status()[0]?.state, 'installed');
  } finally {
    done();
  }
});

test('a host that ignores the resume point starts the file over instead of corrupting it', async () => {
  const server = host({ ignoreRange: true });
  const { dir, manager, model, done } = setup(server);
  try {
    mkdirSync(join(dir, 'whisper'), { recursive: true });
    writeFileSync(`${model}.partial`, content.subarray(0, 20_000));
    assert.equal(manager.status()[0]?.state, 'paused');
    await manager.download('listening');
    assert.deepEqual(readFileSync(model), content);
  } finally {
    done();
  }
});

test('a download that does not match its checksum is thrown away, with a plain reason', async () => {
  const server = host({ body: randomBytes(100_000) });
  const { manager, model, done } = setup(server);
  try {
    await manager.download('listening');
    assert.equal(existsSync(model), false);
    assert.equal(existsSync(`${model}.partial`), false);
    const status = manager.status()[0];
    assert.equal(status?.state, 'failed');
    assert.match(status?.error ?? '', /didn’t check out/);
  } finally {
    done();
  }
});

test('not enough disk space, or a host error, is said plainly before anything is written', async () => {
  const full = setup(host(), [pack()], 50_000);
  try {
    await full.manager.download('listening');
    assert.match(full.manager.status()[0]?.error ?? '', /^Needs \d+ MB free on this Mac\.$/);
    assert.equal(existsSync(`${full.model}.partial`), false);
  } finally {
    full.done();
  }
  const broken = setup(host({ status: 503 }));
  try {
    await broken.manager.download('listening');
    assert.match(broken.manager.status()[0]?.error ?? '', /couldn’t start \(503\)/);
  } finally {
    broken.done();
  }
});
