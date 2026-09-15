import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import {
  CARTESIA_MODEL,
  CARTESIA_VERSION,
  ELEVENLABS_MODEL,
  listCloudVoices,
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

test('ElevenLabs refusals name the real reason, not always the key, and never echo the body', async () => {
  const replies: [number, unknown][] = [
    [401, { detail: { status: 'quota_exceeded', message: 'xi-secret quota' } }],
    [401, { detail: { code: 'missing_permissions', status: 'missing_permissions' } }],
    [401, { detail: { status: 'detected_unusual_activity' } }],
    [402, { detail: { status: 'payment_required' } }],
    [403, { detail: { code: 'voice_access_denied' } }],
    [401, { detail: { status: 'invalid_api_key' } }],
    [401, 'not json'],
    [400, { detail: { code: 'brand_new_reason' } }],
    [400, { detail: { code: 'constructor' } }],
  ];
  let next = 0;
  const { server, base } = await serve((_request, _body, response) => {
    const [status, body] = replies[next++]!;
    response.writeHead(status, { 'content-type': 'application/json' });
    response.end(typeof body === 'string' ? body : JSON.stringify(body));
  });
  try {
    const messages: string[] = [];
    for (const _ of replies) {
      const error = await speakCloud(
        'elevenlabs',
        'xi-secret',
        'Obry8zWnqii5oX5Qsllx',
        'Hi.',
        live(),
        async () => {},
        { baseUrl: { elevenlabs: base } },
      ).catch((failure: Error) => failure);
      assert.ok(error instanceof Error);
      messages.push(error.message);
    }
    assert.deepEqual(messages, [
      'ElevenLabs has no credits left on this account.',
      'This ElevenLabs key isn’t allowed to make speech. Turn on Text to Speech for it.',
      'ElevenLabs blocked free use on this account. A paid plan lifts it.',
      'Your ElevenLabs plan can’t use that voice from other apps. Choose another.',
      'Your ElevenLabs plan can’t use that voice from other apps. Choose another.',
      'ElevenLabs rejected the key. Replace it in Settings → Voice.',
      'ElevenLabs rejected the key. Replace it in Settings → Voice.',
      'ElevenLabs could not speak that (400, brand_new_reason).',
      'ElevenLabs could not speak that (400, constructor).',
    ]);
    assert.ok(messages.every(message => !message.includes('xi-secret')));
  } finally {
    server.close();
  }
});

test('voice lists hold only the person’s own account voices, never the public library', async () => {
  const urls: string[] = [];
  const { server, base } = await serve((request, _body, response) => {
    urls.push(String(request.url));
    response.writeHead(200, { 'content-type': 'application/json' });
    if (request.url === '/voices?limit=100&is_owner=true')
      return response.end(
        JSON.stringify({
          data: [
            { id: 'whyte-1', name: 'Whyte', gender: 'masculine', description: 'Warm' },
            { id: 'edi-1', name: 'Edi', gender: 'feminine', is_owner: true },
            { id: 'lib-1', name: 'Library Lady', gender: 'feminine', is_owner: false },
            { id: 'bad id!', name: 'Broken' },
          ],
        }),
      );
    if (request.url === '/v2/voices?page_size=100&voice_type=non-default')
      return response.end(
        JSON.stringify({
          voices: [
            {
              voice_id: 'pre1',
              name: 'Rachel',
              category: 'premade',
              labels: { gender: 'female', accent: 'american' },
            },
            { voice_id: 'mine1', name: 'My Clone', category: 'cloned', labels: { gender: 'male' } },
            {
              voice_id: 'saved1',
              name: 'Saved',
              category: 'professional',
              labels: { accent: 'british' },
            },
          ],
        }),
      );
    response.end(JSON.stringify({ data: [], voices: [] }));
  });
  try {
    const cartesia = await listCloudVoices('cartesia', 'key', live(), {
      baseUrl: { cartesia: base },
    });
    assert.deepEqual(
      cartesia.map(voice => [voice.id, voice.gender]),
      [
        ['whyte-1', 'Male'],
        ['edi-1', 'Female'],
      ],
    );
    const eleven = await listCloudVoices('elevenlabs', 'key', live(), {
      baseUrl: { elevenlabs: base },
    });
    assert.deepEqual(
      eleven.map(voice => [voice.id, voice.accent]),
      [
        ['mine1', null],
        ['saved1', 'british'],
      ],
    );
    // One request per provider, both filtered to the account.
    assert.deepEqual(urls, [
      '/voices?limit=100&is_owner=true',
      '/v2/voices?page_size=100&voice_type=non-default',
    ]);
  } finally {
    server.close();
  }
});
