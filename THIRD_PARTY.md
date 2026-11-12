# Third-party components

Edi's own code is under the [MIT licence](LICENSE). It builds on the components below, each under its own licence. This list covers what ships in a packaged app or is downloaded by it; the full set of npm dependencies and their licences is in `pnpm-lock.yaml` and each package's own files.

## Shipped in the app

| Component | Use | Licence |
| --- | --- | --- |
| Electron | App shell | MIT |
| React | Interface | MIT |
| AI SDK (`ai`) and the OpenRouter provider | Model calls | Apache-2.0 |
| Model Context Protocol SDK | Connected apps | MIT |
| ONNX Runtime (`onnxruntime-node`) | Runs local speech and voice-activity models | MIT |
| koffi | Calls Edi's own native helper | MIT |
| Mermaid | Draws diagrams | MIT |
| Zod | Validation | MIT |
| Silero VAD (`apps/desktop/voice/silero_vad.onnx`, and its ggml form with whisper) | Detects speech | MIT |
| whisper.cpp (`whisper-server`, `whisper-cli`) | Speech recognition, run as separate programs | MIT (see upstream) |
| eSpeak NG 1.52.0 (`espeak-ng` and English data) | Turns text into pronunciation for the local voice | **GPL-3.0-or-later** |

**About eSpeak NG.** It is GPL-licensed, so Edi runs it as a separate program and never links it into Edi's own code (see `native/espeak/build.sh` and `docs/voice.md`). A packaged app includes eSpeak NG's licence text as `espeak-ng-COPYING`. Anyone distributing a build that includes it must meet the GPL's terms for that program, including offering its source. Its source is the unmodified 1.52.0 release from https://github.com/espeak-ng/espeak-ng.

## Downloaded by the app, not bundled

These are fetched on the person's request from Settings → Voice. Check each model's own licence before redistributing it.

| Component | Use |
| --- | --- |
| Whisper recognition models | Speech recognition |
| Kokoro 82M | Local voice |
| Chatterbox (MLX, 4-bit) | Expressive local voice and personal voices |

`apps/desktop/voice/chatterbox-voice.wav` is a 13-second sample generated with Kokoro, used as Chatterbox's default reference voice. It is not a recording of a person.

## Services

OpenRouter, Cartesia, ElevenLabs and Composio are optional services reached with the person's own keys, under those services' terms. No key is bundled.

## Characters

The bundled characters (`packages/characters/edi`, `packages/characters/mochi`) declare their own licence in `character.json`. Their art is **not** covered by the MIT licence unless that file says so.
