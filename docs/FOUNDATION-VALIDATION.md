# Milestone 0 validation

Updated 2026-09-11.

## Milestone 0 status

Exit criteria from the roadmap: packaged launch, independent pet and workspace windows, a measured voice/runtime recommendation, and a documented minimum Mac. **Milestone 0 is not closed.** Every gate that can be automated has now been run. The rest need a person, paid provider access, or features that aren't built.

### Closed

| Gate | Evidence |
| --- | --- |
| Packaged launch | Unsigned arm64 package passes the Playwright smoke suite, including restart and the SQLite history. [Packaged launch](#packaged-launch--2026-09-11) |
| Independent pet and workspace windows | Same packaged run: two windows, card hidden at launch, anchor placement, drag with pinned and unpinned card, restart restore. |
| Skin contract with two silhouettes | Cloud and Sprout geometry, hit regions and workspace anchor pass contract and renderer tests. [Skin geometry](#skin-geometry-evidence) |
| Idle resource budget, no repaint loop | Idle about 0.25% of one core, about 155 MiB physical footprint, no repaint loop in three runs. [Resource budget](RESOURCE-BUDGET.md) |
| Local voice runtimes measured | Pocket TTS and whisper.cpp + Silero VAD, standalone. [Pocket](../benchmarks/voice/RESULTS.md), [transcription](../benchmarks/voice/TRANSCRIPTION.md) |
| Minimum Mac documented | **Provisional:** Apple silicon, 8 GB, macOS 12 or newer; 16 GB recommended for local voice. Verified on one M2 Pro only. [Minimum hardware](RESOURCE-BUDGET.md#minimum-hardware-provisional) |

### Still open

| Gate | Why it's open |
| --- | --- |
| Manual desktop checks | Click-through, focus, drag, stacking, Spaces and fullscreen, displays, mixed Retina, menu actions, shortcut, capture permission and one note save. Only a person can do these. **Waiting on the user:** [manual checks](MANUAL-CHECKS.md). |
| Cloud voice auditions (ElevenLabs, Cartesia) | These need the user's own keys and paid calls, so they were not run. The voice recommendation stays provisional (Pocket local by default) until they are done or explicitly dropped. |
| Voice listening assessment | Nobody has listened to Pocket's output and judged clarity or character fit yet. Needs a person. |
| Voice in the app | Commit `c501449` wires hold-to-talk in the development app. Nobody has done a real spoken turn with a physical microphone yet, and the voice runtimes are not bundled in the package. |
| Hand pointing and drawing | Not built. Only static hand anchors exist. |
| Minimum hardware on lower-end Macs | No M1 or 8 GB Mac tested, so the minimum stays provisional. |

## Verified

### Packaged launch — 2026-09-11

Rebuilt from commit `c7aa55b` with `pnpm package` (Electron 42.11.3, arm64, unsigned because `build.mac.identity` is `null`). The packaged smoke suite passed on the first run with a temporary profile and no development server:

```
EDI_TEST_EXECUTABLE="$PWD/apps/desktop/release/mac-arm64/Edi.app/Contents/MacOS/Edi" pnpm test:desktop
PASS: hidden card at launch, two windows, avatar sync/persistence, pin persistence, extension search, expand/collapse, no renderer errors.
```

What that run covers, inside the packaged app:

- Two independent windows (pet and card). The card is hidden at launch and placed against the pet's workspace anchor.
- Cloud and Sprout SVG bounds and hit regions. These are renderer hit tests, not macOS click-through.
- The OpenRouter setup form (password field). A request with no saved credentials is rejected. The pet window cannot change settings.
- Skin switching, pinning, extension search, expand/collapse.
- A native pointer drag that leaves the card closed. Drag commands: the 6 px threshold, wrong-pointer rejection, cancel restoring the position, a pinned card staying put, and an unpinned card following. The card window cannot send drag commands.
- A restart that restores the pet position, skin and pin. No renderer errors across both launches.
- **SQLite history in the packaged main process.** The profile contained `edi.sqlite` with the `runs`, `tool_calls` and `notes` tables, schema version 1, in WAL mode. Both launches ran the startup recovery (`recoverInterrupted`) on that file. Recovery only ran on an empty history here. Recovering a genuinely interrupted run is covered by `packages/storage` tests, not by the package.

Not covered by the packaged run: a live model request, credential migration, the notes tool and approval card, the status bubble and custom menu (`pnpm test:character` runs against the development app only), and anything that needs a person at the Mac (see [manual checks](MANUAL-CHECKS.md)). No paid requests or real keys were used. The user separately confirmed live OpenRouter responses in the development app.

A later package, built from the working tree at `0688522` (which includes `ed046f9`, screen context) plus another session's uncommitted contracts changes, also passed the same smoke suite. Its packaged main process applied the new migration: schema version 2, with the `runs.screens` column. Commit `c501449` (hold-to-talk) landed afterwards and has not been packaged or smoke-tested here.

Test host: Apple M2 Pro, 16 GB RAM, macOS 26.5.2. This is not a minimum-hardware claim; see the [resource budget](RESOURCE-BUDGET.md).

## Open gates

Local transcription baseline completed: pinned whisper.cpp/base.en + Silero VAD, 14 offline checks on synthetic Pocket audio and silence. VAD speech-file median process time 0.732 s including load, peak RSS 298 MiB on M2 Pro. Silence was empty with VAD but hallucinated “You” without it. [Full evidence and limitations](../benchmarks/voice/TRANSCRIPTION.md). Human speech, microphone noise, streaming endpointing, production permission/session wiring and minimum hardware remain open.

Latest gesture/menu verification: 350 ms stationary hold selects push-to-talk request; release closes its unavailable status without opening conversation or content. Native hold/release and existing drag smoke tests pass. Custom renderer menu replaces the native right-click popup; initial focus, arrow navigation, Escape dismissal and full menu bounds pass. The small borderless side pill and menu screenshots were visually checked. Actual mic capture, VAD, follow-up sessions, release-to-submit and global key-release PTT remain pending. The global shortcut currently requests conversation only.

Character interaction update: click and Command–Shift–E now share the listen-request path; Show content is a context-menu action. The native menu also has Stop, Sleep and Quit. Sleep hides pet/card and stops the current text run while leaving the shortcut registered. A separate, non-focusable status bubble follows the pet without enlarging its hit region. Native checks verify click keeps content hidden, unavailable status is truthful, Show content opens the card, Sleep hides it, Listen wakes without opening content, workspace IPC cannot invoke pet-only commands, and Stop removes the bubble. Shortcut registration is tested; physical key delivery and right-click menu selection still need manual checks. Existing desktop smoke tests pass.

The bubble's listening-bars variant has reduced-motion support but is not selected in production until microphone capture is implemented. No microphone access or spoken greeting was added. The status-bubble screenshot was visually checked. The 2026-09-11 package includes this interaction change, but the bubble and menu tests run against the development app only.

- Validate moving/pointing hands and physical display changes. Workspace placement now consumes skin anchors; motion during presentation remains pending.
- Manual click-through, focus/dismissal, dragging, stacking, Retina coordinates, Spaces/fullscreen, display changes, and capture permission behavior. Now a numbered checklist: [manual checks](MANUAL-CHECKS.md).
- Pocket screening is complete; app playback, interruption, listening assessment, local transcription, and comparable cloud auditions remain open. Additional downloads and paid auditions require explicit scope.
- ~~Minimum hardware and idle resource budget based on measurements.~~ Measured on this host; the minimum is provisional. See [resource budget](RESOURCE-BUDGET.md).

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
