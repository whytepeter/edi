# Edi's hand and speech bubble

The presentation layer adds temporary annotations over one display. It never clicks, types, or changes another app.

Replies may end with up to six `POINT` or `DRAW` tags. Contracts parse these into fixed shapes, reject invalid coordinates and map screenshot pixels into logical desktop coordinates. Main passes the resolved script to a click-through window. The renderer traces fixed SVG paths with the selected skin's hand; it never renders model-provided markup. Circles, boxes, arrows and underlines are supported, not free-form illustrations yet.

The overlay expires automatically and is destroyed when replaced or stopped. Reduced-motion users see immediate drawing rather than progressive tracing.

The speech bubble receives bounded text through a separate, receive-only preload. It has no command API. Streaming updates reuse the window. Presentation tags are hidden while incomplete as well as after parsing. The full response remains available in the content window; the bubble is a brief preview, not a replacement for it.

## Verification still needed

Check fingertip alignment for both skins, tracing across several shapes, negative-origin displays, reduced motion, edge placement, long text and interruption during drawing. Verify spoken replies retain their bubble and Sleep leaves no overlay. The unit suites and production build pass; this change has not yet been visually verified in a packaged build.
