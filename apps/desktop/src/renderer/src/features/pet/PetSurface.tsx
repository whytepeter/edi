import { useEffect, useState, useSyncExternalStore } from 'react';
import { assistantName, type CharacterExpression, type CharacterMood } from '@edi/contracts';
import { useSettings } from '../../hooks/useSettings';
import { characterById, useCharacters } from '../../hooks/useCharacters';
import { AssistantNameContext } from '../../hooks/useAssistantName';
import { cueStore } from './cue-store';
import { DesktopPet } from './DesktopPet';
import './pet.css';

/** The always-on-top character window: what Edi is doing, how it feels, and any cue in the voice. */
export function PetSurface() {
  const { settings } = useSettings();
  const characters = useCharacters();
  const character = characterById(characters, settings.skin);
  const [expression, setExpression] = useState<CharacterExpression>('idle');
  const [mood, setMood] = useState<CharacterMood>('neutral');
  const cue = useSyncExternalStore(cueStore.subscribe, cueStore.current);
  useEffect(() => window.edi?.onCharacterExpression(setExpression), []);
  useEffect(() => window.edi?.onCharacterMood(setMood), []);
  return (
    <AssistantNameContext.Provider value={assistantName(settings, character.manifest.name)}>
      <DesktopPet character={character} expression={expression} mood={mood} cue={cue} />
    </AssistantNameContext.Provider>
  );
}
