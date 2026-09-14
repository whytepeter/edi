# Voice runtimes

Local speech runs on MLX: Kokoro 82M (the default) and Chatterbox Turbo 4-bit. `provision_mlx.py` is the explicit
network step. It pins mlx-audio, the text front-end packages and each model revision, and installs into the ignored
`mlx-venv/` and `cache/mlx/`. Cartesia and ElevenLabs are optional cloud voices that use the person's own keys.

Transcription (whisper.cpp) is provisioned by `provision_transcription.py` and `build_transcription.sh`; see
[TRANSCRIPTION.md](TRANSCRIPTION.md).

## History

Pocket TTS (Kyutai) was the first local voice and was measured in the runs recorded in [RESULTS.md](RESULTS.md).
It was removed on 2026-09-14 after Kokoro became the default. The PyTorch Chatterbox environment was removed at the
same time, because it was 1.3–1.9× slower than real time on an M2 Pro, and the MLX build replaced it. The
`results/pocket-run-*` samples stay as fixed audio inputs for the playback and transcription tests.

## What measurements mean

- Import, model load, and voice load are separate. First generation is not a cold OS cache measurement.
- First chunk means PCM became available to the worker, not sound heard from the speaker.
- Real-time factor is generation time divided by audio duration; lower is faster.
- Compare engines only after equal runs with recorded versions, hardware and voice licenses.
