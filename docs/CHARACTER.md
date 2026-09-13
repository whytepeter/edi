# Character motion and skins

Edi's character is a presentation surface, not an agent runtime. It receives a small semantic expression and
turns that state into artwork and motion. Voice providers, model providers, and capability code never select
CSS animations or manipulate facial parts directly.

## Responsibility and entry points

- `packages/contracts/src/index.ts` defines `CharacterExpression` and the bundled skin catalog.
- `packages/contracts/src/skin-geometry.ts` owns silhouettes, hit bounds, window/bubble anchors, and hand geometry.
- `apps/desktop/src/main/character/character-actions.ts` translates product lifecycle events into expressions.
- `apps/desktop/src/preload/index.ts` validates the narrow main-to-pet expression event.
- `apps/desktop/src/renderer/src/components/Pet.tsx` renders skin artwork and stable semantic part names.
- `apps/desktop/src/renderer/src/features/pet/pet.css` expresses each state with transform/opacity motion.

## State flow

```text
click / hold / voice / agent / approval
             ↓
CharacterActions in main
             ↓ validated CharacterExpression
pet preload → PetSurface → Pet data-expression → skin motion
```

The current states are:

| State | Meaning | Visual treatment |
| --- | --- | --- |
| `idle` | No foreground work | Slow breathing, occasional blink and gaze shift |
| `listening` | Microphone capture is active | Wider eyes only; the bubble shows the listening bars |
| `thinking` | Transcription or agent work is active | Upward gaze only; the bubble shows the thinking dots |
| `speaking` | Audio playback is active | Mouth only. With live audio the mouth opens with the voice's loudness (`--edi-mouth`); otherwise an uneven fallback rhythm |
| `happy` | A foreground turn completed | Brief hop and smile, then idle |
| `attention` | Opening, notice, permission, or approval needs attention | Quick heads-up pose and marks |

Opening the microphone uses `attention` until capture confirms `listening`; this gives immediate feedback without
claiming Edi can already hear. Ordinary assistant text stays in the conversation card. The character bubble is a
separate surface for voice status, concise notices, and request-bound human input.

## Motion rules

Motion changes only transforms and opacity, stays subtle at the desktop size (Small 84×90, Medium 112×120, Large
151×162 from Settings → Appearance; the window scales from Edi's feet), and never alters the skin's
anchor geometry. User input can replace a state immediately. `prefers-reduced-motion` disables all character
keyframes and lip-sync movement while keeping semantic mouths, marks, and expressions visible. States that the
bubble already shows (listening, thinking) never add rings, dots, or body motion to the character (owner decision,
2026-09-13).

## Bundled skins

- **Edi** (default, 2026-09-13): drawn from the owner's reference: a bald, warm-brown rounded head, winged almond
  eyes with clipped irises, thin arched brows, full lips, soft blush and gold hoop earrings hanging behind the jaw.
  Small rounded hands are hidden at rest and appear only for gestures: a wave for `attention` (replacing the
  attention marks) and one hand beside the chin for `happy`. `happy` uses closed, smiling eyes. Mira, a monochrome
  skin that did not read as the intended female character, was removed; saved `mira` preferences migrate to `edi`.
- **Mochi** (2026-09-13): a cream dumpling with a curled tuft, big glossy eyes, pink cheeks and an open smile,
  from the owner's second reference. Cloud and Sprout were removed; saved choices migrate to Edi.
- Each skin has an outline `color`, a body `fill` and a theme `accent` for the card, bubbles and pointer,
  all from one palette. Edi is dark brown throughout (#3d2419). Mochi is a cream body with a softer brown
  outline and theme (#71493D); no pink, and never Edi's exact brown (owner decision).
- Every bundled skin uses the same small gesture hands: hidden at rest, a wave for `attention`, one hand by the
  chin for `happy`. Hovering a character in Appearance plays `happy`.

## Adding or changing a bundled skin

1. Add the ID to `skinSchema`, the catalog entry, and `skinGeometry`.
2. Keep artwork inside the 160×170 logical artboard and provide accurate painted bounds and anchors.
3. Reuse the semantic SVG part classes, or add a skin-specific rendering branch that implements every state.
4. Do not put capabilities, provider behavior, arbitrary routes, or executable code in a skin.
5. Run contract, desktop smoke, and character-animation checks. Visually inspect every state at actual desktop size.

Bundled skins are currently repository-owned React/SVG. A future installable skin format must be declarative and
versioned before third-party assets are accepted.

## Verification

`pnpm test:animation` launches Electron with an isolated profile, checks all six states on every bundled skin,
rejects an unknown provider-specific state at the preload boundary, and verifies reduced-motion behavior. It can
save Edi screenshots when `EDI_SHOT_DIR` is set. `pnpm test:desktop` covers skin selection, persistence, hit
regions, placement, and dragging.
