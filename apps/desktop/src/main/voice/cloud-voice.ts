/**
 * Cloud speech: Cartesia and ElevenLabs, with the person's own keys. Only the text Edi speaks is
 * sent, to the chosen provider, and usage is billed to that account. Audio streams back as raw
 * 24 kHz PCM and is handed to the same player as local voices, one second at a time.
 *
 * Endpoints (checked 2026-09-14):
 * - Cartesia: POST /tts/bytes (Cartesia-Version 2026-08-14, model sonic-3.6),
 *   GET /voices?is_owner=true.
 * - ElevenLabs: POST /v1/text-to-speech/{voice}/stream?output_format=pcm_24000 with
 *   eleven_flash_v2_5 (lowest latency; v3 is too slow for conversation),
 *   GET /v2/voices?voice_type=non-default.
 */
import type { CloudProviderId, CloudVoiceOption } from '@edi/contracts';

type Consume = (pcm: Float32Array, sampleRate: number) => Promise<void>;

const RATE = 24_000;
const FIRST_AUDIO_MS = 15_000;
const TOTAL_MS = 120_000;
export const CARTESIA_VERSION = '2026-08-14';
export const CARTESIA_MODEL = 'sonic-3.6';
export const ELEVENLABS_MODEL = 'eleven_flash_v2_5';

export interface CloudVoiceDependencies {
  fetch?: typeof fetch;
  /** Test servers only. */
  baseUrl?: Partial<Record<CloudProviderId, string>>;
}

const bases: Record<CloudProviderId, string> = {
  cartesia: 'https://api.cartesia.ai',
  elevenlabs: 'https://api.elevenlabs.io',
};
const names: Record<CloudProviderId, string> = { cartesia: 'Cartesia', elevenlabs: 'ElevenLabs' };

function headers(provider: CloudProviderId, key: string): Record<string, string> {
  return provider === 'cartesia'
    ? { Authorization: `Bearer ${key}`, 'Cartesia-Version': CARTESIA_VERSION }
    : { 'xi-api-key': key };
}

/** A person-readable failure that never includes the key or the response body. */
export function cloudError(provider: CloudProviderId, status: number) {
  const name = names[provider];
  if (status === 401 || status === 403)
    return new Error(`${name} rejected the key. Replace it in Settings → Voice.`);
  if (status === 402) return new Error(`${name} has no credits left on this account.`);
  if (status === 404)
    return new Error(`That ${name} voice is no longer available. Choose another.`);
  if (status === 429)
    return new Error(`${name} is limiting requests right now. Try again shortly.`);
  return new Error(`${name} could not speak that (${status}).`);
}

const text = (value: unknown, max: number) =>
  typeof value === 'string' ? value.slice(0, max) : '';
const gender = (value: unknown): CloudVoiceOption['gender'] => {
  const label = String(value ?? '').toLowerCase();
  if (label === 'female' || label === 'feminine') return 'Female';
  if (label === 'male' || label === 'masculine') return 'Male';
  return null;
};
const idPattern = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Only the voices on the person's account, never the provider's public library; also a cheap
 * way to check a key. Cartesia: voices the account owns. ElevenLabs: everything except its
 * default voices (ones they created, cloned or saved from the community library).
 */
export async function listCloudVoices(
  provider: CloudProviderId,
  key: string,
  signal: AbortSignal,
  deps: CloudVoiceDependencies = {},
): Promise<CloudVoiceOption[]> {
  const request = deps.fetch ?? fetch;
  const base = deps.baseUrl?.[provider] ?? bases[provider];
  const response = await request(
    provider === 'cartesia'
      ? `${base}/voices?limit=100&is_owner=true`
      : `${base}/v2/voices?page_size=100&voice_type=non-default`,
    {
      headers: headers(provider, key),
      signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
    },
  );
  if (!response.ok) throw cloudError(provider, response.status);
  const body = (await response.json()) as { data?: unknown[]; voices?: unknown[] };
  const listed = (provider === 'cartesia' ? body.data : body.voices) ?? [];
  const seen = new Set<string>();
  const voices: CloudVoiceOption[] = [];
  for (const raw of listed.slice(0, 200)) {
    if (!raw || typeof raw !== 'object') continue;
    const entry = raw as Record<string, unknown>;
    // The filter is the provider's; this guards against a default voice slipping through.
    if (provider === 'cartesia' ? entry.is_owner === false : entry.category === 'premade') continue;
    const labels = (entry.labels ?? {}) as Record<string, unknown>;
    const id = text(provider === 'cartesia' ? entry.id : entry.voice_id, 64);
    const name = text(entry.name, 60).trim();
    if (!idPattern.test(id) || !name || seen.has(id)) continue;
    seen.add(id);
    voices.push({
      id,
      name,
      description: text(entry.description ?? labels.description, 200).trim(),
      gender: gender(provider === 'cartesia' ? entry.gender : labels.gender),
      accent: text(labels.accent, 40).trim() || null,
    });
  }
  return voices;
}

/**
 * Stream one reply. Bytes arrive in arbitrary sizes; complete 16-bit samples are converted and
 * passed on in frames of at most one second, waiting on the player each time (backpressure).
 */
export async function speakCloud(
  provider: CloudProviderId,
  key: string,
  voice: string,
  words: string,
  signal: AbortSignal,
  consume: Consume,
  deps: CloudVoiceDependencies = {},
) {
  if (!idPattern.test(voice))
    throw new Error(`Choose a ${names[provider]} voice in Settings → Voice.`);
  if (!words.trim() || words.length > 2_000)
    throw new Error('Voice text must be 1–2000 characters');
  const request = deps.fetch ?? fetch;
  const base = deps.baseUrl?.[provider] ?? bases[provider];
  const total = AbortSignal.any([signal, AbortSignal.timeout(TOTAL_MS)]);
  const response =
    provider === 'cartesia'
      ? await request(`${base}/tts/bytes`, {
          method: 'POST',
          headers: { ...headers(provider, key), 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model_id: CARTESIA_MODEL,
            transcript: words,
            voice: { mode: 'id', id: voice },
            output_format: { container: 'raw', encoding: 'pcm_s16le', sample_rate: RATE },
            language: 'en',
          }),
          signal: total,
        })
      : await request(
          `${base}/v1/text-to-speech/${encodeURIComponent(voice)}/stream?output_format=pcm_24000`,
          {
            method: 'POST',
            headers: { ...headers(provider, key), 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: words, model_id: ELEVENLABS_MODEL }),
            signal: total,
          },
        );
  if (!response.ok || !response.body) throw cloudError(provider, response.status);

  const reader = response.body.getReader();
  let pending = new Uint8Array(0);
  let heard = false;
  const firstAudio = setTimeout(() => void reader.cancel().catch(() => {}), FIRST_AUDIO_MS);
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total.throwIfAborted();
      const joined = new Uint8Array(pending.length + value.length);
      joined.set(pending);
      joined.set(value, pending.length);
      const whole = joined.length - (joined.length % 2);
      pending = joined.slice(whole);
      const view = new DataView(joined.buffer, joined.byteOffset, whole);
      for (let start = 0; start < whole / 2; start += RATE) {
        const count = Math.min(RATE, whole / 2 - start);
        const frame = new Float32Array(count);
        for (let i = 0; i < count; i++) frame[i] = view.getInt16((start + i) * 2, true) / 32768;
        if (!heard) {
          heard = true;
          clearTimeout(firstAudio);
        }
        await consume(frame, RATE);
      }
    }
    if (!heard) throw new Error(`${names[provider]} returned no audio.`);
  } finally {
    clearTimeout(firstAudio);
    reader.releaseLock();
  }
}
