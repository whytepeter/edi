import { checkCharacter, type CharacterDescriptor } from '@edi/contracts';
import ediManifest from '@edi/characters/edi/character.json?raw';
import ediArt from '@edi/characters/edi/art.svg?raw';
import mochiManifest from '@edi/characters/mochi/character.json?raw';
import mochiArt from '@edi/characters/mochi/art.svg?raw';

/**
 * The characters that ship with Edi, bundled into both the main process and the renderer so the
 * first frame never waits. They pass the same check as any installed package; a broken one is a
 * build mistake, so it fails loudly.
 */
export const builtInCharacters: CharacterDescriptor[] = [
  { manifest: ediManifest, art: ediArt },
  { manifest: mochiManifest, art: mochiArt },
].map(files => {
  const { descriptor, problems } = checkCharacter(files, { builtIn: true });
  if (!descriptor)
    throw new Error(`Built-in character is invalid: ${problems.map(p => p.message).join('; ')}`);
  return descriptor;
});
