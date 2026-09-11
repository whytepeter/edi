# Milestone 0 validation

Updated 2026-09-11.

## Verified

The refreshed unsigned package also passes the drag/pointer, pin-follow, cancellation, and saved-position restart suite using an isolated temporary profile. No live provider requests are made by that suite.

Unsigned Apple Silicon app produced at `apps/desktop/release/mac-arm64/Edi.app`, using the installed Electron runtime. Packaged smoke tests passed with a temporary profile and no development server: independent windows, hidden card at startup, expand/collapse, skin and pin persistence, extension filtering, content previews, malformed-video fallback, OpenRouter setup, rejection of requests without credentials, and no renderer errors.

The user separately confirmed live OpenRouter responses work. Packaged live-worker and credential migration checks remain pending; no paid requests or real keys were used in the packaged smoke test.

Test host: Apple M2 Pro, 16 GB RAM, macOS 26.5.2. This is not a minimum-hardware claim.

## Open gates

Local transcription baseline completed: pinned whisper.cpp/base.en + Silero VAD, 14 offline checks on synthetic Pocket audio and silence. VAD speech-file median process time 0.732 s including load, peak RSS 298 MiB on M2 Pro. Silence was empty with VAD but hallucinated “You” without it. [Full evidence and limitations](../benchmarks/voice/TRANSCRIPTION.md). Human speech, microphone noise, streaming endpointing, production permission/session wiring and minimum hardware remain open.

Latest gesture/menu verification: 350 ms stationary hold selects push-to-talk request; release closes its unavailable status without opening conversation or content. Native hold/release and existing drag smoke tests pass. Custom renderer menu replaces the native right-click popup; initial focus, arrow navigation, Escape dismissal and full menu bounds pass. The small borderless side pill and menu screenshots were visually checked. Actual mic capture, VAD, follow-up sessions, release-to-submit and global key-release PTT remain pending. The global shortcut currently requests conversation only.

Character interaction update: click and Command–Shift–E now share the listen-request path; Show content is a context-menu action. The native menu also has Stop, Sleep and Quit. Sleep hides pet/card and stops the current text run while leaving the shortcut registered. A separate, non-focusable status bubble follows the pet without enlarging its hit region. Native checks verify click keeps content hidden, unavailable status is truthful, Show content opens the card, Sleep hides it, Listen wakes without opening content, workspace IPC cannot invoke pet-only commands, and Stop removes the bubble. Shortcut registration is tested; physical key delivery and right-click menu selection still need manual checks. Existing desktop smoke tests pass.

The bubble's listening-bars variant has reduced-motion support but is not selected in production until microphone capture is implemented. No microphone access or spoken greeting was added. The status-bubble screenshot was visually checked; the packaged app has not been refreshed for this interaction change.

- Validate moving/pointing hands and physical display changes. Workspace placement now consumes skin anchors; motion during presentation remains pending.
- Manual click-through, focus/dismissal, dragging, stacking, Retina coordinates, Spaces/fullscreen, display changes, and capture permission behavior.
- Pocket screening is complete; app playback, interruption, listening assessment, local transcription, and comparable cloud auditions remain open. Additional downloads and paid auditions require explicit scope.
- Minimum hardware and idle resource budget based on measurements.

The app is unsigned, not notarized, and uses the default Electron icon. Local development testing only; unsigned builds may trigger Keychain prompts.

## Local voice evidence

Pocket TTS 3.1.0 with Alba completed two offline runs (24 utterances). Warm median first PCM was 103 ms and 79 ms; median generation/audio ratios were 0.293 and 0.299. Peak process memory was 706 and 819 MiB. Second startup-to-ready was 5.58 seconds; the first dependency import alone took 74.29 seconds for an undetermined reason. These are Python generation measurements, not speaker latency or quality scores. See [the benchmark report](../benchmarks/voice/RESULTS.md) for evidence, scope, and caveats.

Pocket is the requested default; ElevenLabs and Cartesia remain optional cloud providers. Settings/provider setup and the character Sleep/Quit menu are documented requirements, not completed UI.

The isolated PCM player now passes lifecycle tests and a muted Electron playback check using saved Pocket audio: zero scheduling gaps, stale-run rejection, cleared queued sources, graph silence after Stop, and device disposal. It is not yet wired to live model output. See [audio runtime evidence](AUDIO-RUNTIME.md); acoustic latency and long-running playback remain unmeasured.

Live Pocket streaming now also passes through the player in the isolated integration harness: 44 frames, zero scheduling gaps, first PCM in 7.46 seconds including model startup, and worker exit 45.6 ms after cancellation. Nine audio tests cover the player and process supervisor. Production IPC, warm retention and packaged model/runtime setup remain pending; this is not yet user-facing speech.

## Skin geometry evidence

Desktop dragging now has a dedicated renderer component and native controller. A 6-logical-pixel threshold separates clicks from drags; the original grab offset is preserved. Pointer capture keeps receiving movement outside the painted body. Escape, lost capture, blur, renderer exit, and display changes cancel or recover the gesture. Only the pet renderer can issue drag commands; movement is clamped to the target display. Old settings migrate with a null position; successful drops persist coordinates using the existing atomic preference writer.

Automated native tests pass for an injected browser pointer drag without opening the card, sub-threshold movement, wrong-pointer rejection, cancellation, pinned/unpinned card behavior, workspace rejection of drag commands, and position restoration after restart. Physical cross-app click-through and mixed-display drag behavior remain manual checks. No wandering, perching, emotional animation, or external cursor control was added.

Anchor-based card placement passes the native development-app test on the current host, including the 112×120 avatar window. Pure tests cover edge flipping, small displays, and negative display origins. Pinned placement and display-change recovery are implemented; physical monitor removal and cross-app behavior still need manual checks.

Cloud and Sprout now declare a versioned logical viewBox, painted bounds, body/decorative paths, workspace anchor, and left/right hand anchors in `packages/contracts/src/skin-geometry.ts`. The renderer consumes these values; hands use local paths translated from their anchors. SVG painted paths remain the hit regions, avoiding a duplicate approximate hit map. The shadow is excluded.

Contract tests reject invalid bounds/anchors and check centered scaling with negative screen origins. Native SVG tests verify both silhouettes fit declared bounds with stroke padding, hand translations match anchors, body points are interactive, and margin/shadow points are not. These are renderer hit tests, not proof of click-through into another macOS app or mixed-display correctness. No pointing/drawing behavior was added in this step.

## Reproduce

From `edi`, after `pnpm setup:electron`:

```sh
pnpm package
EDI_TEST_EXECUTABLE="$PWD/apps/desktop/release/mac-arm64/Edi.app/Contents/MacOS/Edi" pnpm test:desktop
```
