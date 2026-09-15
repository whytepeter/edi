import { z } from 'zod';

/**
 * Local speech models and the voices each one offers. A model is the engine; a voice is who
 * Edi sounds like within it. Settings stores one chosen voice per model, so switching models
 * back and forth keeps each choice.
 */
export const voiceModelSchema = z.enum(['kokoro', 'chatterbox', 'cartesia', 'elevenlabs']);
/** Speech recognition: local whisper, or Cartesia's realtime transcription. */
export const voiceInputSchema = z.enum(['local', 'cartesia']);
export type VoiceInput = z.infer<typeof voiceInputSchema>;
/** Words for speech recognition (Settings → Voice): a few dozen names, each short. */
export const voiceWordsSchema = z
  .array(z.string().trim().min(1).max(40))
  .max(50)
  .transform(words => [...new Set(words)]);
export type VoiceModelId = z.infer<typeof voiceModelSchema>;

/**
 * Downloadable on-device packs (Settings → Voice): whisper's model for hearing, Kokoro and its
 * voices for speaking.
 */
export const voicePackIdSchema = z.enum(['listening', 'speaking']);
export type VoicePackId = z.infer<typeof voicePackIdSchema>;
/**
 * A pack as Settings shows it. `development` means it is not downloaded but this development
 * copy of Edi already has it from the benchmarks cache.
 */
export const voicePackStatusSchema = z
  .object({
    id: voicePackIdSchema,
    name: z.string().max(60),
    bytes: z.number().int().nonnegative(),
    received: z.number().int().nonnegative(),
    state: z.enum(['missing', 'downloading', 'paused', 'installed', 'failed', 'development']),
    error: z.string().max(160).optional(),
  })
  .strict();
export type VoicePackStatus = z.infer<typeof voicePackStatusSchema>;

/**
 * Cloud speech with the person's own key. Only voices on their account are offered (ones they
 * created, cloned or saved there), never the provider's public library.
 */
export const cloudProviderSchema = z.enum(['cartesia', 'elevenlabs']);
export type CloudProviderId = z.infer<typeof cloudProviderSchema>;
export const isCloudVoiceModel = (model: VoiceModelId): model is CloudProviderId =>
  model === 'cartesia' || model === 'elevenlabs';
export const cloudVoiceIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
export const cloudVoiceOptionSchema = z
  .object({
    id: cloudVoiceIdSchema,
    name: z.string().min(1).max(60),
    description: z.string().max(200),
    gender: z.enum(['Female', 'Male']).nullable(),
    accent: z.string().max(40).nullable(),
  })
  .strict();
export type CloudVoiceOption = z.infer<typeof cloudVoiceOptionSchema>;
export const cloudVoiceListSchema = z.array(cloudVoiceOptionSchema).max(200);

export interface VoiceOption {
  id: string;
  name: string;
  accent: 'American' | 'British';
  gender: 'Female' | 'Male';
}

/** Kokoro 82M English voices, pinned in benchmarks/voice/provision_mlx.py. */
export const kokoroVoices = [
  { id: 'af_heart', name: 'Heart', accent: 'American', gender: 'Female' },
  { id: 'af_bella', name: 'Bella', accent: 'American', gender: 'Female' },
  { id: 'af_nicole', name: 'Nicole', accent: 'American', gender: 'Female' },
  { id: 'af_sarah', name: 'Sarah', accent: 'American', gender: 'Female' },
  { id: 'af_nova', name: 'Nova', accent: 'American', gender: 'Female' },
  { id: 'af_sky', name: 'Sky', accent: 'American', gender: 'Female' },
  { id: 'af_kore', name: 'Kore', accent: 'American', gender: 'Female' },
  { id: 'af_aoede', name: 'Aoede', accent: 'American', gender: 'Female' },
  { id: 'af_alloy', name: 'Alloy', accent: 'American', gender: 'Female' },
  { id: 'af_jessica', name: 'Jessica', accent: 'American', gender: 'Female' },
  { id: 'af_river', name: 'River', accent: 'American', gender: 'Female' },
  { id: 'bf_emma', name: 'Emma', accent: 'British', gender: 'Female' },
  { id: 'bf_isabella', name: 'Isabella', accent: 'British', gender: 'Female' },
  { id: 'bf_alice', name: 'Alice', accent: 'British', gender: 'Female' },
  { id: 'bf_lily', name: 'Lily', accent: 'British', gender: 'Female' },
  { id: 'am_michael', name: 'Michael', accent: 'American', gender: 'Male' },
  { id: 'am_adam', name: 'Adam', accent: 'American', gender: 'Male' },
  { id: 'am_echo', name: 'Echo', accent: 'American', gender: 'Male' },
  { id: 'am_eric', name: 'Eric', accent: 'American', gender: 'Male' },
  { id: 'am_fenrir', name: 'Fenrir', accent: 'American', gender: 'Male' },
  { id: 'am_liam', name: 'Liam', accent: 'American', gender: 'Male' },
  { id: 'am_onyx', name: 'Onyx', accent: 'American', gender: 'Male' },
  { id: 'am_puck', name: 'Puck', accent: 'American', gender: 'Male' },
  { id: 'bm_george', name: 'George', accent: 'British', gender: 'Male' },
  { id: 'bm_lewis', name: 'Lewis', accent: 'British', gender: 'Male' },
  { id: 'bm_daniel', name: 'Daniel', accent: 'British', gender: 'Male' },
  { id: 'bm_fable', name: 'Fable', accent: 'British', gender: 'Male' },
] as const satisfies readonly VoiceOption[];

export const voiceCatalog = {
  kokoro: kokoroVoices,
  // Chatterbox Turbo's built-in voice, delivered two ways: Calm samples conservatively for a
  // steadier, softer read; Expressive is the model's default liveliness. Voices the person adds
  // from their own recordings are listed at runtime (`personalVoiceSchema`).
  // Chatterbox speaks only from a recording: Edi ships one as its built-in voice, and voices
  // the person adds are listed at runtime (`personalVoiceSchema`). The delivery below is how
  // it reads any of them.
  chatterbox: [{ id: 'built-in', name: 'Edi', accent: 'American', gender: 'Female' }],
  // Cloud voices are listed from the person's account at runtime.
  cartesia: [],
  elevenlabs: [],
} as const satisfies Record<VoiceModelId, readonly VoiceOption[]>;

const ids = <T extends readonly { id: string }[]>(voices: T) =>
  voices.map(voice => voice.id) as unknown as [T[number]['id'], ...T[number]['id'][]];

export const kokoroVoiceSchema = z.enum(ids(voiceCatalog.kokoro));
/**
 * A Chatterbox voice the person added from a recording on this Mac. Ids are short lowercase
 * words ("edi"), so they can never be a path; the recording and its name stay on this Mac.
 */
export const personalVoiceIdSchema = z
  .string()
  .regex(/^[a-z]{2,20}$/)
  // Never the built-in voice's id, nor the delivery names two older versions saved as voices.
  .refine(id => !['built-in', 'calm', 'turbo'].includes(id));
export const personalVoiceNameSchema = z.string().trim().min(1).max(40);
export const personalVoiceSchema = z
  .object({
    id: personalVoiceIdSchema,
    name: personalVoiceNameSchema,
    addedAt: z.number().int().nonnegative(),
  })
  .strict();
export type PersonalVoice = z.infer<typeof personalVoiceSchema>;
export const personalVoiceListSchema = z.array(personalVoiceSchema).max(20);
/** Adding a voice: the saved voice, or why it could not be used. Null when the picker was cancelled. */
export const personalVoiceAddResultSchema = z
  .discriminatedUnion('ok', [
    z.object({ ok: z.literal(true), voice: personalVoiceSchema }).strict(),
    z.object({ ok: z.literal(false), error: z.string().max(200) }).strict(),
  ])
  .nullable();
export type PersonalVoiceAddResult = z.infer<typeof personalVoiceAddResultSchema>;

/** Chatterbox's own voice, or one the person added from a recording. */
export const chatterboxVoiceSchema = z.union([
  z.enum(ids(voiceCatalog.chatterbox)),
  personalVoiceIdSchema,
]);

/**
 * How Chatterbox reads, whichever voice it speaks in: Calm is steadier and softer, Expressive
 * is livelier. Both use the model's own expression controls; earlier versions listed these as
 * two separate voices and left the controls off.
 */
export const voiceDeliverySchema = z.enum(['calm', 'expressive']);
export type VoiceDelivery = z.infer<typeof voiceDeliverySchema>;

export const defaultVoices = {
  kokoro: 'af_heart',
  chatterbox: 'built-in',
  cartesia: null,
  elevenlabs: null,
} as const;

/** The chosen voice for each model. Unknown or retired voices fall back to the default. */
export const voiceChoicesSchema = z
  .object({
    kokoro: kokoroVoiceSchema.catch(defaultVoices.kokoro).default(defaultVoices.kokoro),
    chatterbox: chatterboxVoiceSchema
      .catch(defaultVoices.chatterbox)
      .default(defaultVoices.chatterbox),
    cartesia: cloudVoiceIdSchema.nullable().catch(null).default(null),
    elevenlabs: cloudVoiceIdSchema.nullable().catch(null).default(null),
  })
  .default(defaultVoices);
export type VoiceChoices = z.infer<typeof voiceChoicesSchema>;

/** A model and one of its own voices; a voice from another model is rejected. */
export const voiceSelectionSchema = z.discriminatedUnion('model', [
  z.object({ model: z.literal('kokoro'), voice: kokoroVoiceSchema }).strict(),
  z.object({ model: z.literal('chatterbox'), voice: chatterboxVoiceSchema }).strict(),
  z.object({ model: z.literal('cartesia'), voice: cloudVoiceIdSchema }).strict(),
  z.object({ model: z.literal('elevenlabs'), voice: cloudVoiceIdSchema }).strict(),
]);
export type VoiceSelection = z.infer<typeof voiceSelectionSchema>;

export function voiceName(model: VoiceModelId, voice: string | null) {
  if (!voice) return 'No voice chosen';
  const option = (voiceCatalog[model] as readonly VoiceOption[]).find(entry => entry.id === voice);
  return option?.name ?? voice;
}
