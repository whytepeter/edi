#!/bin/sh
# Build the whisper.cpp programs the packaged app ships: whisper-server (the model stays loaded
# between turns) and whisper-cli (the fallback), statically linked so each is one file that
# electron-builder can copy and sign. CPU with Accelerate; small.en needs no GPU and no first-run
# shader compile. The source and cmake are the pinned, hash-verified ones from
# benchmarks/voice (run `uv run benchmarks/voice/provision_transcription.py` once). whisper's VAD
# model (Silero in ggml form, MIT) is copied alongside; recognition models are downloaded by the
# app into its own folder, never bundled. Output is not committed.
set -eu
cd "$(dirname "$0")"
CACHE=../../benchmarks/voice/cache/transcription
SOURCE="$CACHE/whisper.cpp-927cfce34f31707e17f2bff35c349632fb9e2c3a"
CMAKE="$CACHE/tools/cmake/data/bin/cmake"
VAD="$CACHE/ggml-silero-v6.2.0.bin"
if [ ! -x "$CMAKE" ] || [ ! -f "$VAD" ]; then
  echo "Provision whisper first: uv run benchmarks/voice/provision_transcription.py" >&2
  echo "then sh benchmarks/voice/build_transcription.sh" >&2
  exit 1
fi
if [ ! -d "$SOURCE" ]; then tar -xzf "$CACHE/whisper-source.tar.gz" -C "$CACHE"; fi
echo "2aa269b785eeb53a82983a20501ddf7c1d9c48e33ab63a41391ac6c9f7fb6987  $VAD" | shasum -a 256 -c -s
mkdir -p build
"$CMAKE" -S "$SOURCE" -B build/cmake \
  -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF -DGGML_METAL=OFF -DGGML_NATIVE=OFF \
  -DCMAKE_OSX_ARCHITECTURES=arm64 -DCMAKE_OSX_DEPLOYMENT_TARGET=13.0 \
  -DWHISPER_CURL=OFF -DWHISPER_BUILD_SERVER=ON -DWHISPER_BUILD_TESTS=OFF \
  -DWHISPER_BUILD_EXAMPLES=ON
"$CMAKE" --build build/cmake --target whisper-cli whisper-server -j 4
cp build/cmake/bin/whisper-server build/cmake/bin/whisper-cli build/
cp "$VAD" build/ggml-silero-v6.2.0.bin
# Nothing but system libraries: the programs run from inside Edi.app on any Apple Silicon Mac.
if otool -L build/whisper-server build/whisper-cli | grep -v -e ':$' -e '/usr/lib/' -e '/System/Library/'; then
  echo "whisper links a non-system library" >&2
  exit 1
fi
echo "built native/whisper/build (whisper-server, whisper-cli, VAD model)"
