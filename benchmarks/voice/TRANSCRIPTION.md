# Local transcription screening

Scope: whisper.cpp v1.9.4, English `base.en`, Silero VAD v6.2.0. User approved local-only setup up to 1 GB. No cloud calls, physical microphone access, or additional speech models.

The test uses six existing Pocket Alba samples and three seconds of digital silence. Each sample is resampled to mono 16 kHz PCM16 before timing. It runs once without VAD and once with VAD; each process reloads the model. This is a CPU baseline with four threads, not a warm service or streaming end-of-turn test. Synthetic speech does not establish accuracy for the user's accent, background noise or microphone.

## Results — 2026-09-11

Completed on Apple M2 Pro / 16 GB, CPU + Accelerate, four threads. Source is the v1.9.4 release tag's pinned commit; its build reports `1.9.4-dev`. Metal is disabled for this baseline.

| Six speech samples | Whisper alone | Whisper + Silero VAD |
|---|---:|---:|
| Median process time, including model load | 0.663 s | 0.732 s |
| Median process/audio duration ratio | 0.090 | 0.098 |
| Maximum process peak RSS | 294 MiB | 298 MiB |

The speech samples range from 3.76 to 16 seconds. This is one run per configuration, with OS caches not controlled. It does not measure time from the user's last spoken word to an answer. [Raw transcripts and measurements](results/transcription-02/summary.json).

Observed text issues: Edi became Eddy/Eddie, and Fewer Labs lost capitalization. The plain status transcript contained extra “I” fragments; the VAD version matched the intended wording. OAuth, API, MCP, Lagos, Abuja and naira were retained in these synthetic samples. Dates and percentages changed formatting. Do not silently apply broad text substitutions to hide recognition errors; evaluate a small vocabulary prompt separately.

The separate three-second digital-silence control returned **“You” without VAD** and an empty transcript with VAD. Keep a speech gate before transcription/submission; never route an unverified silence transcript into an agent command. One silent fixture does not prove robust rejection of noise, music, breathing or quiet speech.

Downloaded assets total **212,613,672 bytes**, plus metadata/transport overhead, below the approved 1 GB cap. This includes the models, source archive and isolated CMake tool. Nothing was installed system-wide. The first run is retained in `results/transcription-01`: recognition succeeded, but the sandbox denied the macOS resource counter used by the measurement wrapper. The completed second run used approved resource-counter access. Six fixture/unit tests pass.

Next: bounded native transcription supervision, decode captured WebM to PCM16, real-time VAD turn handling, and explicit microphone permission/session integration. Keep the unavailable UI until those paths work together. No human microphone accuracy or live VAD latency claim yet.

## Reproduction

`provision_transcription.py` pins the model revisions, SHA-256 hashes, CMake wheel and whisper.cpp source commit. Models and the build tool are hash-checked against published metadata. The source archive's digest was recorded from the commit-specific official download and is now pinned for reuse. Downloads have per-file caps and no automatic retries. Partial files require review before retrying.

Source commit: `927cfce34f31707e17f2bff35c349632fb9e2c3a`. Build only the local CLI with Metal, server, download support and third-party network services disabled. This initial setup is development-only, not a packaged app dependency.

After building, from the Edi root:

```sh
sh benchmarks/voice/build_transcription.sh
benchmarks/voice/mlx-venv/bin/python -m unittest discover -s benchmarks/voice -p 'test_*.py'
benchmarks/voice/mlx-venv/bin/python benchmarks/voice/transcription_benchmark.py --output benchmarks/voice/results/transcription-01
```

Use a new results directory for every run. JSON transcripts, process logs and summary measurements stay in the ignored results folder. Word-error scores are intentionally omitted: numbers, punctuation and proper-name spellings need an explicit normalization policy before scoring.

The base model is not a final accuracy choice. Inspect transcripts, especially Edi, Fewer Labs, Nigerian place names and technical abbreviations, before deciding whether this size is adequate. Silence must not be treated as a valid user command. VAD batch segmentation does not establish real-time turn detection or barge-in behavior.

Sources: [whisper.cpp](https://github.com/ggml-org/whisper.cpp), [model inventory](https://github.com/ggml-org/whisper.cpp/blob/master/models/README.md), [VAD download definitions](https://github.com/ggml-org/whisper.cpp/blob/master/models/download-vad-model.sh).
