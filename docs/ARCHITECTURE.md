# Edi architecture

2026-09-10 · Proposed design

## 1. Design goal

Build one desktop application that grows through capabilities. Keep the character responsive while models reason, speech synthesizes, extensions install, and services fail. Scale first in features, tool count, and maintainability; cloud traffic and multi-user infrastructure are separate concerns.

## 2. The workspace

The reference sketch establishes a rounded content surface with Edi beside its lower corner. The updated direction is a small iOS-inspired popover, not a dashboard. Edi remains visible; the card starts hidden. Summoning it or presenting useful content opens it. Start at 408 × 480 logical pixels including transparent margins, expanding to 740 × 650, clamped to the display. The compact/expanded modes share content and scroll state. Notch placement remains an optional later experiment.

| Section | Purpose | Content |
| --- | --- | --- |
| Home | Where the card opens | Greeting, ask box, pick up the last conversation, recently saved items, setup that is still missing |
| Conversations | Ask, clarify, approve | Transcript, progress, action previews, and rich results (diagrams, media) opened in place |
| Library | Revisit what Edi made | Saved notes now; reports, diagrams, exports later (the "Edi Workspace" artifact store) |
| Skills | Teach Edi ways of working | Installed and discoverable skills, trust level, declared requirements |
| Connectors | Reach the user's apps | Connected apps, accounts, custom MCP servers (MCP is a protocol, not a user-facing section) |
| Appearance | Change how Edi looks | Avatars now; size, motion and skin packs later |
| Settings | Control Edi | AI, Voice, Keyboard, Privacy & Permissions (including Activity), About |

Decided 2026-09-13. A hidden card always opens beside Edi; pinning only keeps a visible card in place. The compact card (408 px) has no room for a sidebar, so its title is a menu that switches
sections. The expanded card (740 px) shows the same destinations as a sidebar. Settings is a list of detail pages with
Back, using solid grouped rows rather than glass. "Content" is not a section: results open inside Conversations.
"Extensions" is split into Skills and Connectors; skins belong to Appearance. Activity is a trust log under
Privacy & Permissions and later also lists background tasks. The user-facing name for the artifact store is
**Library**; "workspace" keeps meaning the card in code.

Settings lists only groups that control something real. Add Behavior (proactivity), Computer Use, advanced AI
routing, custom voices and similar groups when their runtime ships; never show a toggle for a feature that does not
exist. Credentials live where they are used: OpenRouter in AI, cloud voice keys in Voice, connector credentials in
Connectors. There is no separate Providers page.

Pinning prevents dismissal on focus loss. Preserve an open result while the user visits Settings. A setup flow returns
to its initiating conversation. Closing the window does not cancel installation or lose form state unless the user
chooses Cancel.

Example: “Connect my calendar” opens connector details and requested access, launches sign-in in the system browser, displays the connected account, and offers a connection test. Creating an event is a separate action with its exact details available for review.

Only user-invoked interactions take focus. Ambient movement does not steal it. Videos expose playback controls and do not autoplay audible content.

## 3. Process boundaries

```text
Pet / workspace / overlay renderers
                 |
          typed preload bridge
                 |
Electron main: windows, OS access, approvals, secrets, supervision, database
                 |
       agent worker -> capability execution broker
                          /                \
                built-ins/connectors    extension host -> MCP servers

Voice worker -> audio events -> renderer playback
Presentation controller -> pet, hand, document, ink
```

- **Main:** owns windows, screen capture, permissions, credential retrieval, approved OS operations, persistent writes, and worker supervision. Avoid CPU-heavy work here.
- **Agent worker:** owns context assembly, SDK interaction, tool selection, streams, and run budgets. Calls the execution broker rather than directly accessing OS services.
- **Extension host:** owns MCP sessions, discovery, health, and lifecycle. Local servers are separately supervised processes. Third-party code is never imported into the trusted main or renderer process.
- **Voice worker:** loads the selected local runtime or connects to hosted audio. Keeps a model warm during active use and unloads it after an idle timeout.
- **Renderers:** display content, handle gestures, capture microphone audio with permission, and play audio. They receive narrow commands, not general shell, filesystem, credentials, or IPC access.

Electron utility processes provide Node execution and message ports. Process separation improves failure isolation, but does not sandbox arbitrary code. [Electron utilityProcess](https://www.electronjs.org/docs/latest/api/utility-process)

## 4. Windows and spatial behavior

Start with separate pet and workspace windows. Add a transparent hand/ink overlay per participating display when desktop annotation ships. Create overlays lazily and stop repainting at rest. Validate stacking, click-through behavior, focus, Spaces/fullscreen, and display changes on macOS before finalizing this topology.

Inside the workspace, render diagrams and the hand together for accurate layout. Outside it, the overlay owns the hand and ink. Only one representation of a hand is visible during transfer.

A display service converts screenshot pixels, macOS display coordinates, window coordinates, and CSS pixels. Capture metadata includes display ID, image size, scale, crop, source bounds, and timestamp. Handle negative monitor origins and mixed Retina scaling.

In-app targets use stable element IDs and measured bounds. External targets use a recent capture or later accessibility metadata. Scrolling or moving the source invalidates screenshot-derived positions: refresh or stop the gesture. Arbitrary window-edge sitting and reliable external element tracking require a native/accessibility investigation.

The hand does not move the user's cursor. Desktop drawings are temporary and clearable. Clicking/typing in other applications is a distinct future capability.

## 5. Agent and tool execution

Use AI SDK behind an Edi-owned `AgentService`. Let the SDK handle provider messages and tool round trips. Own application commands/events without recreating the entire SDK in a second abstraction. Its loop and approval stopping points fit interactive work; Edi owns enforcement and UI. [AI SDK agents](https://ai-sdk.dev/docs/agents/building-agents)

Run policy includes maximum steps, wall-clock timeout, output size, estimated spending ceiling, and cancellation. Default to one foreground run; a new question cancels or explicitly queues behind it.

One capability registry covers built-in tools, connectors, and MCP tools. Entries include a namespaced ID, input/output schemas, source/version, account, timeout, permission requirements, and result renderer.

Expose relevant tools plus capability search, not every installed schema. Search returns metadata; the host loads permitted tool schemas for a later step. Skills are selected the same way. Pin extension versions for active runs.

```text
discover -> validate input -> check grants -> review when required
         -> execute -> record outcome -> render result -> continue
```

Approval binds to run ID, tool call, account, arguments, and extension version. Recheck grants and cancellation immediately before execution. Unknown third-party effects default to review; MCP annotations are hints, not grants. Serialize related writes and parallelize only independent reads.

For sends/writes, use idempotency where supported. A network failure after submission produces an “outcome unknown” state until reconciled; do not retry blindly. Stopping a run cannot undo an already completed external action.

### 5.1 Identity, self-awareness, and app navigation

Edi's identity is product-owned context, not an improvised paragraph in each provider prompt. Build a read-only
runtime snapshot from authoritative services at the start of a turn. It includes Edi's identity and behavior rules,
the active voice and avatar, permission status, installed skills/extensions, connected MCP servers and connectors,
available capabilities, current surface, and supported navigation destinations. Never include secrets.

The snapshot distinguishes available, configured, unavailable, and planned features. Edi may describe and navigate
only what the snapshot says exists; roadmap text is not runtime capability evidence.

Expose app navigation as a narrow internal capability with a versioned destination enum and optional focus target.
The destination list is `workspaceViewSchema` in `@edi/contracts`: `conversations`, `library`, `skills`,
`connectors`, `appearance`, `settings`, and nested pages such as `settings.voice`, `settings.keyboard`,
`settings.privacy`, and `settings.activity`. Main validates the destination and asks the workspace shell
to navigate. Do not let model text become a URL, filesystem path, or arbitrary renderer route.

Personality is stable across models, voices, and skins. Semantic moods start with neutral, curious, thinking, happy,
excited, confused, concerned, playful, and proud. Agent or domain state selects the mood; the active skin maps it to
its own pose/animation, and the selected speech provider maps it to supported vocal controls. Unsupported expression
falls back to clear neutral speech without changing Edi's personality.

## 6. Extensions: one manager, distinct capabilities

An **extension** is a package containing one or more capabilities. Components can also be added independently.

| Component | Purpose | Execution |
| --- | --- | --- |
| Skill | Instructions, references, templates | Selected into agent context |
| Connector | Access to an external account/service | Direct API adapter or MCP adapter |
| MCP server | Tools, resources, prompts | Remote session or local process |
| UI contribution | Result/configuration views | Approved component schemas; isolated app views later |
| Voice pack | Voice/model assets and metadata | Voice worker |
| Skin/avatar pack | Character artwork, poses, hands, anchors, preview | Trusted presentation renderer |

A connector is a user-facing integration; MCP is one implementation method. Installing a skill does not grant account access. Removing a skill does not disconnect accounts used elsewhere.

Adopt the Agent Skills format: `SKILL.md` and optional references/assets/scripts. Initially support declarative instructions and resources; mark executable helpers unsupported until execution policy is implemented. Index metadata and load full instructions only when relevant. [Agent Skills specification](https://agentskills.io/specification)

Proposed Edi package manifest:

```json
{
  "schemaVersion": 1,
  "id": "example.meeting-helper",
  "version": "1.0.0",
  "name": "Meeting Helper",
  "requires": { "ediApi": "^1.0.0" },
  "contributes": {
    "skills": [{ "path": "skills/prepare-meeting/SKILL.md" }],
    "connectors": [{ "id": "calendar", "adapter": "edi.calendar" }]
  },
  "requestedPermissions": ["calendar.read", "calendar.events.create"]
}
```

This is Edi's format, not a vendor plugin manifest. Declarations request authority; approved grants are stored separately. Install records also carry immutable source revision, artifact hash, license metadata, dependencies, configuration schema, compatibility, and account bindings. Skill Markdown cannot authorize installation or expand grants.

## 7. Installation lifecycle

Extensions offers Discover, Installed, Connections, and Updates. Detail views show source, author, version, capabilities, dependencies, permissions, status, and storage impact. Reuse trusted form and progress components for setup and repair.

1. Resolve a concrete version and dependencies.
2. Preview the install/download/connect/execute operations.
3. On user installation, stage files outside the active version.
4. Validate paths, archive extraction, size limits, manifest, integrity, and compatibility.
5. Configure secrets/accounts and approve access.
6. Health-check and atomically activate.
7. Show success and offer first use.

The model may navigate to this flow; it cannot bypass it. Give each operation an ID so retries do not duplicate work. Persist stages for restart recovery.

Track installation, enablement, authentication, and runtime health separately: an item can be installed but require sign-in. Updates stage beside the active version and activate when affected runs finish. Review permission changes and retain a compatible previous version for rollback. Back up state before irreversible migrations. Version skill text deliberately because it changes behavior too.

Disable removes future capability access. Disconnect revokes where supported and deletes local credentials. Uninstall stops workers/removes package files and offers a separate data/history removal choice. Retain shared dependencies while referenced.

Start with a bundled catalog and local skill-folder import. Add immutable repository/archive imports and public catalog publishing later; a marketplace backend is unnecessary for the alpha.

## 8. MCP and account connections

Support remote **Streamable HTTP** first, then trusted local **stdio** servers. A remote MCP connection may require only an endpoint and sign-in, not installing code. Negotiate capabilities, handle resource/tool changes, and keep session lifecycles outside the renderer. [MCP transports](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)

Direct connectors implement start/callback/refresh/health/disconnect through their provider's rules. Remote MCP follows protocol auth discovery. Use public-client OAuth with PKCE when supported; services requiring a confidential client secret need a small backend or must be deferred. Never distribute a shared client secret in the desktop binary. [MCP authorization](https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization)

The main secret service uses Electron `safeStorage` on macOS for stored credentials. Store encrypted values or references in SQLite; never plaintext tokens in prompts or logs. Check storage availability. This is at-rest protection, not a guarantee against other processes running as the user. [Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage)

**Local code trust:** a subprocess ordinarily runs with the user's OS privileges. Edi's “read-only” grants cannot constrain arbitrary third-party code that bypasses the broker. Initially support explicitly trusted local servers, pinned artifacts, minimal environment variables, and no automatic install hooks. General untrusted local code requires enforceable OS isolation before release.

Do not silently execute `npx latest` or install Python. An extension declares its runtime; Edi provides a verified runtime, uses an explicitly configured one, or reports it missing.

## 9. Rich content and interactive UI

The content card is a conversation surface, not a media-type browser. Edi chooses validated inline blocks within a response: prose, chart/graph, diagram, linked video, or a question requiring user input. Do not expose Text/Illustration/Video tabs in the product. Developer fixtures belong in a separate test harness. Preserve block identity, answered forms, and media position as the card expands or collapses. The card appears when useful content is available, not as a permanently open dashboard.

Linked video requires a dedicated media adapter: validate the URL and allowed provider, show a safe preview, and load remote media only on user action. YouTube and direct-video links have different embedding/playback requirements. No arbitrary iframe HTML, automatic remote fetching, or privileged bridge in embeds. Keep the current remote-media CSP restriction until that adapter is implemented and tested. Questions render typed inputs with a pending/answered/cancelled lifecycle; submissions resume the originating run instead of becoming unrelated chat messages.

Use a versioned document schema with stable block IDs and bounded updates. First blocks: Markdown, image, video/audio, code, table, diagram, tool result, action preview, form, and extension detail. Add charts and custom interactive lessons as needed.

The agent supplies data to trusted React components. Forms submit typed action IDs through the broker; generated buttons cannot become arbitrary commands. Validate schemas, sanitize Markdown, validate media sources, and provide unknown-block fallbacks. Local artifacts are addressed through controlled handles rather than arbitrary file URLs.

Commit complete validated blocks during streaming; show placeholders for incomplete structures. Keep binary media out of conversation rows and IPC text payloads. Bound block counts, drawing complexity, document size, and media caching.

Third-party interactive content uses an isolated view and scoped message bridge with restricted network access and no Edi preload privileges. MCP Apps defines interactive HTML content in sandboxed iframes; supporting it is a later interoperability step, not a property of every MCP server. [MCP Apps](https://modelcontextprotocol.io/extensions/apps/overview)

Remote content never receives Node access or privileged APIs. Validate IPC senders, restrict navigation, and enforce CSP. [Electron security guidance](https://www.electronjs.org/docs/latest/tutorial/security)

## 10. Hands, illustration, and speech coordination

The presentation controller coordinates pet, hand, card, ink, and audio. Agent requests are semantic: `pointAt(blockId, elementId)`, `drawScene(sceneId)`, `highlight(target)`, `clearInk(scope)`. The controller measures targets and plans movement.

Keep conversation state (`listening`, `thinking`, `awaitingApproval`, `acting`, `responding`, `idle`) separate from visible behavior (`wandering`, `docked`, `pointing`, `drawing`). An explicit state machine prevents competing behaviors.

Planned character behavior includes idle, happy, sad, thinking with a short status bubble, appearing/disappearing, user dragging, optional wandering, and perching on open-window edges. Thought bubbles show user-facing status, not private model reasoning. Dragging takes priority over autonomous motion and cancels it immediately. Keep user drag position, window-edge attachment, emotional expression, and agent state separate; do not encode them as one growing list of skin variants. Window perching requires current OS window geometry and permission review, with a safe fallback when the window moves, closes, or leaves the display. Never move the user's cursor. Wandering is opt-in; reduced-motion and pause controls apply to all nonessential movement.

Scene objects have IDs, bounds, labels, and paths. Hand-tip position and SVG path reveal use the same progress value. Use springs for travel/retargeting and controlled path timing for drawing. Detailed image generation is a separate capability; editable diagrams stay vector-based.

Gestures align with spoken segments. Use word timestamps only if the provider exposes them; otherwise synchronize at segment boundaries. Preserve positions when interrupted and retarget smoothly. Reduced-motion mode uses static pointing and immediate diagram reveal. These choices follow the Apple-design skill's interruptibility and spatial-consistency guidance.

## 10.1. Skins and avatars

Treat a skin as a complete visual avatar, not just a color palette. Different silhouettes, faces, hands, proportions, and animation styles share the same Edi identity, conversation, tools, and behavior. Choosing an avatar leaves the selected voice and personality unchanged; those are independent preferences.

Add **Appearance → Avatars** with a preview grid, selected state, and an Apply action. Preview idle, listening, speaking, pointing, and drawing before applying. Include at least two bundled designs in the alpha to prove that the architecture supports more than the original character. Downloadable skin packs arrive in the beta and appear in the same Appearance picker.

Each pack declares a schema version, ID/version, name/author/license, preview asset, supported renderer, asset files, logical bounds, hit regions, workspace attachment anchor, hand attachment anchors, pointer/pen tip, and supported behavior poses. An adapter maps semantic states to the pack's visual poses; agent code never depends on a particular character's body parts or artboard names. Packs may provide their own hands or explicitly select a built-in compatible hand fallback. Missing optional animations use a documented fallback; missing required geometry makes a pack incompatible.

Keep the skin contract renderer-neutral. Initially accept curated SVG assets; add Rive assets only if the chosen runtime passes packaging/performance checks. Skin packs contain validated assets and data, not arbitrary scripts or privileged UI. Validate SVG references/scripts, asset paths, dimensions, and resource limits through the extension install pipeline.

Preload and validate before applying, then switch body and hands together. Preserve screen position and active conversation. If a hand is drawing, complete or cancel that presentation gesture at a safe boundary before swapping; do not restart the agent or tool action. Recalculate hit regions and anchors for the new geometry. Reduced-motion mode uses a brief fade or immediate replacement. Persist selected skin ID/version in settings, release unused assets, and restore the bundled default if the selected pack is missing, invalid, or removed.

Keep the picker under `features/settings/appearance/`, loaders/adapters under `presentation/skins/`, schemas under `packages/contracts/`, and built-in assets under `resources/skins/`. Downloaded packs use the existing extension store and lifecycle. There is no separate skin service or avatar agent.

## 11. Voice selection and lifecycle

Keyboard decision: **⌥ Space / Option + Space** is the default push-to-talk chord. **Settings → Keyboard Shortcut** must offer shortcut recording, clear/apply/reset, conflict feedback and a readable current binding. Persist only after successful registration; retain the previous working binding if replacement fails. End the held turn when Space or the required modifier is released. Ignore repeats; cancel on input-monitor loss, Sleep, permission loss and shutdown. Do not capture or store unrelated keystrokes. Keep the shortcut registered during Edi's own sleep state so a hold can wake it.

⌥ Space is implemented through a native key-down/key-up helper. The temporary Command–Shift–E shortcut was removed on 2026-09-13; Electron's globalShortcut API has no key-up event, so it cannot provide hold-to-talk. [Electron API reference](https://www.electronjs.org/docs/latest/api/global-shortcut).

Gesture contract (revised 2026-09-13): a plain click on the character does nothing, so Edi never starts listening by accident; keyboard activation opens the character menu. A 350 ms stationary hold selects push-to-talk; release submits that utterance only. Movement of 6 logical pixels before hold activation selects dragging. Once held, movement cannot relocate Edi. Cancel, lost capture, or blur discards the held turn. These modes require actual capture/transcription before displaying active listening. Hands-free conversation stays reachable from the menu bar's Listen item until its entry point is redesigned.

The character menu is a custom rounded translucent panel with keyboard navigation, Escape/outside-focus dismissal, and scoped IPC. The speech pill sits beside the head, flips at screen edges, and does not change the character's hit region. Menu actions are Open Edi, Settings, Sleep Edi and Quit Edi. Listening and Stop are not character-menu actions.

Use a female voice by default; the final bundled voice asset still needs listening approval. Keep voice identity separate from the provider and avatar. Later, support consent-based custom voice enrollment, including the user's girlfriend's voice. Require her explicit consent before recording, uploading, or cloning; show where recordings are processed and provide removal controls for stored samples and custom voice profiles. Check each provider's capabilities and requirements before implementation; a custom voice is not assumed portable between providers. No cloning is implemented or authorized by this planning note.

Transcription, reasoning, and speech synthesis remain independent. Push-to-talk first; text remains available.
Support four explicit speech paths:

- **Pocket TTS:** default lightweight local provider.
- **Chatterbox Turbo:** more expressive local provider.
- **Cartesia:** optional low-latency cloud provider.
- **ElevenLabs:** optional premium cloud provider.

Settings stores the selected provider and voice. Cloud adapters use separate credentials held by main; local adapters
show model availability, download size, and removal controls. Switching providers never silently uploads text or
falls back from local to cloud. Each adapter implements the same bounded, cancellable audio port and translates
semantic mood into only the controls that provider supports.

Cloud auditions require the relevant credentials and approval for any charges. Chatterbox Turbo installation and
benchmarking require a separate download decision; this planning change does not install it.

Settings → Voice shows provider, readiness, voice, local download status or credential setup, and an explicit test action. Settings → AI stores the OpenRouter key and fetches a searchable model list through main (OpenRouter's public catalog, cached for an hour), keeping only models with image input and tool calling, with a typed-ID fallback when it can't load. The saved key is never sent to the renderer; the page shows that a key is saved, and a model change keeps it.

Holding the character or ⌥ Space requests microphone listening and never opens the content card. The bubble must distinguish listening (audio bars) from thinking; show listening only after microphone capture is active. A brief optional female-voice acknowledgement can say “I’m listening” or “Hey [preferred name], I’m listening.” Use a name only when provided; coordinate acknowledgement playback with capture to avoid transcribing Edi's own voice. Denied permissions, missing transcription, or unavailable devices need honest status text, not a listening animation.

Character context menu: Open Edi, Settings, Sleep Edi, Quit Edi. Sleep is an app state, not termination: cancel active runs/audio/presentation, hide windows, suspend proactive work, and leave the global keyboard wake shortcut registered. The shortcut wakes the character and requests listening without opening content or sending an LLM request. Quit terminates the process and unregisters shortcuts. Keep appearance/provider preferences unchanged across sleep.

Measure the actual runtime on the minimum Mac: cold start, warm first audio, sustained generation speed, memory, CPU/GPU, playback gaps, cancellation, pronunciation, consistency, download size, and redistribution terms. A streaming model architecture does not guarantee a streaming API in our chosen runtime. Do not treat earlier vendor latency claims as app benchmarks.

Use bounded spoken-segment/audio queues tagged with run IDs. Stop halts playback and discards stale output immediately, independently of cancelling inference. Load local models during active use and release after an idle timeout. Provide model download progress, hash/version checks, free-space checks, and removal controls.

Default to no raw microphone retention. Local speech does not make hosted reasoning local: settings must show whether transcripts/screenshots leave the device. Cloning a Qwen-generated voice into Pocket is an experiment, not a dependency; it cannot be assumed to transfer emotional control.

## 12. Contracts, persistence, and recovery

Commands: `ask`, `cancelRun`, `respondToApproval`, `installExtension`, `connectAccount`, `pinDocument`, `clearAnnotations`, `previewSkin`, `applySkin`.

Events: `runStarted`, `textDelta`, `documentPatched`, `approvalRequested`, `toolFinished`, `audioChunkReady`, `extensionChanged`, `skinChanged`, `runFinished`.

Envelopes contain protocol version, event ID, run/operation ID, sequence, timestamp, and payload. Validate boundaries, drop cancelled-run events, coalesce frequent UI updates, and apply backpressure to audio. A reopened renderer receives a snapshot plus subsequent events.

Use one SQLite writer in main through repositories. Records include conversations/messages, runs, tool outcomes, approvals, documents/artifacts, extension versions/installs, connections, grants, settings, and usage. Put binary artifacts in a managed directory with retention controls. Diagnostics redact credentials and default to minimal metadata.

Restart restores documents/history and marks unfinished runs interrupted. Reconcile uncertain writes; never automatically replay them or stale approvals. Resume installs from their recorded stage. Conversation persistence is not durable workflow execution.

Optional long-term memory later stores reviewable facts with provenance and deletion. No vector database initially.

## 13. Repository structure

Create a self-contained product under `edi/`. Packages follow domain/process boundaries; ordinary features remain folders.

```text
edi/
  apps/desktop/
    src/main/             # windows, OS, broker, persistence wiring
    src/preload/          # narrow validated bridge
    src/renderer/
      shell/              # routes, navigation, pinning
      features/
        pet/
        conversation/
        content/
        extensions/
        activity/
        settings/
      presentation/       # hands, scenes, motion, playback
      components/
    resources/            # packaged assets, entitlements
  packages/
    contracts/            # commands, events, content/manifest schemas
    agent/                # SDK, prompts, context, discovery, budgets
    capabilities/         # registry, policy, built-ins, connectors
    extensions/           # installs, dependencies, skills, MCP host
    voice/                # adapters, queues, worker protocol
    storage/              # schema, migrations, repositories
  native/                 # only helpers required by verified OS/runtime gaps
  catalog/                # curated metadata and pinned versions
  tests/
    integration/
    desktop/
    fixtures/
  docs/
  pnpm-workspace.yaml
  package.json
```

`contracts` has no provider/Electron dependencies. `agent` depends on contracts and injected tool interfaces, never renderer code. `storage` never imports UI. The desktop composition root wires implementations. Keep one SQLite/settings source rather than duplicating settings across stores.

## 14. Scaling beyond the alpha

One agent and one local database serve the personal app. Lazy discovery, paginated history, bounded queues, worker supervision, and versioned extensions support growth. Additional tools do not require additional agents or services.

Distribution adds signed app updates and verified model/extension downloads. A static catalog can suffice initially. A hosted gateway becomes necessary if Edi pays provider bills, holds service client secrets, sells subscriptions, or runs tasks while the Mac sleeps. User-provided API keys avoid some early backend needs; never embed a shared paid key in a distributed app.

Revisit Mastra or another durable engine for persisted workflows, external-event waits, or background coordination. Keep the same workspace, capability contracts, and presentation controller through that change.
