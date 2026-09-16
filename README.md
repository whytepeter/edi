# Edi

A desktop companion by Fewer Labs. The current foundation includes OpenRouter conversations, reviewed note tools, local hold-to-talk voice in development, and temporary on-screen presentation effects.

## Run

Requires Node 22 and pnpm 10 on macOS.

```sh
pnpm install
pnpm setup:electron
pnpm dev
```

Only the transparent pet window appears at launch. Hold Edi or **⌥ Space** for push-to-talk; a plain click does nothing, so Edi can't start listening by accident. Right-click Edi for **Open Edi**, **Settings**, **Sleep Edi** and **Quit Edi**. The card opens next to Edi on Home and dismisses on focus loss unless pinned. **Sleep Edi** hides the character and card while Edi keeps running, and ⌥ Space wakes it. **Quit Edi** exits fully. This is a macOS app, not an iOS app or a notch integration.

Character gestures distinguish a stationary 350 ms hold (push-to-talk) from moving before the hold threshold (drag). Keyboard activation of the character opens its menu. The custom right-click menu supports arrow keys, Home/End and Escape. Hands-free follow-ups and shortcut rebinding are still pending.

```sh
pnpm typecheck
pnpm test
pnpm build
pnpm test:desktop
pnpm package
```

`package` produces an unpacked local app under `apps/desktop/release`, unsigned and for this Mac only. `pnpm --filter @edi/desktop release` builds a signed, notarized `.dmg` and `.zip` for other Macs once a Developer ID certificate and notarization credentials are set up. See [docs/RELEASE.md](docs/RELEASE.md). Custom application icons are not configured yet.

## Working now

- Independent Electron pet/workspace windows and narrow validated IPC.
- OpenRouter setup, streamed plain-text responses, cancellation, and request limits in a separate worker thread.
- Model-controlled public web search through OpenRouter, with source links in grounded replies.
- Just-in-time microphone and Screen Recording permission cards with explicit macOS Settings recovery.
- Privacy-first screen context: screenshots are captured only when a prompt refers to visible UI, or as a short follow-up in that visual conversation.
- Listening, thinking, and speaking bubble states; ordinary replies remain in chat. Pending writes can be approved from a compact action card or opened in the full review.
- Content card with Home, Conversations, Library, Skills, Connectors, Appearance, and Settings: a title menu when compact, a sidebar when expanded.
- Settings for AI (OpenRouter), Voice (speak replies on/off), Keyboard, Privacy & Permissions (with Activity), and About.
- Edi (default) and Mochi characters with a continuous size setting, synchronized across windows and persisted locally.
- Right-click menu and bubbles use native macOS glass (vibrancy).
- Expand/collapse, pin/hide controls, character context menu, Sleep, and global wake/listen shortcut.
- Drag Edi to reposition it; Escape cancels a drag. Position persists across restarts. The card follows Edi whether or not it is pinned; pinning only keeps it open when another app takes focus.
- Library lists notes Edi saved and reveals them in Finder. Skills and Connectors say plainly that installs aren't available yet.
- Structured documents, checklists, tables, and saved notes render inline without allowing generated HTML or scripts into Edi’s trusted UI.

Preferences use an atomic JSON file in Electron's user-data directory. Conversation, tool, and activity history use local SQLite. Previews need no key. OS permissions are requested only when a feature needs them and only after the person clicks the permission card's action.

## Connect OpenRouter

Open **Settings → AI** (or choose **Set up AI** on Home), paste your OpenRouter API key, pick a model from the list, then choose **Save connection**. The list comes from OpenRouter's public catalog, needs no key, and shows only models that accept images and support tools; if it can't load, type a model ID instead. After saving, the page shows **Key saved** rather than the key, and changing the model keeps the saved key. Do not paste the key into chat or commit it to this project. Saving is local only; the first message tests the connection and may incur provider charges.

The key is entered in a password field, cleared after submission, and stored in `openrouter.enc` in the app's user-data directory using Electron safeStorage encryption. It is never returned through the settings bridge. This is Keychain-backed encryption on macOS, not a claim that the key exists only in Keychain. Unsigned development builds may trigger Keychain prompts. Removing the saved key deletes Edi's local encrypted copy; it does not revoke the key at OpenRouter.

Your prompt, recent completed conversation turns, Edi's system instructions, and any screen images required by that prompt go to OpenRouter. Generic questions do not trigger capture and contain no screenshot. Limits: one active request, 8,000 input characters, 16,000 output tokens (shown content arrives as tool arguments), and a 120-second timeout. Temporary failures get up to two SDK retries, and OpenRouter may try a compatible backup provider. Stop discards further output and terminates the worker; provider usage already processed may still be charged. No shared key or default paid model is bundled.

Edi can let the selected model search the public web when a question needs current or niche information. Search runs as an OpenRouter server tool, may add search charges to the same OpenRouter account, and sends the search query to OpenRouter and its selected search provider. It does not give Edi a logged-in browser session, permission to click or type in websites, or access to browser history.

`pnpm test:agent` exercises the real SDK with mocked network responses. The user confirmed a live OpenRouter response on 2026-09-11.

Implementation references: [OpenRouter AI SDK adapter](https://github.com/OpenRouterTeam/ai-sdk-provider), [Electron credential encryption](https://www.electronjs.org/docs/latest/api/safe-storage).

## Structure

- `apps/desktop/src/main`: composition root (`index.ts`) plus `agent/`, `character/`, `ipc/` (route table and sender checks), `settings/`, `windows/` and `voice/`.
- `apps/desktop/src/preload`: the narrow validated bridge.
- `apps/desktop/src/renderer/src`: `app/` (shell and surface routing), `components/ui/` (shared UI primitives), `styles/` (tokens, materials, component styles), `features/*` (pet, conversation, content, appearance, extensions, activity, voice), `hooks/` and `lib/`. Features never import each other; ESLint enforces shared → features → app.
- `packages/contracts`: command/settings schemas, skin geometry and pure placement logic.
- `packages/storage`: the local SQLite history (runs, tool calls and approvals, notes). Built on Node's `node:sqlite`; only the main process writes.
- `packages/capabilities`: the capability broker and built-in tools. Every tool call is validated, writes are reviewed by you first, and each outcome is recorded.

### Voice (hold to talk)

Hold **⌥ Space** anywhere, or hold Edi itself, and talk; let go when you're done. Edi transcribes locally with whisper.cpp and answers out loud with Pocket TTS. If the spoken question clearly refers to visible UI, Edi captures the screens at the moment the question ends; ordinary questions do not touch screen capture. The card shows the full reply.

- Development builds use the pinned voice runtimes provisioned under `benchmarks/voice` (see its README). Packaged builds don't bundle them yet, so there the character says voice is unavailable.
- Edi asks for the microphone when voice is first used, and Screen Recording only when a screen-dependent question is asked. Denied access is recovered through the matching macOS Settings page.
- Hands-free conversation (voice-activity detection and follow-ups) is reachable only from the menu bar's **Edi → Listen** while it is still being finished.
- Pocket uses Jane as Edi’s fast local default. Chatterbox Turbo is the second local option and supports expressive
  tags such as laughs and sighs. Edi warms Chatterbox in the background and uses Jane until it is ready.
- ⌥ Space comes from a tiny native helper (`native/hotkey`, built by `pnpm build:native` and by `pnpm package`). It registers only that chord through Carbon, so it needs no Input Monitoring or Accessibility permission, never sees other keystrokes, and stops ⌥ Space from typing into the focused app. It runs only while voice is available and exits with Edi. macOS doesn't report when another app has also claimed ⌥ Space, so a conflict shows up as the key not reaching Edi. Rebinding under Settings → Keyboard Shortcut is still to come.
- `EDI_VOICE=off pnpm dev` turns local voice off. The desktop tests set it so they never open a real microphone.

### Pointing

When showing you where something is helps, Edi ends its reply with a pointing tag (`[POINT:x,y:label:screenN]`). Edi removes the tag from what you read and hear, maps the point from the screenshot back to that display, and sends its pointer from its hand to the spot with a short label. The pointer layer covers the whole display, including the menu bar, and never takes clicks or focus. It clears after eight seconds, on your next question, or on Stop or Sleep.

See [permission architecture](docs/PERMISSIONS.md) for the permission states, least-privilege boundary, and extension process.

### Tools and approvals

Edi can list its notes and save a new note to `~/Documents/Edi/Notes`. Saving always shows the exact file path and content first; nothing is written until you choose **Save Note**, and existing files are never replaced. Stopping a response cancels any pending review. Every request and action appears in **Activity**.

Large generated results open as structured content and are placed in `~/Documents/Edi/Artifacts` automatically.
Reports and checklists use Markdown; tables use CSV. They do not show a separate Copy or Save to Library footer.

## Next

1. Finish milestone 0: packaged acceptance, desktop behavior, skin attachment geometry, and measured audio/runtime selection.
2. Screen capture and a capability broker with reviewed writes.
3. SQLite conversation/run history.
4. Voice runtime measurements and integration.
5. Real extension installs, connectors, and remote MCP.

The complete product documents are linked in [docs/README.md](docs/README.md).
