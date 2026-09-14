# Making an Edi character

A character is two files in a folder:

```
my-character/
├── character.json   who it is, its colors, and where things go
└── art.svg          the drawing, with every face it can make
```

Zip them into a `.edichar` file and anyone can add it in Edi under **Appearance → Add**. A character
is only a picture: it cannot run code, reach the internet or see anything on the computer.

The fastest start is to copy [`template/`](template) (a round character called Pip) and change it
step by step, checking as you go.

## 1. Check and try your character

From the Edi repository:

```
pnpm character check docs/characters/template
pnpm character pack docs/characters/template pip.edichar
```

`check` runs the same check Edi runs before installing, and lists every face your art has.
`pack` checks and then makes the `.edichar` file. Drop that file on Edi's Appearance page: before
anything is installed, you see your character in every mood.

## 2. The artboard

Draw on a 160 × 170 artboard: `viewBox="0 0 160 170"` in `art.svg`, and the same numbers in
`character.json` under `geometry.viewBox`. Keep everything inside it, shadow included.

## 3. Parts and faces

Edi changes a character's face by switching between groups in the SVG. A **part** is a group with
`data-part`; each face for that part is a child group with `data-variant`. Edi shows one variant per
part at a time.

```svg
<g data-part="mouth">
  <g data-variant="default">…resting mouth…</g>
  <g data-variant="talk">…open mouth…</g>
  <g data-variant="happy">…smile…</g>
</g>
```

Anything outside a part is always shown: the body, ears, a hat.

| Part     | Required | What it is                                              |
| -------- | -------- | ------------------------------------------------------- |
| `eyes`   | yes      | Needs a `default` variant.                              |
| `mouth`  | yes      | Needs a `default` variant. Add `talk` for speaking.     |
| `brows`  | no       | Leave out `default` if brows should only appear in moods. |
| `cheeks` | no       | Blush, for example.                                     |
| `extras` | no       | Props for a state, like a hand under the chin for `thinking`. |
| `effects`| no       | Your own floating effects. Without it, Edi adds hearts, z's and more. |

Inside the eyes, put whatever should glance around in a group with `data-part="pupils"`.

## 4. Which face shows when

You only draw the faces you want. When a variant is missing, Edi falls back to a close one, and
finally to `default`:

| Variant name | Shown when                                              | Falls back to |
| ------------ | ------------------------------------------------------- | ------------- |
| `talk`       | Edi is speaking (mouth opens with the voice)            | `default`     |
| `listening`, `thinking` | Edi is listening or working                  | `default`     |
| `attention`  | Edi wants your attention                                | `default`     |
| `happy`, `sad`, `surprised`, `confused`, `sleepy`, `annoyed` | the mood of a reply | `default` |
| `love`       | a warm, loving reply                                    | `happy`       |
| `laugh`, `chuckle` | the voice laughs                                  | `happy`       |
| `sigh`, `sniff` | the voice sighs or sniffs                            | `sad`         |
| `gasp`       | the voice gasps                                         | `surprised`   |
| `groan`      | the voice groans                                        | `annoyed`     |

Edi moves the whole character too (bouncing when happy, drooping when sad, tilting when confused),
so even a character with only `default` faces reacts.

## 5. character.json

```json
{
  "format": 1,
  "id": "com.yourname.pip",
  "name": "Pip",
  "version": "1.0.0",
  "description": "A round little starter character.",
  "author": { "name": "Your Name", "url": "https://example.com" },
  "license": "CC-BY-4.0",
  "colors": { "accent": "#2f6f8f", "outline": "#1f3b4d", "skin": "#bfe6f2" },
  "geometry": { "…": "see the template" },
  "motion": { "intensity": 1, "blink": true },
  "effects": true
}
```

- `id`: lowercase, like `com.yourname.pip`. Installing a character with the same id updates it.
- `name`: what the companion is called until the person gives it their own name.
- `colors.accent`: the card and bubbles take this color. `outline` and `skin` color the small
  gesture hands.
- `geometry.bodyPath`: the outline a person can grab and hold. Usually your body shape.
- `geometry.anchors`: where the card attaches (`workspace`), where the hands appear, and where
  speech bubbles point (`speechLeft`, `speechRight`). Effects float near the speech anchors.
- `motion.intensity`: 0.5 is calm, 1.5 is lively. Set `blink` to false for eyes without lids.

## 6. What SVG is allowed

Use plain shapes: `path`, `circle`, `ellipse`, `rect`, `line`, `polyline`, `polygon`, groups,
gradients, clip paths, masks and patterns, with colors set as attributes (`fill="#fff"`).

Edi removes, and `check` tells you about: scripts, `<style>` sheets and CSS classes, images, text
(convert it to outlines), filters such as blur (flatten them), links, animation, and any reference
to something outside the file. In Figma or Illustrator, export SVG with presentation attributes and
outlined text.

Limits: `art.svg` up to 512 KB, the package up to 2 MB.
