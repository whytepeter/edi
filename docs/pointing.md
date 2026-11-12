# Pointing, drawing and the speech bubble

The presentation layer adds temporary annotations over one display. It never clicks, types, or changes another app.

Screen context is privacy-gated before capture. Generic conversation is sent without a screenshot. Edi captures current displays when the prompt refers to visible UI—for example, “what’s on my screen?”, “read this error,” or “which button should I click?” Short follow-ups during that visual conversation (“Better?”, “What changed?”) capture again. Ambiguous openers such as “what is this?” stay text-only, and a new non-visual request ends the visual context.

Replies may end with up to six `POINT` or `DRAW` tags. Contracts parse these into fixed shapes, reject invalid coordinates and map screenshot pixels into logical desktop coordinates.

### Alignment with what is really on screen

Models estimate positions roughly on a screenshot scaled to 1280 pixels, where 13-point interface text is about 9 pixels tall; misses of 20–40 image pixels are normal. Edi corrects this locally:

1. ScreenCaptureKit captures each display at full resolution. The JPEG for the model is downscaled from that same image, so both share one geometry.
2. Apple Vision recognizes text on the full-resolution image in the background (about half a second on an M-series Retina display) while the model answers. Results are line and word boxes held in main's memory for that run only; they are never sent to a provider or stored.
3. When the reply finishes, `groundPresentation` matches each tag's label to recognized text within 12% of the image diagonal of where the model aimed, and fits the shape to that text: points go to its center, boxes pad it, underlines sit under it, arrows stop just outside it, and a circle around wide text becomes an ellipse. It waits at most 1.5 seconds for recognition and otherwise keeps the model's coordinates.
4. The prompt asks for the target's exact visible text as the label so this matching works. Icons and other targets without text keep the model's coordinates.

On the Retina fixture in `tests/fixtures`, real Vision recognition moves typical model misses from a mean of 25.3 to 1.4 image pixels (`pnpm test:grounding:native`). `pnpm test:pointer:visual` renders the overlay over that fixture before and after alignment and checks where the hand comes to rest. Main passes the resolved script to a click-through window. The renderer traces fixed SVG paths with the selected skin's hand; it never renders model-provided markup. Circles, ellipses (from alignment), boxes, arrows and underlines are supported, not free-form illustrations yet. Every finished shape keeps its label under the target. After pointing, the hand settles just below the target, pointing up (or above it near the bottom edge), so it never covers what it points at.

Before pointing, Edi checks what is in front again: if the person has moved to another app, or another page in the same browser, since asking, it does not point (the positions would land on something else) and says so under the answer. A changed window title alone does not count. The overlay stays while Edi is still speaking or showing the answer it belongs to, for at most 45 seconds, and otherwise leaves after a few seconds; it is destroyed when replaced or stopped. Reduced-motion users see immediate drawing rather than progressive tracing.

Edi's answer appears in the bubble beside the character as it is written (tags removed), with what Edi is doing under it, an **Open** button for the whole conversation and a field to reply; it lingers long enough to read and hear, then leaves. The bubble also shows live listening, thinking, and speaking animation. When a capability needs approval, the same surface becomes a compact action card with a validated summary, a request-specific approve/deny action, and **View details** for the full review in the content card. Its isolated preload exposes only these: answer an approval or suggestion, read the answer on show, send a reply, open a link, open content, and reveal the conversation. It cannot change settings or access native APIs.

The character itself receives only semantic state: an expression (idle, listening, thinking, speaking, happy, attention), a mood, and cues timed to the voice. These are validated at the preload boundary and remain independent of the active voice provider. Every character package implements the same parts-and-variants contract; reduced motion keeps the face while removing movement. See `docs/characters.md`.

## Verification

- `pnpm test:grounding:native`: real Vision recognition on the Retina fixture in `tests/fixtures`.
- `pnpm test:pointer:visual`: renders the overlay over that fixture before and after alignment and checks where
  the hand comes to rest.

The capture path needs Screen Recording, so alignment on a real desktop, mixed-scale displays, content that
scrolls while the model answers and interruption mid-drawing are in the [manual checks](manual-checks.md).
