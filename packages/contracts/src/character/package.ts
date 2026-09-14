import {
  builtInCharacterIds,
  characterManifestSchema,
  type CharacterDescriptor,
  type CharacterManifest,
} from './manifest';
import { sanitizeCharacterArt, type ArtProblem } from './svg';

export const maxManifestBytes = 16_000;

export interface CharacterCheck {
  /** Ready to render, or null when there is at least one error. */
  descriptor: CharacterDescriptor | null;
  manifest: CharacterManifest | null;
  problems: ArtProblem[];
}

/**
 * The single gate every character passes, built-in or installed: the manifest must validate,
 * the art must sanitize, and both must describe the same artboard. The creator checker, the
 * installer and app startup all call this, so they can never disagree.
 */
export function checkCharacter(
  files: { manifest: string; art: string },
  options: { builtIn?: boolean } = {},
): CharacterCheck {
  const problems: ArtProblem[] = [];
  const error = (message: string) => problems.push({ level: 'error', message });

  let manifest: CharacterManifest | null = null;
  if (new TextEncoder().encode(files.manifest).byteLength > maxManifestBytes) {
    error(`character.json is larger than ${maxManifestBytes / 1000} KB`);
  } else {
    let json: unknown;
    try {
      json = JSON.parse(files.manifest);
    } catch {
      error('character.json is not valid JSON');
    }
    if (json !== undefined) {
      const parsed = characterManifestSchema.safeParse(json);
      if (parsed.success) manifest = parsed.data;
      else
        for (const issue of parsed.error.issues.slice(0, 12))
          error(`character.json ${issue.path.join('.') || '(root)'}: ${issue.message}`);
    }
  }
  if (
    manifest &&
    !options.builtIn &&
    (builtInCharacterIds as readonly string[]).includes(manifest.id)
  )
    error(`The id "${manifest.id}" belongs to a character that ships with Edi; choose your own.`);

  const art = sanitizeCharacterArt(files.art);
  problems.push(...art.problems);
  if (manifest && art.viewBox) {
    const { x, y, width, height } = manifest.geometry.viewBox;
    const expected = [x, y, width, height];
    const actual = art.viewBox.split(/[\s,]+/).map(Number);
    if (actual.length !== 4 || actual.some((value, index) => value !== expected[index]))
      error(
        `art.svg viewBox "${art.viewBox}" must match character.json geometry.viewBox "${expected.join(' ')}"`,
      );
  }

  const ok = manifest && !problems.some(problem => problem.level === 'error');
  return {
    descriptor: ok
      ? {
          manifest: manifest!,
          art: art.markup,
          variants: art.variants,
          builtIn: Boolean(options.builtIn),
        }
      : null,
    manifest,
    problems,
  };
}
