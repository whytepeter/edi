import { z } from 'zod';

/**
 * Local speech models and the voices each one offers. A model is the engine; a voice is who
 * Edi sounds like within it. Settings stores one chosen voice per model, so switching models
 * back and forth keeps each choice.
 */
export const voiceModelSchema = z.enum(['kokoro', 'pocket', 'chatterbox-turbo']);
export type VoiceModelId = z.infer<typeof voiceModelSchema>;

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
  // The owner rejected Pocket's Alba and Fantine; Jane is the only Pocket voice Edi offers.
  pocket: [{ id: 'jane', name: 'Jane', accent: 'American', gender: 'Female' }],
  // Chatterbox Turbo's built-in voice, delivered two ways: Calm samples conservatively for a
  // steadier, softer read; Expressive is the model's default liveliness. Cloning comes later.
  'chatterbox-turbo': [
    { id: 'calm', name: 'Calm', accent: 'American', gender: 'Female' },
    { id: 'turbo', name: 'Expressive', accent: 'American', gender: 'Female' },
  ],
} as const satisfies Record<VoiceModelId, readonly VoiceOption[]>;

const ids = <T extends readonly { id: string }[]>(voices: T) =>
  voices.map(voice => voice.id) as unknown as [T[number]['id'], ...T[number]['id'][]];

export const kokoroVoiceSchema = z.enum(ids(voiceCatalog.kokoro));
export const pocketVoiceSchema = z.enum(ids(voiceCatalog.pocket));
export const chatterboxVoiceSchema = z.enum(ids(voiceCatalog['chatterbox-turbo']));

export const defaultVoices = {
  kokoro: 'af_heart',
  pocket: 'jane',
  'chatterbox-turbo': 'calm',
} as const;

/** The chosen voice for each model. Unknown or retired voices fall back to the default. */
export const voiceChoicesSchema = z
  .object({
    kokoro: kokoroVoiceSchema.catch(defaultVoices.kokoro).default(defaultVoices.kokoro),
    pocket: pocketVoiceSchema.catch(defaultVoices.pocket).default(defaultVoices.pocket),
    'chatterbox-turbo': chatterboxVoiceSchema
      .catch(defaultVoices['chatterbox-turbo'])
      .default(defaultVoices['chatterbox-turbo']),
  })
  .default(defaultVoices);
export type VoiceChoices = z.infer<typeof voiceChoicesSchema>;

/** A model and one of its own voices; a voice from another model is rejected. */
export const voiceSelectionSchema = z.discriminatedUnion('model', [
  z.object({ model: z.literal('kokoro'), voice: kokoroVoiceSchema }).strict(),
  z.object({ model: z.literal('pocket'), voice: pocketVoiceSchema }).strict(),
  z.object({ model: z.literal('chatterbox-turbo'), voice: chatterboxVoiceSchema }).strict(),
]);
export type VoiceSelection = z.infer<typeof voiceSelectionSchema>;

export function voiceName(model: VoiceModelId, voice: string) {
  const option = (voiceCatalog[model] as readonly VoiceOption[]).find(entry => entry.id === voice);
  return option?.name ?? voice;
}
