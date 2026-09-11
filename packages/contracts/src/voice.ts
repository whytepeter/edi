import { z } from 'zod';

/**
 * Voice I/O runs in the pet renderer (microphone, decoding, playback); the session
 * itself lives in main. Every message carries the session generation, so anything
 * from an older turn is ignored.
 */
const generation = z.number().int().nonnegative();
// z.custom keeps the plain typed-array types (any backing buffer) across IPC.
const float32 = z.custom<Float32Array>(
  value => value instanceof Float32Array,
  'Expected Float32Array',
);
const bytes = z.custom<Uint8Array>(value => value instanceof Uint8Array, 'Expected Uint8Array');

/** 16 kHz mono PCM16, at most 61 s: the transcription boundary. */
export const maxVoicePcmBytes = 16_000 * 2 * 61;

/** Main → pet renderer. */
export const voiceHostEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('open'), generation }).strict(),
  z.object({ type: z.literal('finish'), generation }).strict(),
  z.object({ type: z.literal('cancel'), generation }).strict(),
  z
    .object({
      type: z.literal('pcm'),
      generation,
      rate: z.number().int().min(8000).max(48000),
      samples: float32.refine(samples => samples.length > 0 && samples.length <= 48000),
    })
    .strict(),
  z.object({ type: z.literal('stop-audio') }).strict(),
]);
export type VoiceHostEvent = z.infer<typeof voiceHostEventSchema>;

/** Pet renderer → main, carried by the command channel. */
export const voiceCommandSchemas = [
  z
    .object({
      type: z.literal('voice-event'),
      generation,
      event: z.enum(['capture-ready', 'speech-detected', 'failed']),
    })
    .strict(),
  z
    .object({
      type: z.literal('voice-audio'),
      generation,
      pcm: bytes.refine(
        pcm => pcm.byteLength > 0 && pcm.byteLength % 2 === 0 && pcm.byteLength <= maxVoicePcmBytes,
      ),
    })
    .strict(),
  /** One PCM chunk was accepted by the player: main may send the next (backpressure). */
  z.object({ type: z.literal('voice-played'), generation }).strict(),
] as const;

/** Short notices shown in the character's bubble, e.g. "I didn’t catch that". */
export const bubbleNoticeSchema = z.string().trim().min(1).max(60);
