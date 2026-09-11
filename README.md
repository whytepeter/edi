# Edi

A desktop companion by Fewer Labs. The foundation includes optional OpenRouter text responses; tools and voice are not connected yet.

## Run

Requires Node 22 and pnpm 10 on macOS.

```sh
pnpm install
pnpm setup:electron
pnpm dev
```

Only the transparent pet window appears at launch. Click Edi or press **Command–Shift–E** to request listening; neither opens the content card. Microphone/transcription is not connected yet, so a small status bubble explains that no microphone is active. Right-click Edi → **Show content** to open the card, then expand it for more room. The card dismisses on focus loss unless pinned. Right-click → **Sleep Edi** hides the character and card; the shortcut wakes Edi and requests listening. **Quit Edi** exits fully. This is a macOS app, not an iOS app or a notch integration.

Character gestures now distinguish a short click (conversation request), a stationary 350 ms hold (push-to-talk request), and moving before the hold threshold (drag). Releasing a hold never starts conversation. Until microphone capture and VAD are connected, these requests display “voice coming soon”; they do not record or submit speech. The custom right-click menu supports arrow keys, Home/End and Escape. The global shortcut currently requests conversation, not hold-to-talk.

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
- OpenRouter setup, streamed plain-text responses, cancellation, and request limits in a separate worker thread.
- Compact content card with Appearance, Extensions, and Activity under More.
- Cloud and Sprout avatars, synchronized across windows and persisted locally.
- Expand/collapse, pin/hide controls, character context menu, Sleep, and global wake/listen shortcut.
- Drag Edi to reposition it; Escape cancels a drag. Position persists across restarts. Unpinned cards follow; pinned cards stay in place.
- Search/filter of the clearly labeled extension catalog preview.
- Validated text, step-diagram, and local-video renderer foundations. Example selectors are no longer exposed in the main UI; inline agent-generated rich content is still pending. Remote media remains blocked.

Preferences use an atomic JSON file in Electron's user-data directory for this foundation. Move them into SQLite when conversation/run persistence arrives. Previews need no key. Microphone permissions are not requested.

## Connect OpenRouter

Open **Talk to Edi**, enter your OpenRouter API key and an exact model ID from your OpenRouter account, then choose **Save connection**. Do not paste the key into chat or commit it to this project. Saving is local only; the first message tests the connection and may incur provider charges.

The key is entered in a password field, cleared after submission, and stored in `openrouter.enc` in the app's user-data directory using Electron safeStorage encryption. It is never returned through the settings bridge. This is Keychain-backed encryption on macOS, not a claim that the key exists only in Keychain. Unsigned development builds may trigger Keychain prompts. Removing the saved key deletes Edi's local encrypted copy; it does not revoke the key at OpenRouter.

Only your typed prompt and Edi's system instructions go to OpenRouter. Requests start fresh without chat history, screen capture, or files. Limits: one active request, 8,000 input characters, 2,048 output tokens, a 120-second timeout, and no automatic retries. Stop discards further output and terminates the worker; provider usage already processed may still be charged. No shared key or default paid model is bundled.

`pnpm test:agent` exercises the real SDK with mocked network responses. The user confirmed a live OpenRouter response on 2026-09-11. “Talk to Edi” remains a temporary integration interface, not the final product entry point.

Implementation references: [OpenRouter AI SDK adapter](https://github.com/OpenRouterTeam/ai-sdk-provider), [Electron credential encryption](https://www.electronjs.org/docs/latest/api/safe-storage).

## Structure

- `apps/desktop/src/main`: composition root (`index.ts`) plus `agent/`, `character/`, `ipc/` (route table and sender checks), `settings/`, `windows/` and `voice/`.
- `apps/desktop/src/preload`: the narrow validated bridge.
- `apps/desktop/src/renderer/src`: `app/` (shell and surface routing), `components/ui/` (shared UI primitives), `styles/` (tokens, materials, component styles), `features/*` (pet, conversation, content, appearance, extensions, activity, voice), `hooks/` and `lib/`. Features never import each other; ESLint enforces shared → features → app.
- `packages/contracts`: command/settings schemas, skin geometry and pure placement logic.
- `packages/storage`: the local SQLite history (runs, tool calls and approvals, notes). Built on Node's `node:sqlite`; only the main process writes.
- `packages/capabilities`: the capability broker and built-in tools. Every tool call is validated, writes are reviewed by you first, and each outcome is recorded.

### Voice (hold to talk)

Hold Edi for a moment and talk; let go when you're done. Edi transcribes locally with whisper.cpp, looks at every screen at the moment you let go, and answers out loud with Pocket TTS. The card shows the full reply.

- Development builds use the pinned voice runtimes provisioned under `benchmarks/voice` (see its README). Packaged builds don't bundle them yet, so there the character says voice is unavailable.
- macOS asks once for the microphone and once for Screen Recording. When launched from a terminal, macOS attributes both to the terminal app.
- A single click shows a hint to hold instead: hands-free conversation isn't built yet.
- `EDI_VOICE=off pnpm dev` turns local voice off. The desktop tests set it so they never open a real microphone.

### Tools and approvals

Edi can list its notes and save a new note to `~/Documents/Edi Notes`. Saving always shows the exact file path and content first; nothing is written until you choose **Save Note**, and existing files are never replaced. Stopping a response cancels any pending review. Every request and action appears in **Activity**.

## Next

1. Finish milestone 0: packaged acceptance, desktop behavior, skin attachment geometry, and measured audio/runtime selection.
2. Screen capture and a capability broker with reviewed writes.
3. SQLite conversation/run history.
4. Voice runtime measurements and integration.
5. Real extension installs, connectors, and remote MCP.

The complete product documents are linked in [docs/README.md](docs/README.md).
