#!/bin/sh
# Build inside the ignored project cache; never install into system directories.
set -eu
VOICE_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
VOICE_CACHE="$VOICE_ROOT/cache/transcription"
VOICE_SOURCE="$VOICE_CACHE/whisper.cpp-927cfce34f31707e17f2bff35c349632fb9e2c3a"
uv pip install --target "$VOICE_CACHE/tools" --no-deps --offline --no-cache \
  "$VOICE_CACHE/cmake-4.4.3-py3-none-macosx_10_10_universal2.whl"
if [ ! -d "$VOICE_SOURCE" ]; then
  tar -xzf "$VOICE_CACHE/whisper-source.tar.gz" -C "$VOICE_CACHE"
fi
VOICE_CMAKE="$VOICE_CACHE/tools/cmake/data/bin/cmake"
"$VOICE_CMAKE" -S "$VOICE_SOURCE" -B "$VOICE_SOURCE/build" \
  -DCMAKE_BUILD_TYPE=Release -DGGML_METAL=OFF -DWHISPER_CURL=OFF \
  -DWHISPER_BUILD_SERVER=ON -DWHISPER_BUILD_TESTS=OFF
# whisper-server keeps the model loaded between turns (localhost only, chosen port).
"$VOICE_CMAKE" --build "$VOICE_SOURCE/build" --target whisper-cli whisper-server -j 4
# Optional, for comparing the large model (EDI_TRANSCRIPTION_MODEL=large-v3-turbo): a Metal build
# in its own folder. Its first launch compiles GPU shaders (about 20 s, cached by macOS after).
if [ "${WITH_METAL:-0}" = "1" ]; then
  "$VOICE_CMAKE" -S "$VOICE_SOURCE" -B "$VOICE_SOURCE/build-metal" \
    -DCMAKE_BUILD_TYPE=Release -DGGML_METAL=ON -DGGML_METAL_EMBED_LIBRARY=ON -DWHISPER_CURL=OFF \
    -DWHISPER_BUILD_SERVER=ON -DWHISPER_BUILD_TESTS=OFF
  "$VOICE_CMAKE" --build "$VOICE_SOURCE/build-metal" --target whisper-cli whisper-server -j 4
fi
