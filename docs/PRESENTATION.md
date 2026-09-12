# Edi's hand and speech bubble

The presentation layer adds temporary annotations over one display. It never clicks, types, or changes another app.

Screen context is privacy-gated before capture. Generic conversation is sent without a screenshot. Edi captures current displays when the prompt refers to visible UI—for example, “what’s on my screen?”, “read this error,” or “which button should I click?” Short follow-ups during that visual conversation (“Better?”, “What changed?”) capture again. Ambiguous openers such as “what is this?” stay text-only, and a new non-visual request ends the visual context.

Replies may end with up to six `POINT` or `DRAW` tags. Contracts parse these into fixed shapes, reject invalid coordinates and map screenshot pixels into logical desktop coordinates. Main passes the resolved script to a click-through window. The renderer traces fixed SVG paths with the selected skin's hand; it never renders model-provided markup. Circles, boxes, arrows and underlines are supported, not free-form illustrations yet.

The overlay expires automatically and is destroyed when replaced or stopped. Reduced-motion users see immediate drawing rather than progressive tracing.

Ordinary reply text stays in the conversation card and never streams into the character bubble. The bubble shows live listening, thinking, and speaking animation. When a capability needs approval, the same surface becomes a compact action card with a validated summary, a request-specific approve/deny action, and **View details** for the full review in the content card. Its isolated preload exposes only those approval actions; it cannot ask the agent, change settings, or access native APIs.

## Verification still needed

Check fingertip alignment for both skins, tracing across several shapes, negative-origin displays, reduced motion, edge placement and interruption during drawing. Verify speaking animation and that Sleep leaves no overlay. The synthetic native approval check verifies compact layout, arming and response without a live tool call; a packaged approval flow still needs a manual check.
