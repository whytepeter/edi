# Resource budget

Measured 2026-09-11 on **one Mac**: Apple M2 Pro (10 cores), 16 GB, macOS 26.5.2, built-in display only (1800×1169 points at 2×, 120 Hz). These numbers describe that machine. They are not a guarantee for any other Mac.

## Summary

- **Idle, the app is quiet.** With the card hidden, all five Edi processes together average **0.24–0.27% of one CPU core** across three runs, and 0.23–0.82% with the card pinned open. Chromium ran no layout or style work, no animation was running, and each visible window presented a single frame in 10 seconds. **No sustained repaint loop was found.**
- **Memory is about 155 MiB** by the measure Activity Monitor shows (physical footprint), or about 380–390 MiB if you add up each process's RSS, which counts shared framework pages several times.
- **Cold launch** to both windows ready takes about **0.4–0.6 s** (median of five per run); the first launch of a run took 0.9–1.3 s.
- **Dragging** costs about **10% of one core** on average across the drag phase, peaking near 24% in a one-second sample, mostly in the main process. That work stops when dragging stops.

| Scenario | Run 1 (package from `c7aa55b`) | Run 2 (later package, see note) | Run 3 (footprint) |
| --- | --- | --- | --- |
| Cold launch to both windows ready, median of 5 (first launch) | 601 ms (1,256 ms) | 603 ms (1,310 ms) | 424 ms (912 ms) |
| Summed RSS at ready, median | 524 MiB | 516 MiB | 527 MiB |
| Idle, card hidden, 3 min: summed RSS, median (p95) | 383 MiB (392) | 381 MiB (398) | 383 MiB (439) |
| Idle, card hidden: CPU, phase average | 0.24% | 0.25% | 0.27% |
| Idle, card hidden: CPU, 2 s samples, median / p95 | 0.12% / 0.62% | 0.13% / 0.41% | 0.14% / 0.45% |
| Card pinned open, 1 min: summed RSS, median (p95) | 388 MiB (399) | 376 MiB (384) | 393 MiB (427) |
| Card pinned open: CPU, phase average | 0.23% | 0.50% | 0.82% |
| 20 pet drags: summed RSS, median (p95) | 433 MiB (440) | 328 MiB (345) | 426 MiB (437) |
| 20 pet drags: CPU, phase average / 1 s p95 | 10.8% / 24.2% | 9.3% / 15.6% | 10.1% / 14.7% |
| Physical footprint after idle / card / drags | not measured | not measured | 156 / 149 / 155 MiB |
| Idle repaint loop | none | none | none |

CPU is per core, as in Activity Monitor: 100% means one core fully busy. This Mac has 10 cores.

**Host load caveat:** these runs shared the Mac with other work. Another Claude session was building and testing Edi in the same checkout, and the user may have had `pnpm dev` running. The figures above count only Edi's own processes, but contention on the host can still nudge them, especially the idle CPU numbers, which are tiny.

Run 1 is the formal record: a package built from a clean commit. Runs 2 and 3 used a later package built from the working tree at `0688522`. That tree already had `ed046f9` (screen context on each request) plus another session's uncommitted contracts changes for voice. Neither changes what happens while idle or dragging: screenshots are only taken when a request starts, and no request is sent here. They are included to show run-to-run variation, and run 3 adds the footprint measurement. The last minute of run 2 (its drag phase) overlapped another session's desktop and transcription tests on the same Mac, so treat those two cells with care. Run 3 did not overlap them.

## Per process (run 1)

RSS medians and phase-average CPU. Electron's own working-set figure matched `ps` RSS to within 1 MiB.

| Process | Idle, card hidden | Card pinned open | During drags |
| --- | --- | --- | --- |
| Main (Node, windows, SQLite) | 117 MiB · 0.14% | 120 MiB · 0.17% | 131 MiB · 7.61% |
| GPU | 64 MiB · 0.02% | 65 MiB · 0.03% | 77 MiB · 0.63% |
| Pet renderer | 81 MiB · 0.03% | 80 MiB · 0.02% | 92 MiB · 2.02% |
| Card renderer (hidden in the first column) | 85 MiB · 0.04% | 85 MiB · 0.00% | 98 MiB · 0.52% |
| Network service | 36 MiB · 0.01% | 36 MiB · 0.02% | 37 MiB · 0.00% |

Footprint per process after the idle phase (run 3): GPU 49 MiB, main 42 MiB, card renderer 36 MiB, pet renderer 25 MiB, network service 7 MiB.

Idle wakeups across all processes had a median of 2 per second with the card hidden, and 1 per second with it pinned open. The highest single idle sample was 6.2% of one core, once in 3 minutes. It was a lone spike, not a pattern. The 95th percentile stayed under 0.7%.

## Idle repaint check

For each idle phase the script looks for a repaint loop in three independent ways:

1. **Frames presented.** It subscribes to each visible window's frames for 10 seconds, after the CPU samples so the capture cost can't skew them. Each window presented exactly **1 frame**, consistent with the one frame a new subscription receives. A loop running at even 1 fps would show about 10.
2. **Running animations.** `document.getAnimations()` in each visible window found **none**. The infinite animations in the stylesheet (thinking dots, listening bars, the step-list pulse) belong to states that were not active.
3. **Chromium counters.** Over the phase, the DevTools Performance domain recorded **0 layouts and 0 style recalculations** in run 1 (4 in run 2's card phase and 51 in run 3's, still with no extra frames), and a few milliseconds of total task time.

Target from the roadmap: no sustained repaint loop while idle. **Met on this host.**

## Drag phase details

Twenty drags of 160 × 60 points, alternating up-left and back. Each drag sends 30 `pet-drag` commands about 16 ms apart, close to a 60 Hz pointer, and takes about 0.6 s. The first ten ran with the card pinned (card stays), the last ten unpinned (card follows the pet, so two windows move). All 20 moved the pet. The command round trip from the pet renderer to the main process and back had a median of 2.6 ms, p95 5.8 ms, and a maximum of 76 ms (one outlier in 600).

The commands are injected by Playwright into the pet renderer, which adds some cost that a real pointer doesn't have. The phase includes 250 ms pauses between drags, so the average understates the cost while actively dragging; the 1-second p95 is closer to that.

## Voice runtimes (cited, not re-run)

These were measured earlier as standalone processes, outside the app. Commit `c501449` wires them into the development app for hold-to-talk. They are not bundled in the package yet, so none of the runs above loaded them.

| Runtime | Measured | Peak memory | Speed | Source |
| --- | --- | --- | --- | --- |
| Pocket TTS 3.1.0 (Alba, 2 CPU threads) | 24 utterances, 2 runs | 706 and 819 MiB (process lifetime peak) | Warm first audio 79–103 ms median; generation takes 0.29–0.30 s per second of audio | [RESULTS.md](../benchmarks/voice/RESULTS.md) |
| whisper.cpp base.en + Silero VAD (4 CPU threads) | 6 synthetic speech files + silence | 298 MiB peak RSS | 0.73 s median per file including model load; 0.098 s per second of audio | [TRANSCRIPTION.md](../benchmarks/voice/TRANSCRIPTION.md) |

Pocket's first dependency import once took 74 s for an unexplained reason. Its model load is about 2 s.

## Minimum hardware (provisional)

### Verified

Only this one Mac: M2 Pro, 16 GB, macOS 26.5.2, one built-in Retina display at 120 Hz. On it, the desktop shell idles at well under 1% of one core, uses roughly 155 MiB by physical footprint, and launches in about 0.6 s. Pocket and whisper each ran faster than real time.

### What the evidence implies

- **Memory.** Worst case, with Edi, Pocket and whisper all resident at their measured peaks: about 155 MiB + 819 MiB + 298 MiB ≈ 1.2 GiB (up to about 1.5 GiB using summed RSS for Edi). On a 16 GB Mac that is under a tenth of memory. On an 8 GB Mac it is roughly a sixth to a fifth, which is likely workable alongside a browser but leaves little margin. The voice peaks are standalone maximums, and a real conversation listens and speaks in turn, so they won't always peak together.
- **CPU.** Pocket used two threads and whisper four, and both had 3× or more headroom over real time on M2 Pro performance cores. An M1 has four performance cores that are somewhat slower per core. Both would probably still run faster than real time there, with less margin, but that is an inference, not a measurement.
- **Idle cost.** The shell's idle cost is tiny, and memory rather than CPU will set the floor.

### Not verified

- Any lower-end Mac: no M1, no 8 GB machine, no base-model chip. No Intel Mac; the package is arm64 only.
- Any macOS other than 26.5.2.
- External, non-Retina or 60 Hz displays, or more than one display.
- Hours-long idle, sleep and wake, or memory growth over days.
- Energy use (no `powermetrics` run).
- Voice inside the app: packaged Pocket and whisper, warm-retained model memory, and speaker latency.
- A live model request, and the per-request screen capture added in `ed046f9`.

### Provisional minimum

> **Provisional, pending tests on lower-end hardware:** a Mac with **Apple silicon (M1 or newer)**, **8 GB of memory**, and **macOS 12 Monterey or newer**. **16 GB is recommended** when local voice (Pocket and whisper) is turned on.

The macOS 12 floor is what the package declares (`LSMinimumSystemVersion` 12.0, from Electron 42). Only macOS 26.5.2 was run. The app takes 326 MB on disk. Local voice would add roughly half a gigabyte or more once packaged: Pocket's dependencies and assets came to 423 MB, and the whisper downloads (models plus build tools) to 213 MB, before any bundled Python runtime.

To confirm or revise this: repeat `node tests/perf/resources.mjs` and the two voice benchmarks on an 8 GB M1 MacBook Air, with a browser open, and watch memory pressure and swap.

## Caveats

- One host, one day. Two full runs of the clean package would be better than one; runs 2 and 3 were on a later build.
- The Mac was not quiet: other apps (Cursor, Claude, Figma) were running.
- The Playwright harness stays attached (inspector and DevTools protocol). It reads metrics through the main process every 2 s, and that small cost is included in the main-process figures.
- "Cold" means a fresh process and a fresh profile. The OS file cache was warm, and the first launch after packaging had already happened in the smoke test.
- RSS and Electron's working set count shared pages in every process, so their totals overstate unique memory. Footprint counts shared pages once.

## Reproduce

From `edi`:

```sh
pnpm package
node tests/perf/resources.mjs
```

It takes about six minutes, uses a temporary profile, needs no API key and makes no network requests. It prints a summary and writes raw JSON to `tests/perf/results/`, which is ignored by git. `--quick` runs short phases for checking the script itself.
