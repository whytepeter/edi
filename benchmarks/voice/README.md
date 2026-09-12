# Voice audition

Current scope: Pocket TTS locally; ElevenLabs and Cartesia later with separate credentials and paid-use approval. Pocket is the product default, not yet a performance guarantee.

Two offline runs are complete: [measured results and remaining checks](RESULTS.md).

The six-line corpus covers a greeting, status, technical vocabulary, numbers, names, and a longer explanation. Use the same lines for every provider. Listening scores are separate from speed: clarity, pronunciation, naturalness, emotional fit, and consistency. A model being fast does not make it the right voice.

## Reproduce the local test

Python 3.13, Apple Silicon. Dependency versions, wheel sizes, and hashes are recorded in `pylock.toml`. The isolated environment and model cache are ignored by git. Do not reuse app API credentials for this benchmark.

```sh
python3 pocket_benchmark.py --dry-run
python3 -m unittest discover -s . -p 'test_*.py'
# After approved provisioning, from the edi root:
benchmarks/voice/.venv/bin/python benchmarks/voice/pocket_benchmark.py --output benchmarks/voice/results/pocket-run-01
```

The measurement runner disables Hugging Face network access. Missing assets fail rather than downloading during a timed run. `provision_pocket.py` is the explicit network step: it fetches only a pinned public checkpoint, tokenizer, and voice embedding, verifies sizes and SHA-256 hashes, and refuses to overwrite files or retry partial downloads silently.

The approved budget is 2 GB for Pocket and dependencies, no paid calls. Dependency wheel upper bound: 191,865,520 bytes; currently pinned assets: 239,195,519 bytes. Allow for metadata traffic. Alba and Fantine remain cached for historical benchmark reproduction; Jane is the current product default. Model and voice revisions are distinct and recorded in results.

## What the results mean

- Import, model load, and voice load are separate. First-generation is not a cold OS cache measurement.
- First chunk means PCM became available to Python—not sound heard from the speaker.
- Real-time factor is generation time divided by audio duration; lower is faster.
- CPU time is process CPU time. RSS is the process lifetime peak, not per-request memory growth.
- Samples are saved after timed generation. File writing/playback latency is excluded.
- Three corpus passes are a screening run, not a statistically robust production benchmark. Compare providers only after completing equal runs and recording versions, hardware, and voice licenses.

App playback start/stop latency, sustained playback gaps, microphone transcription, warm model lifecycle, packaging overhead, and subjective listening still need separate acceptance checks.

Sources: [Pocket TTS](https://github.com/kyutai-labs/pocket-tts), [streaming implementation](https://github.com/kyutai-labs/pocket-tts/blob/main/pocket_tts/models/tts_model.py), [public checkpoint](https://huggingface.co/kyutai/pocket-tts-without-voice-cloning).
