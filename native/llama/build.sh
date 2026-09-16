#!/bin/sh
# Build llama-server, the model runner the packaged app ships, so someone can download a model
# in Edi and have it answer without installing anything else. One statically linked arm64 binary
# with Metal embedded (no shader compile on first run), serving an OpenAI-style API on a loopback
# port: tool calling through --jinja, images through --mmproj. The source is the pinned,
# hash-verified tarball from benchmarks/models (run `uv run benchmarks/models/provision_llama.py`
# once). Models are never bundled; the app downloads them into its own folder. Output is not
# committed.
set -eu
cd "$(dirname "$0")"
CACHE=../../benchmarks/models/cache
COMMIT=391fac16460f15233a7740550d858ac96df3419d
SOURCE="$CACHE/llama.cpp-$COMMIT"
CMAKE="$CACHE/tools/cmake/data/bin/cmake"
TARBALL="$CACHE/llama-source.tar.gz"
if [ ! -x "$CMAKE" ] || [ ! -f "$TARBALL" ]; then
  echo "Provision llama.cpp first: uv run benchmarks/models/provision_llama.py" >&2
  exit 1
fi
echo "82977400c28b7486f90126a5592c9ff585f9b2ae0a3be2c9ab77464e5eef78cc  $TARBALL" | shasum -a 256 -c -s
if [ ! -d "$SOURCE" ]; then tar -xzf "$TARBALL" -C "$CACHE"; fi
mkdir -p build
"$CMAKE" -S "$SOURCE" -B build/cmake \
  -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF \
  -DGGML_METAL=ON -DGGML_METAL_EMBED_LIBRARY=ON -DGGML_NATIVE=OFF \
  -DCMAKE_OSX_ARCHITECTURES=arm64 -DCMAKE_OSX_DEPLOYMENT_TARGET=13.0 \
  -DLLAMA_CURL=OFF -DLLAMA_BUILD_SERVER=ON -DLLAMA_BUILD_TESTS=OFF \
  -DLLAMA_BUILD_EXAMPLES=OFF -DLLAMA_BUILD_TOOLS=ON
"$CMAKE" --build build/cmake --target llama-server -j 4
cp build/cmake/bin/llama-server build/
# Nothing but system libraries: the program runs from inside Edi.app on any Apple Silicon Mac.
if otool -L build/llama-server | grep -v -e ':$' -e '/usr/lib/' -e '/System/Library/'; then
  echo "llama-server links a non-system library" >&2
  exit 1
fi
echo "built native/llama/build (llama-server)"
