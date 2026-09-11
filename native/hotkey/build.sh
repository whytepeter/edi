#!/bin/sh
# Build the hold-to-talk hotkey helper. Output is not committed; run via `pnpm build:native`.
set -eu
cd "$(dirname "$0")"
mkdir -p build
xcrun swiftc -O -swift-version 5 -target arm64-apple-macos13 \
  -framework AppKit -framework Carbon \
  main.swift -o build/edi-hotkey
echo "built native/hotkey/build/edi-hotkey"
