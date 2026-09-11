# Edi

A desktop companion by Fewer Labs. This is the first runnable foundation, not a connected agent yet.

## Run

Requires Node 22 and pnpm 10 on macOS.

```sh
pnpm install
pnpm setup:electron
pnpm dev
```

Only the transparent pet window appears at launch. Click Edi or press **Command–Shift–E** to summon a small, iOS-inspired content card. Expand it for more room. The card dismisses on focus loss unless pinned; closing it hides it. Quit from the Edi menu or Command–Q. This is a macOS app, not an iOS app or a notch integration.

```sh
pnpm typecheck
pnpm test
pnpm build
pnpm test:desktop
pnpm package
```

`package` produces an unpacked local app under `apps/desktop/release`. Distribution signing/notarization and custom application icons are not configured yet.

## Working now

- Independent Electron pet/workspace windows and narrow validated IPC.
- Compact content card with Appearance, Extensions, and Activity under More.
- Cloud and Sprout avatars, synchronized across windows and persisted locally.
- Expand/collapse, pin/hide controls, and global summon shortcut.
- Search/filter of the clearly labeled extension catalog preview.
- A sample response with a diagram; no model or video playback is connected yet.

Preferences use an atomic JSON file in Electron's user-data directory for this foundation. Move them into SQLite when conversation/run persistence arrives. No API keys are needed, no accounts are connected, and microphone permissions are not requested.

## Structure

`apps/desktop/src/main` owns windows and preferences; `preload` exposes the validated bridge; `renderer` contains the React workspace and SVG avatars. `packages/contracts` owns command/settings schemas and the skin catalog. New domain packages will be created with their first working feature rather than empty placeholder directories.

## Next

1. Agent worker with AI SDK streaming and cancellation.
2. Screen capture and a capability broker with reviewed writes.
3. SQLite conversation/run history.
4. Voice runtime measurements and integration.
5. Real extension installs, connectors, and remote MCP.

The complete product documents are linked in [docs/README.md](docs/README.md).
