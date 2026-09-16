#!/bin/sh
# Build eSpeak NG 1.52.0 as its own program, for the local voice: it turns text into the
# pronunciation symbols Kokoro speaks. eSpeak NG is GPL-3.0, so Edi runs it as a separate
# program (like whisper) and never links it; see docs/AUDIO-RUNTIME.md for what that means.
# Source is downloaded once into the ignored cache and checked against its hash. Only the
# English data is kept. Output is not committed.
set -eu
cd "$(dirname "$0")"
CACHE=../../benchmarks/voice/cache/speech
CMAKE=../../benchmarks/voice/cache/transcription/tools/cmake/data/bin/cmake
VERSION=1.52.0
SHA=bb4338102ff3b49a81423da8a1a158b420124b055b60fa76cfb4b18677130a23
if [ ! -x "$CMAKE" ]; then
  echo "Provision whisper first (it brings cmake): uv run benchmarks/voice/provision_transcription.py" >&2
  exit 1
fi
mkdir -p "$CACHE" build
TARBALL="$CACHE/espeak-ng-$VERSION.tar.gz"
if [ ! -f "$TARBALL" ]; then
  curl -fsSL "https://codeload.github.com/espeak-ng/espeak-ng/tar.gz/refs/tags/$VERSION" \
    -o "$TARBALL.partial"
  mv "$TARBALL.partial" "$TARBALL"
fi
echo "$SHA  $TARBALL" | shasum -a 256 -c -
SOURCE="$CACHE/espeak-ng-$VERSION"
if [ ! -d "$SOURCE" ]; then tar -xzf "$TARBALL" -C "$CACHE"; fi
"$CMAKE" -S "$SOURCE" -B build/cmake \
  -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF \
  -DCMAKE_OSX_ARCHITECTURES=arm64 -DCMAKE_OSX_DEPLOYMENT_TARGET=13.0 \
  -DESPEAK_BLD_EXTENDED_LANGUAGES=OFF
"$CMAKE" --build build/cmake --target espeak-ng-bin -j 4
# `data` compiles the dictionaries and phoneme tables with the program just built.
"$CMAKE" --build build/cmake --target data -j 4
cp build/cmake/src/espeak-ng build/
# Only what English speech needs; the full data folder carries every other language.
DATA=build/espeak-ng-data
rm -rf "$DATA"
mkdir -p "$DATA/lang/gmw"
SHARE=build/cmake/espeak-ng-data
cp "$SHARE/phontab" "$SHARE/phonindex" "$SHARE/phondata" "$SHARE/intonations" "$DATA/"
cp "$SHARE/en_dict" "$DATA/"
# en is the base voice; en-US is the one Kokoro was trained on.
cp "$SHARE/lang/gmw/en" "$SHARE/lang/gmw/en-US" "$DATA/lang/gmw/"
cp "$SOURCE/COPYING" build/espeak-ng-COPYING
if otool -L build/espeak-ng | grep -v -e ':$' -e '/usr/lib/' -e '/System/Library/'; then
  echo "espeak-ng links a non-system library" >&2
  exit 1
fi
build/espeak-ng --path=build -q --ipa=3 -v en-us "test" >/dev/null
echo "built native/espeak/build (espeak-ng, English data)"
