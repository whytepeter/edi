# Characters, expressions and motion

A character is a package of data: `character.json` and `art.svg`. Edi and Mochi ship as packages; people can
install more from `.edichar` files. How to make one is in [characters/README.md](characters/README.md). This
page is for changing the system itself.

The character is a presentation surface, not an agent runtime. Voice providers, models and capabilities never
touch artwork or CSS; they produce semantic state, and the pet renderer turns that into a face and motion.

## State in three layers

| Layer          | Values                                                                | Owner                                                         |
| -------------- | --------------------------------------------------------------------- | ------------------------------------------------------------- |
| **expression** | idle, listening, thinking, speaking, happy, attention                 | `CharacterActions` in main, from the runtime                  |
| **mood**       | neutral, happy, sad, surprised, confused, sleepy, love, annoyed       | `CharacterMoodController` in main                             |
| **cue**        | laugh, chuckle, sigh, gasp, groan, sniff                              | the pet window, timed to the audio (`features/pet/cue-store`) |

- Expressions come from what Edi is doing (voice states, a new request, an approval).
- Moods come from the reply: the agent opens every reply with `[MOOD:…]`, which `replyMood` reads and
  `presentationText` and `speakable` strip. An error is briefly sad; after 20 quiet minutes the companion is
  sleepy until the next interaction.
- Cues come from Chatterbox tags. `cueSegments` splits an expressive clip so the tag starts its own
  utterance, and the voice controller sends a `cue` event just ahead of that audio. The pet window schedules
  it on the player clock (see `VoiceClient`), so the face laughs when the voice does.

The three are validated at the preload boundary and combined in `CharacterState`.

## From state to a face

Art is split into parts (`data-part`: eyes, brows, mouth, cheeks, extras, effects), each with variants
(`data-variant`). `resolveVariant` in `packages/contracts/src/character/expressions.ts` picks the variant a
part shows, in this order: cue → talking mouth → happy/attention gesture → mood → listening/thinking →
`default`. Missing variants fall back to a relative (`chuckle` → `laugh` → `happy`, `love` → `happy`,
`gasp` → `surprised`…). A part with no match is hidden, which is how `extras` shows a prop only for one state.

`CharacterArt` injects the sanitized art, marks the chosen variant of each part with `data-active` before
paint, and adds what every character shares: the grab outline (`geometry.bodyPath`), gesture hands at the
anchors, and floating effects (`CharacterEffects`) near the speech anchors.

## Motion

All motion is in `components/character/character.css`, keyed on `data-expression`, `data-mood` and `data-cue`
on the SVG, and only inside `.character-live` (the desktop pet and preview tiles). Priority on the body:
idle breathing → mood → gesture → cue. `--motion` (the manifest's `motion.intensity`) scales distances.
Blinking, glances (`data-part="pupils"`) and lip-sync (`--edi-mouth` on the active mouth variant) apply to
every character. Reduced motion stops all animation but keeps the face.

## Adding an expression

1. Add the name to the right layer in `character/expressions.ts` and, if useful, a fallback.
2. Decide who produces it (main for expressions and moods, a speech tag for cues) and validate it at preload.
3. Add body motion and, if it fits, an effect in `CharacterEffects`.
4. Draw variants for Edi and Mochi in `packages/characters/src`, run `pnpm --filter @edi/characters build`.
5. Add it to `MoodPreview` and the creator guide's table, and extend `tests/desktop/character-animation.mjs`.

Characters without the new variant keep working: they fall back to `default` and still move.

## Packages and safety

- `character/manifest.ts`: the `character.json` schema. `character/package.ts`: `checkCharacter`, the single
  gate for built-in, installed and creator-checked characters.
- `character/svg.ts`: a strict parser and allowlist serializer. Scripts, styles, classes, images, links, text,
  filters, animation, event handlers and non-local references never survive; ids are rewritten to
  `{{scope}}-id` and scoped per rendered copy.
- `apps/desktop/src/main/characters/package-file.ts`: reads and writes `.edichar` zips with size limits; entry
  names are matched, never used as paths.
- `apps/desktop/src/main/characters/library.ts`: built-in plus installed characters in
  `<userData>/characters/<id>/`, rechecked on every launch; install goes through a checked token, removal falls
  back to Edi.
- Built-in art is generated from `packages/characters/src/*.tsx` into `packages/characters/*/art.svg` and bundled
  into main and renderer through `apps/desktop/src/shared/built-in-characters.ts`.

## Verification

- `pnpm test`: sanitizer (hostile SVG), manifest, variant resolution, package reading, mood tags and timing.
- `pnpm test:audio`: cue segmentation and cue events around audio.
- `pnpm test:animation`: both built-in characters in every expression and mood in the real pet window, one
  variant per part, effects, lip-sync scale and reduced motion.
- `pnpm character check <folder>`: what a creator runs.
