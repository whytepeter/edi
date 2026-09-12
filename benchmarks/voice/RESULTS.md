# Pocket TTS screening results

Measured 2026-09-11 on Apple M2 Pro (10 cores), 16 GB RAM, macOS 26.5.2. Pocket TTS 3.1.0, Python 3.13.2, Torch 2.14.0, two CPU threads, Alba voice, 24 kHz output. Both runs used cached, hash-verified assets with Hugging Face offline mode enabled. No paid API calls or other voice models were used.

| Measurement | Run 1: 18 utterances | Run 2: 6 utterances |
|---|---:|---:|
| Dependency import | 74.293 s | 3.909 s |
| Model load | 1.968 s | 1.666 s |
| Voice load | 4.7 ms | 5.1 ms |
| First-generation first PCM chunk | 298 ms | 242 ms |
| Warm median first PCM chunk | 103 ms | 79 ms |
| Warm maximum first PCM chunk | 514 ms | 245 ms |
| Median generation/audio duration ratio | 0.293 | 0.299 |
| Process lifetime peak memory | 706 MiB | 819 MiB |

Warm statistics exclude the first utterance (17 and 5 observations). Generation ratios include all utterances. A ratio of 0.299 means about 0.30 seconds of generation per second of output audio; it does not prove gap-free playback. Run 2 took 5.58 seconds from dependency import to model/voice readiness.

The first import delay is unexplained; the second run benefited from existing system caches. These are not controlled cold-boot measurements. A one-second process sample was collected during run 1, so that run also has possible profiling disturbance. This small screening test does not establish minimum hardware, tail latency, or a comparison with cloud providers.

## Product implications

Pocket remains the user-selected default. These measurements support proceeding with a local audio-runtime prototype on this Mac, not a claim about voice quality or production readiness. Keeping a warm model can avoid repeated startup cost, but its idle memory and energy cost still need measurement and a deliberate sleep/unload policy.

Next checks: listen for clarity/pronunciation and character fit; measure app speaker-start latency, cancellation, sustained playback, warm idle resources, and packaging. Local transcription and authorized cloud auditions are separate work. Milestone 0 remains open.

## Evidence and scope

- [Run 1 raw measurements](results/pocket-run-01/results.json), [greeting](results/pocket-run-01/greeting-0.wav).
- [Run 2 raw measurements](results/pocket-run-02/results.json), [greeting](results/pocket-run-02/greeting-0.wav).
- [Reproduction and interpretation](README.md), pinned dependencies in `pylock.toml`, asset sizes and hashes in `provision_pocket.py`.

Raw results and 24 generated WAV files are local, ignored artifacts; this report is the tracked summary. Dependency wheel upper bound plus downloaded assets is 423,342,903 bytes, including one unused earlier voice embedding; metadata and transport overhead are additional. This stays well below the approved 2 GB budget. No subjective listening score has been assigned.
