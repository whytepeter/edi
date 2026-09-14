# Permissions

Edi asks for operating-system access only when a feature needs it. Launching the app, opening the content card, and sending a generic text question do not show a permission card or invoke a macOS prompt.

## Flow

1. A feature calls the main-process permission manager with a typed permission ID.
2. If access is already granted, the feature continues immediately.
3. Otherwise, the manager queues the permission and reveals the shared dynamic-content card.
4. The card shows one primary next action. A first request asks macOS; a denied request opens the matching System Settings page.
5. Returning focus to the card refreshes the status. The feature must be started again after access is granted.

`Not now` dismisses only the current card. It never changes macOS settings. Restricted or unavailable access is explained without offering an action that cannot succeed.

## Ownership and trust boundary

The main process owns permission status, native requests, Settings links, and the queue. Renderers receive only validated state and can send only typed permission commands. The workspace renderer cannot capture microphone audio. The pet renderer receives audio-only access only while a voice turn is opening or listening.

Screen capture has a second, local privacy gate. `needsScreenContext()` runs before ScreenCaptureKit or Electron capture is touched. A prompt that names something visible — the screen, a window, an error, a button — may capture current displays. While that visual conversation is still active, a short follow-up (“Better?”, “Is it fixed now?”) may capture again. An unrelated request ends the visual context and stays text-only. Captures remain in memory for the active run, are sent only with that run, and are not stored in history. Edi never watches the screen in the background.

## Files & Folders

Edi's file tools (`files.search`, `files.list`, `files.read`, and the reviewed `files.move`, `files.create_folder`,
`files.trash`) work only inside allowed folders: Desktop, Documents, Downloads, folders the person adds with an open
panel, and the whole home folder while Full Disk Access is on. Paths are resolved through symlinks before the check.
Edi's workspace and `~/Library` are read-only for these tools, and the allowed folders themselves cannot be moved or
deleted.

macOS offers no way to ask whether a protected folder is allowed without prompting, so
`apps/desktop/src/main/platform/file-access.ts` records what it learns when a folder is touched: when the person
taps Allow in Settings → Privacy & Permissions, or when a file tool first needs it. Full Disk Access is detected by
opening a file only it unlocks, which never prompts. A refused folder links to System Settings.

## Adding another permission

Add the ID to `packages/contracts/src/permissions.ts`, register its main-process adapter and Settings URL in the composition root, and add user-facing copy to the shared permission card. The queue, bridge, IPC commands, focus refresh, and dismissal behavior remain unchanged. Add manager-state tests plus one feature-level test proving that the permission is requested only when needed.
