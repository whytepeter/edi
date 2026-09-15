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

/**
 * Provider reason codes, to Edi's own words. ElevenLabs sends most account problems as 401
 * (quota, missing permission, blocked free use), so the status alone blames the key wrongly.
 */
const reasons = {
  invalid_api_key: name => `${name} rejected the key. Replace it in Settings → Voice.`,
  missing_permissions: name =>
    `This ${name} key isn’t allowed to make speech. Turn on Text to Speech for it.`,
  quota_exceeded: name => `${name} has no credits left on this account.`,
  detected_unusual_activity: name =>
    `${name} blocked free use on this account. A paid plan lifts it.`,
  voice_access_denied: name =>
    `Your ${name} plan can’t use that voice from other apps. Choose another.`,
  voice_not_found: name => `That ${name} voice is no longer available. Choose another.`,
  rate_limit_exceeded: name => `${name} is limiting requests right now. Try again shortly.`,
} satisfies Record<string, (name: string) => string>;
const sameReason: Record<string, keyof typeof reasons> = {
  missing_api_key: 'invalid_api_key',
  invalid_authorization_header: 'invalid_api_key',
  unauthorized: 'invalid_api_key',
  insufficient_permissions: 'missing_permissions',
  insufficient_credits: 'quota_exceeded',
  subscription_required: 'voice_access_denied',
  feature_not_available: 'voice_access_denied',
  payment_required: 'voice_access_denied',
  paid_plan_required: 'voice_access_denied',
  invalid_voice_id: 'voice_not_found',
  concurrent_limit_exceeded: 'rate_limit_exceeded',
  too_many_concurrent_requests: 'rate_limit_exceeded',
  system_busy: 'rate_limit_exceeded',
};

/**
 * A person-readable failure that never includes the key or the response body; a provider's
 * reason code only picks the words (an unknown one is shown, for diagnosis).
 */
export function cloudError(provider: CloudProviderId, status: number, code?: string) {
  const name = names[provider];
  // Own keys only: a code like "constructor" must not reach Object.prototype.
  const own = <T extends object>(table: T, key: string): key is Extract<keyof T, string> =>
    Object.hasOwn(table, key);
  const reason = !code
    ? undefined
    : own(reasons, code)
      ? code
      : own(sameReason, code)
        ? sameReason[code]
        : undefined;
  if (reason) return new Error(reasons[reason](name));
  if (!code && (status === 401 || status === 403)) return new Error(reasons.invalid_api_key(name));
  if (status === 402) return new Error(reasons.quota_exceeded(name));
  if (status === 404) return new Error(reasons.voice_not_found(name));
  if (status === 429) return new Error(reasons.rate_limit_exceeded(name));
  return new Error(`${name} could not speak that (${status}${code ? `, ${code}` : ''}).`);
}

/** The reason code in an error reply: `detail.code`, or `detail.status` in older replies. */
async function failureCode(response: Response) {
  try {
    const body = (await response.json()) as { detail?: { code?: unknown; status?: unknown } };
    const code = body.detail?.code ?? body.detail?.status;
    return typeof code === 'string' && /^[a-z_]{1,60}$/.test(code) ? code : undefined;
  } catch {
    return undefined;
  }
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
  if (!response.ok) throw cloudError(provider, response.status, await failureCode(response));
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
  if (!response.ok || !response.body)
    throw cloudError(
      provider,
      response.status,
      response.ok ? undefined : await failureCode(response),
    );

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
