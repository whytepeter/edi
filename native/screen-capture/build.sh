#!/bin/sh
# In-process Screen Recording ask. Output is not committed.
set -eu
cd "$(dirname "$0")"
mkdir -p build
xcrun clang -dynamiclib -O2 -fobjc-arc -mmacosx-version-min=13.0 \
  -framework AppKit -framework ApplicationServices -framework Foundation -framework CoreGraphics -framework ImageIO \
  -framework ScreenCaptureKit -framework Vision \
  ask.m -o build/libedi_screen_ask.dylib
desktop_build="$(cd ../.. && pwd)/apps/desktop/build"
mkdir -p "$desktop_build"
cp build/libedi_screen_ask.dylib "$desktop_build/libedi_screen_ask.dylib"
echo "built native/screen-capture/build/libedi_screen_ask.dylib"
