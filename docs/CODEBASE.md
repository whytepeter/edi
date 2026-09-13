# Codebase guide

This guide explains where Edi's code belongs and how the running pieces connect. It describes the current
repository, not a future folder diagram.

## The mental model

Edi has four trust and execution boundaries:

```text
React renderers
  pet · workspace · bubble · menu · pointer
                  │
        narrow preload methods
                  │
Electron main ─── IPC router ─── domain services
  windows · permissions · storage · capabilities · worker supervision
                  │
        bounded worker protocols
                  │
Agent worker · Pocket TTS · whisper.cpp · native helpers
```

The renderer is a user interface, not an operating-system service. It never receives filesystem access,
credentials, raw `ipcRenderer`, or native permission adapters. Main validates the sender and payload before it
does privileged work. Workers receive the minimum data needed for one job and communicate through bounded
messages.

This follows Electron's current guidance on [process isolation](https://www.electronjs.org/docs/latest/tutorial/process-model),
[sandboxed renderers](https://www.electronjs.org/docs/latest/tutorial/sandbox),
[context isolation](https://www.electronjs.org/docs/latest/tutorial/context-isolation), and
[IPC sender validation](https://www.electronjs.org/docs/latest/tutorial/security#17-validate-the-sender-of-all-ipc-messages).

## Repository map

| Location | Responsibility |
| --- | --- |
| `apps/desktop/src/main` | Electron lifecycle, windows, OS integration, supervision, and dependency wiring |
| `apps/desktop/src/preload` | Small APIs exposed to a specific renderer surface |
| `apps/desktop/src/renderer/src/app` | Workspace shell and surface routing |
| `apps/desktop/src/renderer/src/features` | User-facing features; feature folders do not import each other |
| `apps/desktop/src/renderer/src/components` | Shared visual primitives with no feature knowledge |
| `packages/contracts` | Runtime schemas, cross-process types, and pure policy functions |
| `packages/capabilities` | Tool registry, approval enforcement, and built-in capability implementations |
| `packages/storage` | SQLite schema, migrations, and repositories |
| `native` | Small macOS helpers used only where Electron does not provide the required behavior |
| `tests` | Boundary, desktop, audio, and provider-independent integration checks |
| `benchmarks` | Reproducible runtime measurements and ignored local model assets |

The pnpm packages use `workspace:*`, so an internal dependency cannot silently resolve to a registry copy. See
the [pnpm workspace protocol](https://pnpm.io/workspaces#workspace-protocol-workspace).

## Major subsystems

### App composition and lifecycle

- Entry point: `apps/desktop/src/main/index.ts`
- Depends on: windows, storage, agent, capabilities, voice, permissions, and character services
- Lifecycle: open storage → load settings/credentials/history → create windows → register IPC → start input →
  cancel work and close workers/storage during quit

`index.ts` is the composition root. It may construct services and connect events, but domain rules and platform
workarounds belong in their owning modules. For example, `platform/macos-media-permissions.ts` owns native media
prompts and Electron's session permission policy.

### IPC and preload

- Contracts: `packages/contracts/src/index.ts` and focused contract modules
- Route policy: `apps/desktop/src/main/ipc/router.ts`
- Command effects: `apps/desktop/src/main/ipc/commands.ts`
- Renderer APIs: `apps/desktop/src/preload/index.ts` and `bubble.ts`

Every command has a schema, an explicit surface allowlist, and one main-process handler. Subframes receive no
window privileges. A preload converts validated events into ordinary callbacks and never passes Electron event
objects to React. Electron recommends exposing a method for a specific operation instead of raw IPC.

When adding a command, change the shared contract, add the route and caller allowlist, expose only the required
preload method, then test invalid payloads and unauthorized callers.

### Agent and capabilities

- Foreground-run owner: `apps/desktop/src/main/agent/agent-service.ts`
- Provider worker: `apps/desktop/src/main/agent/agent-worker.ts`
- Worker boundary: `apps/desktop/src/main/agent/worker-protocol.ts`
- Tool policy: `packages/capabilities/src/broker.ts`

`AgentService` owns one active run, cancellation, history snapshots, approval pauses, tool results, and final
presentation extraction. The worker owns the AI SDK/OpenRouter stream but no OS authority. Tool calls return to
main, where the broker validates input, asks for approval when required, executes the capability, and records the
outcome.

Keep provider code behind the worker boundary. Do not put tool side effects in prompts or the worker. If a
second desktop host or a second agent runner needs the same service, move the provider-independent part into a
workspace package then; a package is not useful merely because a folder is large.

### Permissions and screen context

- Generic queue and state: `apps/desktop/src/main/permission-manager.ts`
- macOS media adapters: `apps/desktop/src/main/platform/macos-media-permissions.ts`
- Screen capture and visual-session policy: `apps/desktop/src/main/capture/screens.ts`
- Pure intent gate: `packages/contracts/src/screen-intent.ts`
- UI: `apps/desktop/src/renderer/src/features/permissions/PermissionCard.tsx`

Permissions are requested at the moment a feature needs them. Generic questions do not capture the screen.
Native Settings URLs are constants in main, never renderer input. Add a permission by defining its contract,
native adapter, bounded UI copy, denial path, and tests for first ask, denial, dismissal, and retry.

### Voice

- Session policy: `packages/contracts/src/voice-session.ts`
- Main coordinator: `apps/desktop/src/main/voice/voice-controller.ts`
- Local speech adapter: `apps/desktop/src/main/voice/pocket-process.ts`
- Pocket worker: `apps/desktop/voice/pocket_worker.py`
- Renderer capture/playback: `apps/desktop/src/renderer/src/features/voice`

Voice separates transcription, reasoning, synthesis, and playback. Generation tokens prevent old capture or
audio events from reviving a stopped turn. Pocket runs offline in a supervised process; every PCM frame is
validated and acknowledged to apply backpressure. The host passes the voice ID explicitly and rejects a worker
that reports a different voice.

New local and cloud speech providers must normalize into the existing `speak(text, signal, consume)` port. A
provider owns its credentials, transport, voice IDs, and expressive controls. It must not silently fall back from
local to cloud.

### Presentation and character

- Character lifecycle and skin guide: `docs/CHARACTER.md`
- Character interactions: `apps/desktop/src/main/character`
- Window placement: `apps/desktop/src/main/windows`
- Presentation parsing: `packages/contracts/src/presentation.ts`
- Alignment with recognized text: `packages/contracts/src/screen-grounding.ts`; Vision recognition in `native/screen-capture/ask.m`, read by `recognizedDisplayText` in `apps/desktop/src/main/permissions.ts`
- Overlay controller: `apps/desktop/src/main/presentation/pointer.ts`
- Renderers: `features/pet` and `features/pointer`

Model output can select only validated point/draw actions. Main maps screenshot pixels to display coordinates;
the overlay does not move the user's cursor or accept clicks. `CharacterActions` translates lifecycle events into
a validated semantic expression; the pet renderer alone maps that state to skin artwork and motion. Character
state, skin assets, voice, and agent state remain separate so one can change without resetting the others.

### Card navigation and Settings

- Destinations: `workspaceSections`, `settingsPages`, and `workspaceViewSchema` in `packages/contracts/src/index.ts`
- Labels, icons, parents and titles: `apps/desktop/src/renderer/src/app/navigation.ts`
- Shell (title menu, expanded sidebar, view switch): `apps/desktop/src/renderer/src/app/WorkspaceCard.tsx`
- Home: `apps/desktop/src/renderer/src/features/home`
- Settings pages: `apps/desktop/src/renderer/src/features/settings`; grouped rows are `GroupedList`/`GroupedRow` in `components/ui`
- Model picker data: `apps/desktop/src/main/agent/model-catalog.ts` (OpenRouter public catalog, image input + tools only, 1-hour cache; `EDI_MODEL_CATALOG=off` in desktop tests)
- Runtime facts for Settings (version, voice and shortcut availability): `system()` on the bridge, built in
  `apps/desktop/src/main/index.ts`

To add a section or settings page: add its ID to the contract list, give it a label/parent in `navigation.ts`, render
it in `WorkspaceCard`, and extend the contract test. Main and Edi's own navigation can then target it with
`show-workspace`. Only add a Settings group when it controls something that works; a page for an unbuilt feature
says so plainly instead of showing inert controls.

### Artifacts and workspace

- Contract: `packages/contracts/src/artifacts.ts` (semantic kinds, summaries for the thread, full content, refs)
- Tools: `workspace.show` in `packages/capabilities/src/builtins/workspace.ts`; `notes.show` and `writeNewNote`
  in `builtins/notes.ts`
- Host: `apps/desktop/src/main/index.ts` rebuilds summaries from successful display tool calls
  (`toolCalls.shown`), resolves full content (`edi:artifact:get`), opens content in the card or the bubble, and
  keeps SQLite as the canonical conversation record
- Renderer: `components/artifacts` (safe Markdown renderer, `ArtifactCard`, `ArtifactView`), inline in
  `features/conversation/AgentPanel.tsx`, opened in place by `WorkspaceCard`

Shown content is data, never HTML. It is displayed, not returned to the model, so voice replies never read it out.
`workspace.show` also creates a useful representation under Documents › Edi › Artifacts: reports and checklists
are Markdown, while tables are CSV. The generated-content view has no second Copy or Save step.

### Storage

- Database and migrations: `packages/storage/src/database.ts` and `migrations.ts`
- Queries: `packages/storage/src/repositories.ts`

Main owns one SQLite connection. Repositories return domain records and hide SQL from features. Startup marks
unfinished work interrupted; it does not replay old writes or approvals. Binary artifacts belong in a managed
directory, not SQLite, when that feature arrives.

## End-to-end flows

Typed question:

```text
AgentPanel → validated ask command → AgentService → optional screen gate/capture
→ agent worker/OpenRouter → text events → AgentService state → workspace renderer
```

Approved tool action:

```text
worker tool call → capability broker → approval queue → bubble/card
→ request-bound decision → capability execute → recorded result → worker continues
```

Voice turn:

```text
click/hold/⌥ Space → VoiceController → microphone permission → renderer capture
→ local transcription → AgentService → selected local voice → bounded PCM → renderer playback
```

## TypeScript and tests

All packages inherit the shared strict configuration. Indexed access is checked because presentation parsing,
audio buffers, worker frames, and stored rows routinely cross boundaries where an assumed element can be
missing.

Use deterministic tests for policy and state transitions. Use fake workers/providers for failure, cancellation,
and timeout paths. Native smoke tests should remain few, isolated, and explicit about permissions, audio, and
paid calls. `pnpm check` is the normal gate; `pnpm build` catches bundling and sandboxed-preload problems that
type checking cannot.

## Deliberate limits

- The app currently supports one foreground conversation and one SQLite writer.
- Agent code stays under the desktop app while its worker and lifecycle are desktop-specific.
- Voice providers are not yet selectable in Settings; Pocket is the only wired provider.
- Remote media and third-party extension UI are not loaded into trusted renderers.
- A custom application protocol and Electron fuse hardening remain release work; changing either affects
  packaging and must be verified in the signed app.
