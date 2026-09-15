# Edi roadmap

2026-09-10 · Milestones with acceptance gates; estimate schedules after hardware/runtime tests

## Progress ledger — 2026-09-13

Milestone **0 was reopened** after the character animations documented for the foundation were found to be static.
The implementation gap is now fixed and native automation passes, but the milestone stays open until the owner
visually accepts the motion in the running app. Manual listening, cloud voice checks, lower-end hardware, and
cross-app/display checks remain follow-up validation rather than blockers for this specific motion gate.

| Area | Evidence / status |
| --- | --- |
| Desktop shell | Implemented; development-app smoke checks pass for two windows, hidden card, expand/collapse, avatar persistence, and pin persistence. |
| Packaged app | Unsigned Apple Silicon app produced; packaged acceptance result is recorded in [`FOUNDATION-VALIDATION.md`](FOUNDATION-VALIDATION.md). |
| Live text | User confirmed OpenRouter works with their key/model. Mocked streaming, errors, and cancellation tests pass. |
| Card navigation | 2026-09-13: “Talk to Edi” and the More menu are replaced by the product sections (Conversations, Library, Skills, Connectors, Appearance, Settings): a title menu when compact, a sidebar when expanded. OpenRouter setup moved to Settings → AI. Settings has AI, Voice (speak replies on/off), Keyboard, Privacy & Permissions (with Activity), and About. Skills and Connectors show honest “not available in this version” states; the fake extension catalog is gone. Library lists saved notes. Destinations are a closed contract enum. Native smoke covers the menu, settings pages, sidebar and persistence. Conversations is still a single thread. Later the same day: a Home section (greeting, ask box, last conversation, recently saved, missing setup) is where the card opens; Settings → AI lists OpenRouter's image-and-tools models with search and shows “Key saved” instead of an empty key field; a hidden pinned card reopens beside Edi; a plain click on Edi no longer listens; the right-click menu is Open Edi, Settings, Sleep, Quit; ⌘⇧E is removed. |
| Skins and motion | Edi (default, from the owner's reference; replaced Mira) and Mochi (cream dumpling from the owner's second reference, with its own softer brown outline and theme; replaced Cloud and Sprout) share geometry/anchor and semantic-expression contracts. Saved Mira/Cloud/Sprout choices migrate to Edi. Appearance has a size slider (0.6–1.6×; the card stays still while dragging) and a happy reaction on hover. Menu and bubbles use native macOS glass; bubbles have a native glass tail (implemented, visual check pending). Edi's hands appear only for gestures; listening and thinking change only the eyes; the mouth follows speech loudness. Idle, blink/gaze, listening, thinking, speaking, happy, attention, and appearance motion are wired to live lifecycle events. Native tests cover every state, every skin, persistence, hit bounds, and reduced motion. Owner visual acceptance, cross-app click-through, and mixed-display checks remain manual. |
| Content | Text, step diagrams, and local-video selection implemented as previews. Valid-video playback and agent-generated diagrams remain pending. |
| Audio / minimum hardware | Pocket/Jane is the wired local default. Chatterbox Turbo is installed and selectable (2026-09-13): it loads in ~30 s idle to 3+ min under load on the 16 GB M2 Pro and speaks at ~2–8× real time, so Jane answers until it is loaded, Stop keeps the model loaded, and Settings → Voice shows loading and speed; ElevenLabs and Cartesia are planned cloud options. Pocket screening is complete and muted Electron streaming passes. See [`benchmarks/voice/RESULTS.md`](../benchmarks/voice/RESULTS.md) and [`AUDIO-RUNTIME.md`](AUDIO-RUNTIME.md); subjective listening, physical audio, packaged runtime distribution, and lower-end hardware remain open. Pocket installation stayed below the approved 2 GB budget; no paid calls. |
| Artifacts and Workspace | 2026-09-13: `workspace.show` (document, checklist, table, html) and `notes.show` display content instead of reading it out. Shown content appears as inline cards in Conversations and opens in its own native-glass artifact window beside the card, with Copy, Download, Show in Finder and Close. Interactive `html` pages run sandboxed (private scheme, CSP sandbox, isolated session, no network or storage). The Edi workspace is Documents › Edi, with notes in Edi › Notes and generated content in Artifacts/{Reports,Checklists,Tables,Interactive}; Library lists, opens and deletes everything (to the Trash). Edi can search, read, update and delete workspace items through reviewed tools. Structured composition blocks (metrics, swatches, charts, cards), diagrams, rename and search are next. |
| Edi self-control and self-awareness | 2026-09-13: Edi can open every page (including Settings itself), change its own character, size, pin, voice and spoken replies, and close or sleep itself, without approval. The setup snapshot now includes where the user is, card state, size, voice loading status, Library notes, abilities (with which ask first) and features not available yet. |
| Model setup | Settings → AI shows three recommended models (newest Gemini Flash, Claude Sonnet, Claude Opus with image and tool support) and opens the full searchable catalog only on request. Model roles and Recommended/Custom routing remain Milestone 2. |
| Presentation accuracy | 2026-09-13: pointing and drawing snap to text recognized locally with Apple Vision (full-resolution capture, memory only). Fixture: mean miss 25.3 → 1.4 image px. Hand pose, label placement and a jump-back bug fixed. Icons without text still rely on the model; content that moves during a reply is not re-tracked; the live capture path needs manual checks. |
| Desktop behavior | Automated drag, placement, approval, and character interaction checks pass. Manual cross-app click-through, focus, Spaces/fullscreen, mixed displays, and permission behavior remain follow-up checks. |

Next: visually accept the repaired character motion and re-close Milestone 0. Then continue Milestone 1 with Edi's truthful runtime snapshot and narrow self-navigation contract, and exercise the
existing screen explanation, pointing/drawing, approval, cancellation, and note flow as one packaged acceptance path.
Done 2026-09-14: multiple saved conversations (list, New conversation, per-conversation history, delete; a quiet
conversation Edi picked up by itself ends after two hours). Also done: desktop context (app, window, page, document,
selection) and scoped file access.

## 0. Validate desktop and audio foundations

Create the product workspace, build scripts, Electron process split, initial contracts, SVG pet, and rounded workspace. Produce a packaged app immediately.

Define the skin asset/animation/anchor contract and try distinct silhouettes. Validate click regions and hand/workspace attachment points before committing to a character rig. Wire idle, blink/gaze, listening, thinking, speaking, happy, attention, and appearance states to the real product lifecycle; keep them provider-independent and safe under reduced motion.

Test click-through regions, focus, drag/pin, stacking, Retina coordinates, displays, Spaces/fullscreen, and capture permission. Audition Pocket and, with separate access, ElevenLabs and Cartesia using identical Edi lines; test one local transcription runtime. Choose minimum hardware from evidence.

**Exit:** packaged launch, independent pet/workspace windows, visibly working semantic character states on every bundled skin, measured voice/runtime recommendation, and documented minimum Mac. Automated motion checks must pass and the owner must visually accept the actual desktop character. If local speech misses targets, choose a hosted alpha adapter while keeping local support planned.

## 1. First complete product interaction

Implement text input, screen capture, AI SDK streaming, cancellation, history, capability broker, one read tool, and one approved write to a chosen location. Add a basic diagram and a hand that points at its elements.

Establish Edi's product-owned identity and a truthful runtime snapshot of its current capabilities, active voice,
avatar, permissions, skills, MCP servers, extensions, and current app location. Add narrow internal navigation for the
major surfaces that already exist. Edi must distinguish available, unconfigured, unavailable, and planned features.

**Exit:** ask about a screen, receive an explanation and diagram, see pointing, approve saving a note, and interrupt another response without stale output. Edi can accurately say who it is, what it can currently do, and where the user is, then navigate to an implemented major section. Denied/cancelled writes do not execute; network failure leaves the UI responsive.

## 2. Rich workspace and voice

Keyboard setup: ⌥ Space hold-to-talk is wired and shown in Settings → Keyboard. Add rebinding with conflict warnings
and reset to default. Validate modifier-first release, key repeat, shortcut conflicts, permission failure, sleep/wake
and cancellation. Optional unbound shortcuts for power users: show/hide Edi,
stop, approve the current request, and open the card.

Render conversation-driven inline graphs, media from supported links, and input questions. No media-type tabs in the main content card; keep example catalogs in developer tooling. Implement linked-video adapters and pending-question lifecycles before enabling remote embeds.

Navigation shell and Home are in place (see Architecture §2). Decide what, if anything, replaces click-to-listen as the hands-free conversation entry point. Multiple saved conversations are done (list, New conversation,
history per conversation). Rich results open inside Conversations, not a separate Content
section. Apply the material hierarchy: light glass for the bubble and chrome, content surfaces for conversation and
results, solid surfaces for settings, forms, code and dense tables. Add image, video/audio, table, code, forms, tool results, and action previews. Implement push-to-talk, transcript display, selected TTS, bounded audio queues, stop controls, progressive SVG drawing, and segment-level speech coordination.

Define semantic content contracts before adding renderers. Conversation and Dynamic Content own ordinary answers and
artifacts; the character bubble stays limited to voice state, concise notices, and request-bound human input such as
approvals, questions, and **View details**. Add the first scoped Edi Workspace artifact only when persistence is
useful, keeping it separate from agent memory and arbitrary filesystem access.

Make Conversations, Library, Skills, Connectors, Appearance, every Settings page, and installed connectors
agent-addressable as each surface ships. Navigation uses a versioned destination
contract, never arbitrary routes.

Local speech is Kokoro (default) and Chatterbox Turbo on MLX; Pocket TTS and the PyTorch Chatterbox build were removed
2026-09-14. Cartesia and ElevenLabs are optional cloud choices with separate user-supplied credentials. Keep personality and semantic moods
(neutral, curious, thinking, happy, excited, confused, concerned, playful, and proud) independent of provider and
skin; adapters map moods to the expression each provider supports.

Settings → AI has the OpenRouter key and a searchable, capability-filtered model picker (Vision · Tools · $ · context).
Add a **Recommended / Custom** setup on top of it. Start with the roles needed by shipped
behavior (Companion and Vision); add Deep Work, Background Work, and Utility only when their corresponding runtimes
exist. Automatic fallback must preserve required capabilities and the user's provider,
privacy, and cost choices.

**Exit:** Edi presents text and playable video, draws an explanation, and speaks through each configured provider.
It can explain its current configuration and navigate to every shipped management surface without claiming missing
capabilities. A pinned result survives visiting Settings. Stop clears speech/gestures immediately. Broken media and
malformed blocks have usable fallbacks.

Extend Appearance → Avatars with previews and at least two bundled skins. Apply a skin without resetting conversation, tools, or voice; persist it across restart. Verify both avatars listening, speaking, pointing, and drawing, including switching while a presentation is active. Invalid or missing assets fall back to the default avatar.

## 3. Installable capabilities and Edi Workspace

Build Skills and Connectors with curated discovery, details, setup forms, install records, permissions, dependency handling, and declarative skill-folder import. Skills carry a trust level (built-in, verified, community, local) and declare the tools, filesystem and network access, connected apps, MCP dependencies, write actions, and helper code they need. Connector credentials (including a user-supplied Composio project, if used) live in the OS credential store and are managed from Connectors. Add metadata-based skill selection, one real connector, and remote MCP through Streamable HTTP. Integrate health checks, repair, account binding, and namespaced tool discovery.

The Edi workspace is one folder, Documents › Edi, owned by Edi: Notes today; Documents, Diagrams, Reports and Exports
folders as those artifact types ship. Library shows everything in it. Turn the scoped artifact foundation into Edi Workspace: notes, diagrams, reports, and exports with semantic types,
stable IDs, provenance, temporary-versus-saved state, search, update, and deletion. Library is the user-facing home for these artifacts. A follow-up such as “add the MCP layer” updates
the existing diagram instead of generating an unrelated one. Saving inside Edi never widens file access: the
person's own files are reached only through the file tools, scoped to folders they allow (2026-09-14). Keep connector architecture provider-neutral; Composio may be tested as an adapter but
must not replace Edi's capability broker, approval policy, or secure credential boundary.

**Exit:** install a skill, connect an account, add a remote MCP server, and use them in a task. Create, reopen, update,
and export a local artifact. Disable/disconnect and delete flows work. Expired auth, duplicate tool names, partial
installs, unsupported helper scripts, missing dependencies, and invalid artifacts are understandable and recoverable.

Setup returns to the initiating task with a proposed action; it does not authorize executing that action automatically.

## 4. Release v0.1 private alpha

Add an app update channel (signed automatic updates with release notes) and the menu bar item from the product plan
(summon, pause, stop, settings, quit). Harden migrations, interrupted-run recovery, artifact cleanup, usage display, secret storage, model downloads, permission revocation, and extension failures. Add transparent, off-by-default anonymous diagnostics only if the user can inspect and disable them and prompts, screenshots, audio, transcripts, file contents, secrets, and connected-app data are excluded. Sign/notarize before testing outside the developer machine.

**Release demonstration:**

1. Launch a packaged Edi.
2. Ask a spoken screen question.
3. Receive speech, text, and an illustrated explanation.
4. Pin it and open Extensions.
5. Install a declarative skill and connect a service.
6. Complete a real task with a reviewed side effect.
7. Quit/relaunch and restore history, settings, and installed capabilities.
8. Interrupt speech, deny an action, and disconnect a service.
9. Preview and select another avatar; verify its hands/animations and restore the selection after relaunch.

**Exit:** demonstration passes on minimum hardware and a second supported display configuration. Include only voice runtimes that pass their own checks.

## 5. Desktop hands and annotations

Character behavior also includes user dragging, optional wandering, and window-edge perching. Introduce an interruptible behavior controller and emotional poses (idle, happy, sad, thinking/status bubble, appear/disappear); prioritize user control and reduced-motion support. Validate window tracking and its permission needs before promising perching on arbitrary apps.

Harden the existing per-display hand overlay, coordinate mapping, and bounded arrows/circles/boxes/underlines. Text-based alignment exists; add target freshness (re-find a target that scrolled or moved before drawing) and clear controls. Investigate accessibility metadata for external elements and window edges; request the associated permission only for features using it.

**Exit:** point/circle accurately across mixed-scale displays without moving the cursor or swallowing clicks. Moving/scrolling targets stops or refreshes annotations. Escape clears ink. Test Spaces, fullscreen, and screen-sharing behavior.

Visual annotation ships separately from any future clicking/typing automation.

## 6. Trusted local MCP and updates

Add local stdio servers, declared runtimes, pinned packages, staged updates, permission-change review, rollback, process limits, crash recovery, and removal cleanup. Broaden imports to immutable repository revisions or verified archives.

Add downloadable skin packs through Extensions → Skins, reusing asset validation, versions, updates, and removal. Installed packs appear in Appearance. Removing the active skin selects the bundled default without losing conversation or settings.

Define executable skill-helper support only after runtime permissions are understood. Without OS isolation, explicitly treat local code as trusted code running with user privileges.

**Exit:** install/run/update/rollback/remove a trusted local MCP extension without losing unrelated data/accounts. A server crash cannot freeze Edi. Dependency setup does not silently execute install hooks.

## 7. Background work and proactive v0.2 beta

Separate durable tasks from conversations. Add queued/running/waiting/approval/completed/failed/cancelled states,
bounded concurrency, progress, cancellation, recovery, and results saved as Workspace artifacts. Add explicit
schedules and condition-based watches before broader proactivity.

Add Settings → Behavior only now, when there is proactive behavior to control. Add opt-in proactive behavior: silent default, sensing settings, local change/idle heuristics before model calls, cooldown, and spending limits. Periodic capture requires an explicit setting separate from one-shot screen questions.

Build a local, rule-based suggestion engine before any model-driven proactivity: foreground app identity and, where
safely available, browser hostname, matched against installed skills, connectors and cooldown history (for example
GitHub in front and not connected → “Connect GitHub?”). No screen capture and no LLM call. With calendar permission
through a connector, surface upcoming events and preparation reminders from real calendar state, never from model
memory. Let a substantial background task temporarily override its model.

Use the character bubble for silent, rate-limited task results and reminders with a clear reason and **View** action.
Do not use continuous screenshots. Quiet/Balanced/Expressive settings govern interruption, and voice is reserved for
important or explicitly spoken alerts.

Add sandboxed MCP Apps or other interactive extensions only after scoped messaging tests. Add curated publishing metadata and verified updates. Consider user-editable memory when repeated context becomes a real need.

**Exit:** the flagship demo passes: “find suitable frontend jobs while I work”, the user returns to their editor, and
a later bubble opens the saved Library report. More generally, the user delegates work, returns to another app, can inspect/cancel it, and later receives one useful,
non-duplicated result whose source and permissions are clear. Restart recovery never repeats a side effect.
Observation, commentary, and extensions are user-controlled. Third-party views cannot invoke unrelated capabilities.
Idle Edi meets the resource budget selected in milestone 0.

## 8. External computer use and community ecosystem

Treat external app control as a distinct high-trust capability, separate from screen awareness and Edi's own
navigation. Start disabled; scope it by app and action, show when active, provide an emergency stop, and route every
consequential operation through the existing approval and activity systems.

Only after manifests, signing, compatibility, rollback, and moderation are mature, add local/private imports and a
curated community path for declarative skills and skins. Skins never contain executable privileges. Custom voice
profiles remain private by default and require explicit consent when the voice belongs to someone else.

**Exit:** computer use is visibly bounded and interruptible, and an imported declarative skin or skill can be
validated, disabled, removed, and audited without bypassing capability policy.

## Feature coverage

Every planned feature area, where it lands, and where it stands (2026-09-13). “Principle” means
a rule every milestone follows rather than a feature with its own gate.

| Feature | Milestone | Status |
| --- | --- | --- |
| Composio / connected apps, BYOK, keychain secrets, broker stays authoritative | 3 | Planned; Connectors page shows an honest empty state |
| Skill library: trust levels, declared requirements, declarative first | 3 (local/curated), 8 (community) | 4 skills by Fewerlabs, your own in Documents › Edi › Skills (Skill Creator), Skills page with segments, categories and details; community catalog planned |
| Open-source distribution: signed builds, website, auto-update | 4 | Planned |
| Download and anonymous usage analytics, off by default, inspectable | 4 | Planned; Privacy page states no analytics are collected |
| Skill and character analytics: installs, enables, uses (anonymous, part of the same opt-in analytics) | 4 (with analytics), 8 (community catalog) | Planned (owner, 2026-09-15) |
| Local-first preferences, secrets separate, preference vs availability | 0–2 | Done for current settings; Kokoro stands in while Chatterbox loads |
| Voice providers: local, Cartesia, ElevenLabs | 2 | Done: Kokoro and Chatterbox Turbo (MLX), Cartesia and ElevenLabs with the person's keys; Pocket removed |
| Computer use as a separate, off-by-default, interruptible capability | 8 | Planned; listed as not available |
| Self-awareness from runtime state | 1 | Done (setup snapshot, abilities, not-yet-available list, location) |
| Conversational navigation of Edi itself | 1–2 | Done for every page; preference changes and close/sleep too |
| Subtle proactive suggestions from local signals, no continuous capture, Off/Subtle/Helpful | 7 | Planned; scale naming is an open decision |
| Keep identity, voice, skin, capabilities, permissions separate | Principle | Enforced by contracts; skin changes never touch capabilities |
| Private custom voices with consent | 8 | Planned |
| Custom and community skins as declarative, privilege-free packages | 6 (packs), 8 (community) | Character packages: install from a .edichar file, every mood previewed; community library planned |
| Skill vs skin communities; creator profiles | 8 | Planned; formats kept compatible |
| Edi Workspace with a scoped local folder; the person's files only through allowed folders | 2–3 | Workspace done (Documents › Edi, Library). File tools for Desktop, Documents, Downloads, added folders and Full Disk Access; changes need approval |
| Dynamic content area renders rich artifacts | 2 | Documents, checklists, tables, notes and sandboxed interactive HTML in the artifact window; composition blocks planned |
| Artifact lifecycle: show → save → revisit → export | 2–3 | Show, auto-save, Library, copy, download (md/csv/html) done; rename, pin, regenerate planned |
| Semantic artifact types, with HTML only sandboxed | 2 | Four structured types plus `html`, isolated from Edi (CSP sandbox, private scheme, isolated session) |
| Diagrams as first-class, updatable artifacts | 2–3 | Step diagrams only; updatable diagrams planned |
| Reports and exports (save ≠ export) | 3 | Planned |
| Workspace is not memory | Principle | Held: nothing shown or saved is used as memory |
| Ambient companion, background tasks, task lifecycle, watches | 7 | Planned |
| Schedule and calendar awareness from real calendar state | 7 (after a calendar connector in 3) | Planned |
| Bubble as ambient channel, explicit proactivity sources, levels, voice vs silent, companion tone | 7 | Bubble foundation done (voice states, approvals, artifact previews) |
| Flagship “find jobs while I work” demo | 7 exit | Planned |
| AI provider, Recommended/Custom, roles, cost preference, compatibility, fallbacks, advanced | 2 (roles), 7 (background role) | Recommended picks and compatibility filtering done; roles and cost preference planned |
| Compact bubble as HITL surface with compact and expanded representations | 2 | Approvals and artifact previews done |
| Liquid Glass materials, hierarchy, shared language | 2 | Native glass for floating windows; solid settings; hierarchy applied |
| ⌥ Space default, configurable shortcuts | 2 | ⌥ Space done; rebinding planned |
| Modular monorepo by domain and trust boundary | Ongoing | contracts, capabilities, storage extracted; others when boundaries stabilize |
| Multi-surface Edi (core independent of Electron) | Principle | Domain packages stay free of Electron |

## Conditional later work

| Product need | Investment |
| --- | --- |
| Edi pays for API calls or sells subscriptions | Gateway, accounts, quotas, billing |
| Large skill/reference corpus | Retrieval index; embeddings if useful |
| Tasks need specialist reasoning contexts | Bounded subagents with inherited grants |
| Untrusted executable marketplace | Enforced isolation, signing, review, revocation |
| Additional operating systems | Platform adapters and separate QA |

## Verification and performance

Automate contract/policy tests for cancelled and denied actions, stale approvals, event ordering, unknown blocks, compatibility, and permission updates. Use fake model/MCP services for deterministic failures and a small live provider smoke suite.

Packaged integration tests cover IPC, installs, reconnects, history, and crash recovery. Manual macOS checks cover focus, Spaces, permissions, microphones, and mixed-scale displays. Test hostile Markdown and a third-party view trying to cross its bridge before enabling remote UI.

Voice comparisons use identical short lines, technical vocabulary, numbers, names, and emotional phrases. Separate cold/warm latency and blind listening from resource measurements. Measure the chosen runtime, not just the model's advertised architecture.

Initial targets to validate, not public guarantees: immediate input feedback, visible text within 2 seconds on the test network, first speech within 1 second of a speakable segment, playback stop within 150 ms, and no sustained repaint loop while idle. Record idle/active memory and CPU budgets after milestone 0. Missed targets trigger an explicit design or target revision.

## Initial foundation backlog — completed

1. ✅ Create `edi/`, build scripts, and packaged launch.
2. ✅ Define commands/events, worker supervision, and preload bridge.
3. ✅ Build SVG pet, rounded workspace, placement, and display tests.
   Define a shared skin contract and validate it with a second avatar silhouette.
4. ✅ Record audio/runtime evidence and a provisional minimum-hardware decision.
5. ✅ Add streaming agent, cancellation, and SQLite history.
6. ✅ Add capability broker, one approved write, and activity view.
7. ✅ Add diagram blocks, measured targets, and the pointing/drawing hand foundation.

## Open decisions

- Validate the provisional minimum chip/RAM on lower-end hardware; decide whether Intel Macs are supported.
- Kokoro is the default local voice and Chatterbox Turbo the expressive one (both MLX); ElevenLabs and Cartesia are optional cloud choices. Pocket was removed 2026-09-14. Measured support on lower-end hardware remains open.
- Default voice must be female. Later custom voice enrollment may use the user's girlfriend's voice with her explicit consent; include recording/upload disclosure and deletion controls. Defer cloning until after the current audio foundation work.
- First connector and its desktop OAuth feasibility.
- SVG versus Rive after trying the character interaction.
- Proactivity scale: two scales have been proposed, Off/Subtle/Helpful (suggestions) and Quiet/Balanced/Expressive
  (overall behavior). Pick one user-facing control, or define them as two distinct settings, before building Behavior.
- Personal build uses a user-provided OpenRouter key (selected and live-tested). Edi-funded usage for distribution remains a separate decision.

Contracts, workspace design, and extension lifecycle can proceed before these choices. Resolve each before its runtime, asset, or distribution commitment.
