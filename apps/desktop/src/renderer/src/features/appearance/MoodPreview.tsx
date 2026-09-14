import { useState } from 'react';
import type { CharacterDescriptor, CharacterState } from '@edi/contracts';
import { CharacterArt } from '../../components/character/CharacterArt';

/** Every state a character should handle, in the order a creator checks them. */
export const previewStates: { label: string; state: CharacterState }[] = [
  { label: 'Resting', state: { expression: 'idle', mood: 'neutral', cue: null } },
  { label: 'Listening', state: { expression: 'listening', mood: 'neutral', cue: null } },
  { label: 'Thinking', state: { expression: 'thinking', mood: 'neutral', cue: null } },
  { label: 'Speaking', state: { expression: 'speaking', mood: 'neutral', cue: null } },
  { label: 'Happy', state: { expression: 'idle', mood: 'happy', cue: null } },
  { label: 'Sad', state: { expression: 'idle', mood: 'sad', cue: null } },
  { label: 'Surprised', state: { expression: 'idle', mood: 'surprised', cue: null } },
  { label: 'Confused', state: { expression: 'idle', mood: 'confused', cue: null } },
  { label: 'Sleepy', state: { expression: 'idle', mood: 'sleepy', cue: null } },
  { label: 'Love', state: { expression: 'idle', mood: 'love', cue: null } },
  { label: 'Annoyed', state: { expression: 'idle', mood: 'annoyed', cue: null } },
  { label: 'Laugh', state: { expression: 'speaking', mood: 'neutral', cue: 'laugh' } },
  { label: 'Sigh', state: { expression: 'speaking', mood: 'neutral', cue: 'sigh' } },
];

/**
 * A character in every state at once, so a person can see what they are installing and a
 * creator can check each variant. Tapping a tile replays its motion.
 */
export function MoodPreview({ character }: { character: CharacterDescriptor }) {
  const [replay, setReplay] = useState<Record<string, number>>({});
  return (
    <ul className="mood-preview" aria-label={`${character.manifest.name} in every mood`}>
      {previewStates.map(({ label, state }) => (
        <li key={label}>
          <button
            type="button"
            className="mood-preview-tile character-live"
            aria-label={`Replay ${label}`}
            onClick={() =>
              setReplay(current => ({ ...current, [label]: (current[label] ?? 0) + 1 }))
            }
          >
            <CharacterArt key={replay[label] ?? 0} character={character} {...state} />
          </button>
          <span className="ds-caption ds-secondary">{label}</span>
        </li>
      ))}
    </ul>
  );
}
