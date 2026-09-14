import { z } from 'zod';
import { speechCueSchema, type SpeechCue } from '../voice';

/**
 * How a character shows what is going on, in three independent layers:
 *
 * - expression: what Edi is doing right now, from the runtime (listening, speaking…), plus two
 *   short gestures (happy, attention). Main owns it.
 * - mood: how the current moment feels (sad, surprised…). It lasts for a reply or a while.
 * - cue: a one-shot sound in the voice (laugh, sigh…), timed to the audio in the pet window.
 *
 * Artwork never sees these directly. Each part of a character (eyes, mouth…) offers named
 * variants, and `resolveVariant` picks the best one it has for the combined state, falling back
 * to `default`. A new mood only needs a name here and, optionally, variants in the art.
 */
export const characterExpressionSchema = z.enum([
  'idle',
  'listening',
  'thinking',
  'speaking',
  'happy',
  'attention',
]);
export type CharacterExpression = z.infer<typeof characterExpressionSchema>;

export const characterMoodSchema = z.enum([
  'neutral',
  'happy',
  'sad',
  'surprised',
  'confused',
  'sleepy',
  'love',
  'annoyed',
]);
export type CharacterMood = z.infer<typeof characterMoodSchema>;

export interface CharacterState {
  expression: CharacterExpression;
  mood: CharacterMood;
  cue: SpeechCue | null;
}

export const neutralCharacterState: CharacterState = {
  expression: 'idle',
  mood: 'neutral',
  cue: null,
};

/** Parts a character's art may contain, each with variants. Only eyes and mouth are required. */
export const characterParts = ['eyes', 'brows', 'mouth', 'cheeks', 'extras', 'effects'] as const;
export type CharacterPart = (typeof characterParts)[number];
export const requiredCharacterParts: readonly CharacterPart[] = ['eyes', 'mouth'];

/**
 * A variant stands in for a close relative when the art does not have the exact one: a chuckle
 * can use the laugh face, a laugh the happy face, love the happy face.
 */
const cueFallbacks: Record<SpeechCue, string[]> = {
  laugh: ['laugh', 'happy'],
  chuckle: ['chuckle', 'laugh', 'happy'],
  sigh: ['sigh', 'sad'],
  gasp: ['gasp', 'surprised'],
  groan: ['groan', 'annoyed'],
  sniff: ['sniff', 'sad'],
};
const moodFallbacks: Record<CharacterMood, string[]> = {
  neutral: [],
  happy: ['happy'],
  sad: ['sad'],
  surprised: ['surprised'],
  confused: ['confused'],
  sleepy: ['sleepy'],
  love: ['love', 'happy'],
  annoyed: ['annoyed'],
};

/** Every variant name Edi may ask for, for authoring help and checks. */
export const characterVariantNames = [
  'default',
  'talk',
  'listening',
  'thinking',
  'attention',
  ...characterMoodSchema.options.filter(mood => mood !== 'neutral'),
  ...speechCueSchema.options,
] as const;

/**
 * Variant names in order of preference for a state. A cue wins (it is short and audible), then
 * the talking mouth, the happy and attention gestures, the mood, and finally what Edi is doing.
 */
export function variantPreference(state: CharacterState): string[] {
  const order: string[] = [];
  if (state.cue) order.push(...cueFallbacks[state.cue]);
  if (state.expression === 'speaking') order.push('talk');
  if (state.expression === 'happy') order.push('happy');
  if (state.expression === 'attention') order.push('attention');
  order.push(...moodFallbacks[state.mood]);
  if (state.expression === 'listening' || state.expression === 'thinking')
    order.push(state.expression);
  order.push('default');
  return [...new Set(order)];
}

/** The variant a part shows, or null when it has nothing for this state (the part is hidden). */
export function resolveVariant(available: Iterable<string>, state: CharacterState) {
  const offered = new Set(available);
  return variantPreference(state).find(name => offered.has(name)) ?? null;
}

export type { SpeechCue };
