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

/** Expression tags the character performs in time with the voice. Other tags are only heard. */
export const speechCueSchema = z.enum(['laugh', 'chuckle', 'sigh', 'gasp', 'groan', 'sniff']);
export type SpeechCue = z.infer<typeof speechCueSchema>;

export interface CueSegment {
  /** Text for the speech engine, tags included. */
  text: string;
  /** Plays as this segment's first audio starts. */
  lead: SpeechCue | null;
  /** Plays near the end of this segment's audio (a tag with nothing spoken after it). */
  trailing: SpeechCue | null;
}

const cueTag = /(\[(?:laugh|chuckle|sigh|gasp|groan|sniff)\])/i;
const hasWords = (text: string) => /[\p{L}\p{N}]/u.test(text.replace(/\[[^\]]*\]/g, ''));

/**
 * Splits an expressive clip so each performed tag (a laugh, a sigh…) starts its own utterance. Streaming
 * synthesis cannot say where inside a clip a tag's sound lands, but the start of an utterance
 * is exact, so the character's laugh begins with the audible one.
 */
export function cueSegments(text: string): CueSegment[] {
  const segments: CueSegment[] = [];
  let current: CueSegment = { text: '', lead: null, trailing: null };
  for (const part of text.split(cueTag)) {
    const cue = cueTag.test(part) ? (part.slice(1, -1).toLowerCase() as SpeechCue) : null;
    if (cue && hasWords(current.text)) {
      segments.push(current);
      current = { text: part, lead: cue, trailing: null };
    } else {
      if (cue && !current.lead && !current.text.trim()) current.lead = cue;
      current.text += part;
    }
  }
  segments.push(current);
  const merged: CueSegment[] = [];
  for (const segment of segments) {
    const clean = { ...segment, text: segment.text.replace(/\s+/g, ' ').trim() };
    if (!clean.text) continue;
    const previous = merged.at(-1);
    // A tag with no words after it is too short to synthesize alone; it ends the previous clip.
    if (previous && !hasWords(clean.text)) {
      previous.text = `${previous.text} ${clean.text}`;
      previous.trailing = clean.lead;
    } else merged.push(clean);
  }
  return merged;
}

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
  /**
   * Perform a laugh or chuckle in time with speech: `next` when the next audio chunk starts,
   * `end` shortly before the audio queued so far finishes.
   */
  z
    .object({
      type: z.literal('cue'),
      generation,
      cue: speechCueSchema,
      at: z.enum(['next', 'end']),
    })
    .strict(),
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
