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

## Desktop context and Accessibility

With each question (Settings → Privacy & Permissions → Share what's in front of you, on by default), main gathers
what the person has open: `edi_front_context` in `native/screen-capture/ask.m` takes the frontmost normal window that
is not Edi's (so asking from the card still describes the app behind it), and with Accessibility the focused window's
title and document (browsers report the current tab's address this way) and the selected text. It runs off the main
thread in about 3 ms (120 ms the first time) and a question waits at most 2 s for it.
`normalizeDesktopContext` bounds every field, keeps only http(s) addresses without credentials, fragments or
secret-looking query strings, and shares only the app name for password managers and private or incognito windows.
The result goes to the worker with that one question as `<context>` marked as data, is never stored, and its page
address counts as a link the person gave for `web_fetch`. No AppleScript is used, so there are no per-app Automation
prompts. Accessibility is an ordinary permission in the queue; without it Edi still knows the app and window.

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

## Reminders and Calendar

`reminders` and `calendar` are permission IDs backed by EventKit in the native helper (`edi_eventkit_*` in
`native/screen-capture/ask.m`). Edi needs full access; write-only access counts as off. The first Reminders or
Calendar tool call asks macOS if it never has, and Settings → Privacy & Permissions can ask or link to System
Settings. The app's Info.plist must carry `NSRemindersFullAccessUsageDescription`,
`NSCalendarsFullAccessUsageDescription` and their pre-14 equivalents (`package.json` `extendInfo` and
`scripts/prepare-electron.mjs`): without them macOS ends the app when EventKit asks.

## Always allow

Every change is reviewed. "Always allow" is saved (`approval_rules`, migration 9) when the action says where it
applies: a folder for file changes and opening files, a site for opening links, an app for opening apps, or any for
adding reminders and events. A rule covers a later request only for the same action when every path, site or app it
touches is inside the rule (`ruleAllows` in `packages/contracts/src/capabilities.ts`; a sibling folder with the same
prefix or a look-alike site does not match). Actions without a scope, such as deleting workspace items, can be allowed
for the current conversation or task only. Saved rules are listed under Settings → Privacy & Permissions → Always
allowed, where removing one makes Edi ask again.

## Connectors (MCP)

Connected apps are remote MCP servers (`apps/desktop/src/main/connectors/`). Only https addresses are accepted (plain
http only on 127.0.0.1 or localhost, for testing). Signing in uses the MCP authorization flow through the official SDK:
protected-resource and authorization-server discovery, dynamic client registration as a public client, PKCE (S256),
and a one-shot loopback listener on 127.0.0.1 that accepts only `/callback` with the expected state. Client
registration, tokens and the verifier are stored per connector with Electron `safeStorage` in
`userData/connectors/<id>.enc`; the database holds only the name, address and tool choices. On launch Edi reconnects
with saved sign-ins and never registers or opens a browser by itself; an app that needs signing in says so. Every tool
from a connected app is a reviewed write, whatever the server says about it; results are marked as untrusted
information for the model.

## Adding another permission

Add the ID to `packages/contracts/src/permissions.ts`, register its main-process adapter and Settings URL in the composition root, and add user-facing copy to the shared permission card. The queue, bridge, IPC commands, focus refresh, and dismissal behavior remain unchanged. Add manager-state tests plus one feature-level test proving that the permission is requested only when needed.
