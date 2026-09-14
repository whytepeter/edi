#!/bin/sh
# In-process Screen Recording ask. Output is not committed.
set -eu
cd "$(dirname "$0")"
mkdir -p build
xcrun clang -dynamiclib -O2 -fobjc-arc -mmacosx-version-min=13.0 \
  -framework AppKit -framework ApplicationServices -framework Foundation -framework CoreGraphics -framework ImageIO \
  -framework ScreenCaptureKit -framework Vision -framework PDFKit \
  ask.m -o build/libedi_screen_ask.dylib.next
# Replace by rename, never in place: a running Edi keeps the old file mapped, and writing over
# it invalidates its code signature and kills the app.
mv -f build/libedi_screen_ask.dylib.next build/libedi_screen_ask.dylib
desktop_build="$(cd ../.. && pwd)/apps/desktop/build"
mkdir -p "$desktop_build"
cp build/libedi_screen_ask.dylib "$desktop_build/libedi_screen_ask.dylib.next"
mv -f "$desktop_build/libedi_screen_ask.dylib.next" "$desktop_build/libedi_screen_ask.dylib"
echo "built native/screen-capture/build/libedi_screen_ask.dylib"
