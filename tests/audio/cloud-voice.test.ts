import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import {
  CARTESIA_MODEL,
  CARTESIA_VERSION,
  ELEVENLABS_MODEL,
  listCloudVoices,
  preferredCloudVoice,
  speakCloud,
} from '../../apps/desktop/src/main/voice/cloud-voice';

const live = () => new AbortController().signal;

async function serve(
  handler: (request: IncomingMessage, body: string, response: ServerResponse) => void,
) {
  const server: Server = createServer((request, response) => {
    let body = '';
    request.on('data', chunk => (body += chunk));
    request.on('end', () => handler(request, body, response));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  return { server, base: `http://127.0.0.1:${(server.address() as { port: number }).port}` };
}

/** 16-bit little-endian samples: 1.5 seconds of a known ramp, split at an odd byte. */
function pcm(samples: number) {
  const bytes = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) bytes.writeInt16LE((i % 200) * 100, i * 2);
  return bytes;
}

test('ElevenLabs streams PCM into one-second frames, even when bytes split mid-sample', async () => {
  let seen: { url?: string; key?: string; body?: unknown } = {};
  const { server, base } = await serve((request, body, response) => {
    seen = { url: request.url, key: String(request.headers['xi-api-key']), body: JSON.parse(body) };
    response.writeHead(200, { 'content-type': 'audio/pcm' });
    const audio = pcm(36_000);
    response.write(audio.subarray(0, 12_345));
    setTimeout(() => response.end(audio.subarray(12_345)), 20);
  });
  try {
    const frames: Float32Array[] = [];
    await speakCloud(
      'elevenlabs',
      'xi-test-key',
      'voiceABC_1',
      'Hello there.',
      live(),
      async (frame, rate) => {
        assert.equal(rate, 24_000);
        frames.push(frame);
      },
      { baseUrl: { elevenlabs: base } },
    );
    assert.equal(seen.url, '/v1/text-to-speech/voiceABC_1/stream?output_format=pcm_24000');
    assert.equal(seen.key, 'xi-test-key');
    assert.deepEqual(seen.body, { text: 'Hello there.', model_id: ELEVENLABS_MODEL });
    const total = frames.reduce((sum, frame) => sum + frame.length, 0);
    assert.equal(total, 36_000);
    assert.ok(frames.every(frame => frame.length <= 24_000));
    const all = new Float32Array(total);
    let offset = 0;
    for (const frame of frames) {
      all.set(frame, offset);
      offset += frame.length;
    }
    // Sample values survive the odd split intact.
    assert.equal(all[6173], ((6173 % 200) * 100) / 32768);
  } finally {
    server.close();
  }
});

test('Cartesia sends its version header, model and raw PCM request; errors never echo the key', async () => {
  let seen: { headers?: IncomingMessage['headers']; body?: Record<string, unknown> } = {};
  const { server, base } = await serve((request, body, response) => {
    if (request.url === '/tts/bytes') {
      seen = { headers: request.headers, body: JSON.parse(body) };
      response.writeHead(200);
      return response.end(pcm(4_800));
    }
    response.writeHead(401);
    response.end('{"error":"invalid key sk_car_secret"}');
  });
  try {
    let heard = 0;
    await speakCloud(
      'cartesia',
      'sk_car_secret',
      'edi-voice',
      'Hi.',
      live(),
      async frame => {
        heard += frame.length;
      },
      { baseUrl: { cartesia: base } },
    );
    assert.equal(heard, 4_800);
    assert.equal(seen.headers?.authorization, 'Bearer sk_car_secret');
    assert.equal(seen.headers?.['cartesia-version'], CARTESIA_VERSION);
    assert.deepEqual(seen.body, {
      model_id: CARTESIA_MODEL,
      transcript: 'Hi.',
      voice: { mode: 'id', id: 'edi-voice' },
      output_format: { container: 'raw', encoding: 'pcm_s16le', sample_rate: 24_000 },
      language: 'en',
    });
    const error = await listCloudVoices('cartesia', 'sk_car_secret', live(), {
      baseUrl: { cartesia: base },
    }).catch((failure: Error) => failure);
    assert.ok(error instanceof Error);
    assert.match(error.message, /Cartesia rejected the key/);
    assert.doesNotMatch(error.message, /sk_car_secret/);
    await assert.rejects(
      speakCloud('cartesia', 'k', '../escape', 'Hi.', live(), async () => {}),
      /Choose a Cartesia voice/,
    );
  } finally {
    server.close();
  }
});

test('voice lists put the person’s own voices first and prefer one named Edi', async () => {
  const { server, base } = await serve((request, _body, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    if (request.url === '/voices?limit=100&is_owner=true')
      return response.end(
        JSON.stringify({
          data: [
            { id: 'whyte-1', name: 'Whyte', gender: 'masculine', description: 'Warm' },
            { id: 'edi-1', name: 'Edi', gender: 'feminine', description: 'Default' },
          ],
        }),
      );
    if (request.url === '/voices?limit=100')
      return response.end(
        JSON.stringify({
          data: [
            { id: 'lib-1', name: 'Library Lady', gender: 'feminine' },
            { id: 'edi-1', name: 'Edi', gender: 'feminine' },
            { id: 'bad id!', name: 'Broken' },
          ],
        }),
      );
    response.end(
      JSON.stringify({
        voices: [
          {
            voice_id: 'pre1',
            name: 'Rachel',
            category: 'premade',
            labels: { gender: 'female', accent: 'american' },
          },
          { voice_id: 'mine1', name: 'My Clone', category: 'cloned', labels: { gender: 'male' } },
        ],
      }),
    );
  });
  try {
    const cartesia = await listCloudVoices('cartesia', 'key', live(), {
      baseUrl: { cartesia: base },
    });
    assert.deepEqual(
      cartesia.map(voice => [voice.id, voice.mine, voice.gender]),
      [
        ['whyte-1', true, 'Male'],
        ['edi-1', true, 'Female'],
        ['lib-1', false, 'Female'],
      ],
    );
    assert.equal(preferredCloudVoice(cartesia)?.id, 'edi-1');
    const eleven = await listCloudVoices('elevenlabs', 'key', live(), {
      baseUrl: { elevenlabs: base },
    });
    assert.deepEqual(
      eleven.map(voice => [voice.id, voice.mine, voice.accent]),
      [
        ['mine1', true, null],
        ['pre1', false, 'american'],
      ],
    );
    assert.equal(preferredCloudVoice(eleven)?.id, 'mine1');
    assert.equal(preferredCloudVoice([]), null);
  } finally {
    server.close();
  }
});
