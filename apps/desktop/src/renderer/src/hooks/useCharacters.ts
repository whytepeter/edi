import { useEffect, useState } from 'react';
import { defaultCharacterId, type CharacterDescriptor } from '@edi/contracts';
import { builtInCharacters } from '../../../shared/built-in-characters';
import '../lib/bridge';

/** Built-in characters immediately, then the full list (installed ones too) from main. */
export function useCharacters() {
  const [characters, setCharacters] = useState<CharacterDescriptor[]>(builtInCharacters);
  useEffect(() => {
    if (!window.edi) return;
    let alive = true;
    window.edi
      .characters()
      .then(list => alive && setCharacters(list))
      .catch(() => {});
    const unsubscribe = window.edi.onCharacters(setCharacters);
    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);
  return characters;
}

/** The character with this id, or Edi when it is not installed. */
export function characterById(characters: CharacterDescriptor[], id: string) {
  return (
    characters.find(entry => entry.manifest.id === id) ??
    characters.find(entry => entry.manifest.id === defaultCharacterId) ??
    builtInCharacters[0]!
  );
}
