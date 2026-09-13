# Edi working notes

This file is exploratory and is not an implementation specification. The canonical product decisions live in
[`EDI-PRODUCT-PLAN.md`](../../EDI-PRODUCT-PLAN.md), [`ARCHITECTURE.md`](ARCHITECTURE.md), and
[`ROADMAP.md`](ROADMAP.md). When a suggestion is accepted, move the decision into those documents
and keep implementation guidance in [`CODEBASE.md`](CODEBASE.md).

## Review outcome — 2026-09-12

These notes have now been reconciled with the product decisions and milestone plan.

- **Accepted for the current roadmap:** truthful self-awareness, first-party app navigation, provider-independent
  personality/moods, semantic dynamic content, a scoped local Workspace, role-based AI configuration, narrow
  preload/IPC boundaries, and one capability/approval system for every integration.
- **Staged after the core interaction:** background tasks, watches, proactive suggestions, opt-in telemetry,
  community publishing, and external computer control. They are useful directions, not private-alpha gates.
- **Overridden by settled decisions:** Edi's shortcut is **⌥ Space**; ordinary answers stay in the conversation or
  Dynamic Content area; the character bubble is for voice state, concise notices, and request-bound human input;
  local voice never falls through to a cloud provider without the user's explicit selection; and proposed packages
  are extraction candidates, not folders to create in advance.
- **Card navigation (2026-09-13):** sections are Conversations, Library (this document's "Edi Workspace"), Skills,
  Connectors (MCP included), Appearance, and Settings. Settings shows only groups that control something real;
  Behavior, Computer Use, analytics, advanced AI routing, and custom voices wait for their runtimes. Keys live where
  they're used, so there's no Providers page. See Architecture §2.
- **Provider-neutral where possible:** Composio is one possible connector adapter, not the connector architecture.
  Edi's contracts, approvals, credential handling, and connection records must not depend on it.

## Connected Apps, Skills, Preferences, Computer Use, Telemetry, and Proactive Suggestions

### 1. Composio integration

Edi should be able to connect to external apps such as Gmail, Google Calendar, GitHub, Slack, Notion, etc. through Composio.

For the current open-source desktop version, Edi does **not** need a separate external backend.

Preferred architecture:

- Edi desktop app
- trusted Electron main process
- Composio SDK/API
- connected external apps

Important rules:

- Do not embed a shared Composio production secret in the open-source app.
- Use a BYOK/BYOP model initially, similar to OpenRouter.
- Users configure their own Composio credential/project where needed.
- Store secrets in the OS keychain/secure credential store, not plain settings JSON.
- OAuth/account-connection flows should be handled through Composio.
- Edi’s existing capability/approval broker remains authoritative.
- Composio tools must not bypass Edi’s permission or approval model.
- Read-only actions can often execute directly.
- Consequential actions such as sending, deleting, installing, disconnecting, or modifying data should still be reviewed/approved based on Edi’s policy.
- Do not expose hundreds of tools to the model at once. Use discovery/router/session-style loading so only relevant tools are available for the current task.

Longer term, an Edi backend only becomes necessary if Edi itself funds API usage, manages shared provider credentials, subscriptions, accounts, quotas, billing, or hosted services.

---



### 2. Skill library and community skills

Edi should have a skill library, and community-created skills are a good fit for the open-source model.

Suggested trust levels:

- Built-in skills
- Verified skills
- Community skills
- Local/private skills

Skills should declare what they need:

- tools/capabilities
- filesystem access
- network access
- connected apps
- MCP dependencies
- write/destructive actions
- executable helper code, if any

Prefer **declarative skills** as the default community format.

Declarative skills can contain:

- instructions
- workflows
- examples
- metadata
- tool references

Executable extensions should be treated as higher risk.

Anything involving:

- arbitrary local code
- shell commands
- package installation
- local MCP runtimes
- native binaries

should require stronger trust, clearer warnings, and stricter review.

Long-term model:

> Open skill specification + official curated registry + community publishing + local/private installs

The official Edi skill library should be the curated discovery layer, not the only possible source.

Community skills must never bypass Edi’s capability, permission, or approval boundaries.

---



### 3. Open-source distribution

Edi can be fully open source and still have an official downloadable product.

Expected distribution model:

- public source code on GitHub
- official Edi website
- signed/notarized macOS builds
- downloadable `.dmg` or `.zip`
- versioned releases
- automatic updates later
- community forks/contributions

Normal users:

> website → download → install

Developers:

> GitHub → clone → build/modify

GitHub is the source/community layer.

The Edi website is the product/download layer.

The skill library is the ecosystem layer.

Open source does not mean there cannot be an official canonical Edi product.

---



### 4. Download and usage analytics

Track downloads and usage separately.

Downloads can come from:

- GitHub release asset counts
- website download-button clicks
- version-specific downloads
- referral/source attribution

Actual usage should use privacy-conscious anonymous telemetry.

Useful anonymous metrics:

- first launch
- app started
- active version
- platform/architecture
- weekly/monthly active installations
- feature adoption
- extension installs
- skill installs
- MCP connections
- voice-provider selection
- avatar changes
- approvals/denials
- update success/failure

Do **not** send:

- conversations
- prompts
- screenshots
- microphone audio
- transcripts
- file contents
- email/calendar content
- API keys
- OAuth tokens
- sensitive tool results

Telemetry should be transparent and user-controlled.

Suggested setting:

> Settings → Privacy → Share anonymous usage analytics

Ideally Edi’s telemetry implementation remains visible in the open-source codebase.

---



### 5. User preferences

Use a **local-first preference model**.

No Edi account should be required just to store normal preferences.

Suggested preference groups:

- Appearance
- Voice
- Behavior
- Interaction
- Privacy & Permissions
- Providers & Connections

Examples:

Appearance:

- avatar
- size
- animation intensity
- reduced motion

Voice:

- provider
- selected voice
- volume
- speaking speed
- speech enabled/disabled

Behavior:

- quiet/balanced/expressive
- proactive suggestions
- wandering later
- notification style

Interaction:

- keyboard shortcut
- push-to-talk
- pinned state
- startup behavior

Privacy:

- screen access
- microphone access
- analytics
- proactive sensing

Providers:

- OpenRouter
- Composio
- Cartesia
- ElevenLabs
- MCP connections

Keep normal preferences separate from secrets.

Normal preferences can live in the existing settings store.

Secrets belong in the OS keychain/secure credential store.

Also distinguish preference from availability.

Example:

- preferred voice = Chatterbox
- runtime available = false

Edi should explain that the preferred runtime is unavailable and offer valid alternatives. A local voice must never
silently fall back to a paid or cloud provider; changing that privacy/cost boundary requires explicit selection.

---



### 6. Voice providers

Current voice setup discussed:

Local:

- Pocket TTS
- Chatterbox Turbo

Cloud:

- Cartesia
- ElevenLabs

Pocket is the lightweight local option.

Chatterbox Turbo is the more expressive local option.

Cartesia is a fast cloud option.

ElevenLabs is the premium cloud option.

Edi’s personality and semantic mood system should remain independent of TTS provider.

Changing voice should not change who Edi is.

---



### 7. Computer use

Treat computer use as a separate, high-trust capability.

Distinguish:

1. Screen awareness
   “Look at my screen and explain this.”
2. Internal Edi navigation
   “Open Edi Settings.”
3. External computer use
   “Click this in Safari.”
   “Fill this form.”
   “Type this message.”

Computer use should be:

- off by default
- explicitly enabled
- permission-scoped
- app-scoped where possible
- visible while active
- instantly interruptible
- approval-gated for consequential actions

Possible future Settings area:

> Settings → Computer Use

Controls could include:

- enable/disable
- allowed apps
- blocked apps
- ask before clicking
- ask before typing
- always confirm consequential actions
- activity history
- emergency stop

Do not request all OS permissions up front.

Ask for screen/accessibility/input permissions only when a feature actually needs them.

Keep external computer control separate from internal Edi navigation.

---



### 8. Edi self-awareness

Edi should understand:

- who it is
- how it should behave
- which capabilities it currently has
- which voice is active
- which avatar is active
- what permissions are granted
- which skills are installed
- which MCP servers are connected
- which external apps are connected
- where the user currently is inside Edi

Edi should not answer these from static assumptions.

Its self-knowledge should come from authoritative runtime state.

Example:

> “What apps can you access?”

should reflect actual connected apps.

If GitHub is disconnected, Edi should not pretend it can use GitHub.

This self-awareness should also power suggestions and internal navigation.

---



### 9. Internal app navigation

Edi should be able to navigate its own app conversationally.

Examples:

- “Take me to Appearance.”
- “Open keyboard settings.”
- “Show me your skills.”
- “Which MCP servers are connected?”
- “Where do I manage extensions?”

Internal Edi navigation should not require screen vision or computer use.

It is a first-party app capability.

Harmless navigation can happen automatically.

Consequential changes still follow approval/policy rules.

---



### 10. Subtle proactive suggestions

Edi should eventually have subtle contextual suggestions similar to the HeyClicky example.

Desired UX:

A small avatar/status bubble with:

- an icon
- one short line
- no forced expansion
- no voice interruption
- short timeout
- click to open the relevant workspace/setup
- dismiss/cooldown behavior

Examples:

- GitHub icon → “Connect GitHub?”
- Calendar icon → “Want me to use your calendar?”
- Skill icon → “There’s a skill for this.”
- MCP icon → “This app has an MCP integration.”
- Sparkle icon → “I can explain this.”
- Screen icon → “Ask me about this screen.”

The avatar bubble should only give the hint.

The full setup/details should open in the workspace.

---



### 11. How proactive suggestions should work

Do not continuously screenshot or send screen content to a model just to generate suggestions.

Prefer a local deterministic suggestion engine.

Potential context signals:

- foreground app identity
- browser hostname/domain where safely available
- installed capabilities
- installed skills
- connected apps
- MCP availability
- current Edi state
- recent dismissals
- cooldown history

Conceptually:

> local context signals
> → suggestion engine
> → capability/skill/connector registry
> → relevance + privacy + cooldown rules
> → avatar suggestion bubble
> → click
> → workspace/setup

Example:

If:

- current site is GitHub
- GitHub connector is not connected
- suggestion cooldown allows it

Then:

> “Connect GitHub?”

No LLM call is needed.

---



### 12. Privacy principle for suggestions

Important product principle:

> Edi can notice context without constantly watching content.

Knowing:

> “The foreground app/site is GitHub”

is very different from continuously reading the page or capturing screenshots.

Screen capture should remain tied to explicit user requests unless the user later opts into a separate proactive visual-awareness feature.

Suggestions should be conservative and heavily rate-limited.

Suggested default:

> Subtle

Potential user controls:

- Off
- Subtle
- Helpful

Categories:

- Skills
- Connected apps
- Edi features
- Setup improvements

The user should always be able to disable proactive suggestions entirely.

---



### 13. General architectural principle

Keep these concerns related but separate:

- identity
- personality
- expression
- voice
- avatar
- app navigation
- screen awareness
- external connectors
- skills
- MCP
- computer use
- proactive suggestions
- telemetry
- permissions

Changing one should not unexpectedly redefine another.

Examples:

- changing avatar should not change Edi’s identity
- changing voice should not change capabilities
- installing a skill should update capability awareness
- internal navigation should not require external computer control
- proactive suggestions should not require continuous screen capture
- community skills should never bypass the capability broker

The overall goal is:

> Edi should feel aware, capable, extensible, and helpful without becoming intrusive or unsafe.

### 14. Custom user voices

Edi should allow users to add their own private voice profiles under Voice settings.

Possible flow:

> Settings → Voice → My Voices → Add Voice

Users should be able to:

- choose the underlying voice provider
- record or upload voice samples
- preview the generated voice
- name the voice
- set it as active
- delete it later
- remove source recordings where supported

The UI should clearly explain whether the voice processing stays local or is uploaded to a cloud provider.

If the voice belongs to another person, Edi should require a clear acknowledgement that the user has permission/consent to clone or use that voice.

Keep custom voices separate from Edi’s identity and personality.

Changing or creating a voice should change how Edi sounds, not who Edi is.

For now, custom voices should be treated as **private/personal assets**.

Do not prioritize a public community voice marketplace yet because voice sharing introduces significantly higher risks around:

- consent
- impersonation
- identity misuse
- moderation
- copyright
- abuse

Public/shared voices can be considered much later if there is a clear need and stronger safeguards.

---



### 15. Custom skins

Users should also be able to add their own Edi skins.

Possible flow:

> Settings → Appearance → Avatars

with sections such as:

- Built-in
- Installed
- Community
- Import Skin

A skin should follow a clear Edi skin contract and describe only presentation-related behavior.

A skin package may include:

- character assets
- expression mappings
- animation mappings
- listening/speaking states
- pointing/drawing hand anchors
- geometry
- hit regions
- attachment points
- size/scaling information
- metadata
- preview image
- author/version information

Edi should validate a skin package before allowing it to become active.

Changing skins must not reset or modify:

- conversation
- capabilities
- skills
- connected apps
- voice settings
- permissions
- personality
- memory
- agent state

A skin changes how Edi looks and expresses itself, not what Edi is capable of doing.

The current built-in foundation proves this boundary with six provider-independent states: idle, listening,
thinking, speaking, happy, and attention. Edi, Cloud, and Sprout all consume the same validated state contract.
Future skin packages should extend that contract by version instead of introducing provider-specific animation
commands.

---



### 16. Community skins

A community skin ecosystem is a good fit for Edi and should be considered part of the long-term extension model.

Progression should be:

> built-in skins
> → locally imported skins
> → downloadable official skin packs
> → curated community skin library

Community members could create different visual interpretations of Edi while all skins use the same underlying identity and semantic mood system.

Examples could include:

- minimal Edi
- pixel Edi
- robot Edi
- ghost Edi
- retro Mac Edi
- stylized character variants

Community skins should be much safer than executable skills.

Important rule:

> A skin changes presentation, not privileges.

Community skins should ideally be declarative asset packages.

They should not automatically receive:

- filesystem access
- network access
- shell access
- MCP access
- connected-app access
- arbitrary JavaScript/native execution
- capability broker access

Executable behavior should not be hidden inside a visual skin package.

This keeps skin installation low-risk.

---



### 17. Skill community vs skin community

Edi can eventually support two different community ecosystems:

**Community Skills**

Extend what Edi knows how to do.

Examples:

- workflows
- domain expertise
- tool usage instructions
- integrations
- specialized tasks

Skills interact with Edi’s capability and approval system.

**Community Skins**

Extend how Edi looks and expresses itself.

Examples:

- appearance
- animation
- expressions
- character geometry
- gestures

Skins should not introduce new capabilities.

The distinction should remain clear:

> Skills affect capability.
> Skins affect presentation.

Both can use an official Edi discovery library while still supporting manual/local installation.

---



### 18. Creator ecosystem

Long term, Edi could support creator profiles in the community library.

A creator might publish:

- skins
- skills
- possibly other declarative extensions later

Possible metadata:

- creator name
- source repository
- verified status
- version
- downloads
- ratings
- compatibility
- last updated
- permissions for skills
- preview media for skins

This should not be a near-term requirement, but the skill/skin formats should avoid architectural decisions that would make a creator ecosystem difficult later.

---



### 19. Overall personalization principle

Edi should keep these separate:

- identity
- personality
- voice
- skin/avatar
- mood
- capabilities
- permissions
- skills
- connected apps

Examples:

- changing a skin does not change Edi’s personality
- changing a voice does not change Edi’s permissions
- installing a skill does not change Edi’s identity
- changing an avatar does not disconnect apps
- creating a custom voice does not affect agent behavior

This allows users to heavily personalize Edi without destabilizing the agent underneath.

The goal is:

> Users should be able to make Edi feel like their own character while Edi’s identity, capability model, security boundaries, and agent behavior remain consistent.

### 20. Edi Workspace and local artifacts

The current Edi Notes capability should evolve into a broader **Edi Workspace** concept.

The purpose is to give Edi a safe, local area it owns for creating, reading, updating, organizing, and presenting artifacts without requiring arbitrary filesystem access.

Edi Workspace can contain:

- notes
- checklists
- diagrams
- reports
- generated summaries
- exports
- structured data
- saved research/results
- task outputs
- other Edi-generated artifacts later

The existing Notes tool can remain as one capability within this workspace rather than being removed.

Conceptually:

> **Edi Workspace**
>
> - Notes
> - Diagrams
> - Reports
> - Exports
> - Other generated content

This should remain distinct from external systems such as Google Drive, Notion, Obsidian, Dropbox, etc.

Edi Workspace is Edi's built-in local working area.

Connected services are the user's external systems.

---



### 21. Workspace security boundary

Edi Workspace should have a clearly defined local storage boundary.

Edi should be able to:

- list workspace items
- search them
- read them
- create them
- update them
- rename them
- export them
- delete them according to the normal approval policy

This should **not automatically grant arbitrary filesystem access**.

The capability should be scoped to Edi's own workspace directory.

If Edi later needs to operate outside that directory, that should go through a separate filesystem capability and permission model.

This makes Edi useful locally even when:

- there is no internet connection
- Composio isn't configured
- no MCP servers are installed
- no external apps are connected

---



### 22. Dynamic Content Area

Artifacts created in Edi Workspace should integrate directly with Edi's existing **dynamic content area**.

The dynamic content area should not be limited to conversational text.

It should be able to render richer Edi artifacts such as:

- Markdown/text notes
- checklists
- diagrams
- charts
- tables
- reports
- images
- generated documents
- structured results
- exported files
- media where appropriate

For example:

> User: “Compare these three options for me.”

Edi could respond conversationally, generate a comparison table/report, and display that artifact directly in the dynamic content area.

Or:

> “Draw the architecture we're discussing.”

Edi creates a diagram in Edi Workspace and immediately renders it in the content area.

Or:

> “Make me a report from this.”

Edi generates the report, stores it in the Workspace, and displays it without forcing the user to open another application.

---



### 23. Artifact lifecycle

Edi-generated content should have a simple lifecycle:

> conversation/task
> → generate artifact
> → display in dynamic content area
> → optionally save to Edi Workspace
> → edit/update later
> → export/share externally when requested

Some artifacts can automatically belong to the workspace if persistence is clearly expected, while temporary outputs can remain ephemeral until the user chooses to save them.

The UI should make this distinction understandable.

Possible actions on displayed artifacts:

- Save
- Pin
- Rename
- Edit
- Regenerate
- Export
- Open in Workspace
- Delete

The exact actions depend on the artifact type.

---



### 24. Dynamic content should use semantic artifact types

Avoid treating everything as HTML or an arbitrary renderer payload.

Edi should understand what kind of artifact it created.

For example:

- `note`
- `diagram`
- `report`
- `table`
- `chart`
- `checklist`
- `image`
- `file`
- `media`

The artifact model should carry metadata such as:

- ID
- type
- title
- created/updated time
- source task/conversation where appropriate
- persistence status
- renderer information
- export formats
- file location/reference
- version information where necessary

This allows the dynamic content UI to select the correct renderer while keeping artifact storage separate from presentation.

---



### 25. Diagrams as a first-class Edi capability

Diagrams should be treated as a real artifact rather than just screenshots/images generated during conversation.

Edi should eventually be able to:

- generate a diagram
- show it progressively in the dynamic content area
- save it
- reopen it
- update it based on follow-up instructions
- export it
- point to parts of it while explaining

Example:

> “Show me how this repository is structured.”

Edi could generate an architecture diagram and display it while explaining each part.

A follow-up such as:

> “Add the MCP layer.”

should update the existing diagram rather than necessarily generating an unrelated new one.

This fits the roadmap's existing diagram and pointing-hand work.

---



### 26. Reports and exports

Reports should also be first-class Workspace artifacts.

Examples:

- research report
- project summary
- meeting summary
- architecture review
- comparison report
- debugging report
- activity summary
- connected-app results

A report should be viewable directly inside Edi and exportable where supported.

Export formats can grow incrementally based on actual product needs, for example:

- Markdown
- plain text
- PDF
- image
- JSON/CSV for structured outputs
- other document formats later

Exporting is different from saving.

> **Save** keeps something inside Edi Workspace.

> **Export** creates something intended for use outside Edi.

Keep those concepts separate in the UX and architecture.

---



### 27. Edi Workspace vs memory

Do not use Edi Workspace as a substitute for agent memory.

These are different systems.

**Memory**

Information Edi uses to maintain useful context about the user and previous interactions.

**Workspace**

Artifacts the user/Edi intentionally creates and can inspect/manage.

A report stored in the Workspace should not automatically become long-term agent memory.

Likewise, something Edi remembers about user preferences does not need to become a visible Workspace file.

This separation should remain explicit.

---



### Updated product principle

Edi should not only answer questions.

It should be able to **produce things**.

The broader interaction model becomes:

> **Talk → understand → act → create → display → save → revisit → export**

The dynamic content area is where the user experiences those results, while **Edi Workspace is the persistent local home for the artifacts behind them**.

That makes the existing Notes tool worth keeping, but gives it a much clearer long-term role instead of allowing it to grow into an isolated mini note-taking app.

### 28. Edi as an ambient desktop companion

Edi’s core identity should go beyond being an assistant that only responds when spoken to.

Edi should feel like a **desktop companion that is present while the user works, can help in parallel, keeps track of important things, and speaks up only when useful**.

A good product framing:

> Edi is a desktop companion that lives alongside you, talks with you, helps with your work, handles useful tasks in the background, watches your schedule, and quietly brings important things to your attention while you focus.

Edi should combine several roles:

- companion
- work assistant
- background worker
- schedule assistant
- proactive helper
- action agent

The companion aspect is important. Edi should not feel like a normal notification system with a character added on top.

Its personality, animation, voice, expressions, and subtle presence should make interactions feel conversational and natural.

---



### 29. Background tasks and parallel work

Edi should eventually support background tasks that are independent from the currently active conversation.

Example:

> “Find suitable senior frontend jobs for me while I work.”

Edi should be able to create a task, continue that work while the user returns to coding, and notify the user when useful results are available.

Conceptually:

> user request
> → create background task
> → agent/workflow runs independently
> → web/connectors/skills/tools are used
> → results are collected
> → Workspace artifact is created
> → user receives subtle notification
> → result opens in Dynamic Content

Example notification:

> 💼 Found 4 strong matches

Clicking it could open:

- the job listings
- why each matches
- salary/location details where available
- source links
- application status
- suggested next actions

The user should not need to keep the original conversation open for the task to continue.

---



### 30. Task system separate from conversations

Conversations and tasks should be related but not treated as the same thing.

A conversation may create a task, but the task should have its own lifecycle.

Possible task states:

- queued
- running
- waiting
- needs approval
- completed
- failed
- cancelled

A task may produce:

- a Workspace artifact
- a notification
- an approval request
- a follow-up question
- no visible output if nothing relevant was found

This makes Edi capable of doing meaningful work while the user is focused elsewhere.

The task system should later support cancellation, progress, retries, and activity history.

---



### 31. Watches and condition-based tasks

Some background work should be condition-based rather than a one-time task.

Examples:

> “Tell me when that recruiter replies.”

> “Let me know if you find a frontend role that matches these requirements.”

> “Tell me when this build finishes.”

> “Let me know when this package gets a new release.”

These should be modeled as explicit watches or scheduled/conditional tasks, not as continuous unrestricted monitoring.

A watch should clearly define:

- what Edi is checking
- which source/tool it may use
- how often it checks
- what condition counts as relevant
- when it expires
- how the user can stop it

This keeps proactive behavior understandable and controllable.

---



### 32. Schedule and calendar awareness

Edi should help manage the user’s day while they work.

With calendar permission, it should be able to surface upcoming commitments naturally.

For example:

> 🗓 Appointment in 30 min

Or through voice:

> “Your appointment is at 2. Might be a good time to wrap this up.”

Closer to the event:

> “Quick heads-up, you've got 10 minutes before your appointment.”

The timing system should use actual calendar/runtime state instead of having the model remember times itself.

Calendar awareness should eventually support:

- upcoming event reminders
- preparation reminders
- conflicts
- changes/cancellations
- travel/preparation time where appropriate
- relevant contextual information before meetings

---



### 33. Avatar bubble as Edi’s ambient communication channel

The avatar bubble should become the primary lightweight surface for things Edi wants to bring to the user’s attention.

Examples:

> 🗓 Appointment in 30m

> 💼 4 jobs worth checking

> ✓ Research finished

> ✉ Recruiter replied

> ⚠ Build failed

> 💡 I found something relevant

> 🔗 Connect GitHub?

The bubble should remain:

- short
- contextual
- non-blocking
- dismissible
- rate-limited
- clickable for more detail

Clicking a notification should normally open the relevant result in the Dynamic Content area.

Edi should not automatically open large windows or interrupt the user unless urgency or user settings justify it.

---



### 34. Proactivity should come from explicit sources

Edi should be useful even when the user is not actively talking to it.

However, proactive behavior should not mean unrestricted continuous monitoring.

Proactivity should originate from clear sources such as:

- user-created background tasks
- watches
- calendar events
- connected-app events
- task completions
- reminders
- local app/context signals
- configured schedules
- extension/skill events
- system events the user has authorized

Continuous screenshots or unrestricted observation should not be the default mechanism for proactive behavior.

The user should always be able to understand **why Edi surfaced something**.

---



### 35. Proactivity levels

Proactive behavior should be configurable.

Possible behavior settings:

**Quiet**

- only important reminders
- task completion
- direct requested watches

**Balanced**

- reminders
- task results
- useful contextual suggestions
- occasional relevant discoveries

**Expressive**

- more conversational reactions
- broader helpful suggestions
- more frequent companion interactions

Even in expressive mode, Edi should respect cooldowns and interruption rules.

The default should likely be **Balanced** or **Subtle**, not highly proactive.

---



### 36. Voice vs silent interruptions

Not every proactive event should trigger speech.

Most low-priority events should appear silently in the avatar bubble.

Voice should be reserved for things such as:

- important upcoming appointments
- explicitly requested spoken reminders
- urgent failures
- completed tasks the user asked Edi to announce
- situations where voice is enabled and context makes interruption reasonable

This prevents Edi from becoming annoying during focused work.

---



### 37. Companion-style communication

Edi should communicate like a companion rather than a generic system notification.

Instead of:

> Calendar event starts in 30 minutes.

Edi might say:

> “Your appointment is at 2. Might be a good time to wrap this up.”

Instead of:

> Background task completed. 4 items found.

Edi might surface:

> “Found 4 jobs that look worth your time.”

The underlying information should remain accurate and structured, while the presentation can reflect Edi’s personality.

Personality should never alter factual state.

---



### 38. Flagship parallel-work experience

A useful flagship experience for Edi should be:

> The user is coding while Edi is independently doing another useful task.

For example:

> User: “Find suitable frontend jobs for me while I work.”

The user returns to their editor.

Edi works in the background using allowed tools and sources.

Later:

> 💼 Found 4 strong matches

The user clicks the bubble.

Dynamic Content opens the generated job report from Edi Workspace.

This experience demonstrates several core Edi systems working together:

- companion presence
- background tasks
- web/connectors
- skills/tools
- Workspace
- Dynamic Content
- proactive notifications
- personality
- permissions

It should eventually be one of Edi’s key product demos.

---



### Updated Edi product principle

Edi should be useful both **when the user is talking to it and when the user is focused on something else**.

The interaction loop becomes:

> ask
> → delegate
> → keep working
> → Edi works in parallel
> → Edi notices something relevant
> → subtle bubble/voice notification
> → inspect result in Dynamic Content
> → continue, approve, save, or act

The intended feeling is:

> **Present, not intrusive.**
> **Proactive, not creepy.**
> **Helpful while you work, not another thing you have to manage.**


### 39. AI provider and model configuration

Edi should support configurable AI providers, starting with OpenRouter, without forcing users to think like model engineers.

The default UX should prioritize simplicity:

> Settings → AI

At the top:

> **Provider**
> OpenRouter
> API Key: Connected

Then:

> **Model Setup**
> ○ Recommended
> ○ Custom

**Recommended** should be the default.

In Recommended mode, Edi automatically selects appropriate models based on the kind of work being performed.

The user should not need to choose a model for every request.

---

### 40. Role-based model selection

Instead of exposing one global model or dozens of technical model fields, Edi should use a small set of understandable model roles.

Recommended roles:

- **Companion**
- **Deep Work**
- **Background Work**
- **Vision**
- **Utility**

These names describe what the user experiences rather than implementation details.

#### Companion

Used for:

- normal conversation
- quick questions
- voice interactions
- low-latency responses
- lightweight companion behavior

This should prioritize speed and responsiveness.

#### Deep Work

Used for:

- coding
- debugging
- architecture
- difficult reasoning
- planning
- complex analysis

This can use a stronger model where quality matters more than latency.

#### Background Work

Used for:

- research
- job searches
- market research
- longer delegated tasks
- worker/subagent tasks
- multi-step workflows

This is particularly important for the background-task system.

Example:

> “Find suitable frontend jobs while I work.”

The background worker requests the **Background Work** model role instead of requesting a specific model by name.

#### Vision

Used for:

- screenshots
- screen understanding
- images
- visual comparisons
- visual debugging

Only models that support the necessary visual inputs should be selectable here.

#### Utility

Used internally for inexpensive/simple operations such as:

- classification
- intent routing
- extraction
- lightweight summarization
- determining whether screen context is required
- metadata processing
- other small deterministic/model-assisted tasks

This should normally prioritize cost and latency.

---

### 41. Model roles instead of hardcoded models

Edi features and agents should never depend directly on model names where avoidable.

Preferred architecture:

> task
> → determine requirements
> → select model role
> → resolve user configuration
> → choose model/provider
> → execute

For example:

> “When is my next appointment?”
> → Companion

> “Review this architecture.”
> → Deep Work

> “Research these companies while I code.”
> → Background Work

> “What is wrong with what I'm seeing?”
> → Vision

> classify whether a request needs screen capture
> → Utility

This means changing a model in Settings automatically changes all features using that role.

Agents should ask for capabilities/requirements, not model names.

---

### 42. Main Edi vs background workers

The main companion and background workers do not need to use the same model.

For example:

> Companion → fast inexpensive model
> Background Work → stronger reasoning model

This allows the visible Edi companion to remain responsive while more capable models handle expensive work in parallel.

This also fits the future Edi worker/subagent system.

The user should not need to think in terms of:

> Agent 1 uses Claude
> Agent 2 uses Gemini

Instead:

> Background workers use the configured Background Work profile.

---

### 43. Automatic should be the default model option

Every role should support:

> **Automatic — Recommended**

When Automatic is selected, Edi may choose an appropriate compatible model based on:

- task complexity
- latency requirements
- cost preference
- context length
- tool support
- vision requirements
- provider/model availability

Users who want control can select a specific model instead.

Most users should never need to leave Automatic mode.

---

### 44. Global quality/cost preference

Cost should not become another model role.

Instead, expose a global preference:

> **Optimize AI usage for**
>
> Lower Cost
> Balanced
> Best Quality

Recommended default:

> **Balanced**

This preference influences automatic routing.

For example:

**Lower Cost**
- prefer smaller/faster models
- escalate only when necessary

**Balanced**
- choose based on task difficulty and latency

**Best Quality**
- prefer stronger models for substantial tasks

This is much easier for users to understand than token pricing and benchmark scores.

---

### 45. Model compatibility filtering

Edi should prevent users from creating invalid model configurations.

The model selector should understand model capabilities such as:

- vision
- tool calling
- structured output
- reasoning
- context length
- streaming
- provider availability

For example, a text-only model should not be selectable for the Vision role.

If a model is unsuitable, either:

- hide it
- disable it
- clearly explain why it cannot be used

Do not allow a configuration that will silently fail at runtime.

---

### 46. Human-friendly model selector

Avoid exposing raw provider catalogs without structure.

Each model can display a few useful traits, for example:

> Gemini Flash
> Fast · Vision · Tools · $

> Claude Sonnet
> Strong reasoning · Tools · Vision · $$$

> Qwen Flash
> Fast · Low cost · Tools · $

Do not overwhelm users with:

- benchmark tables
- provider routing internals
- token pricing formulas
- dozens of technical parameters

Those can live in an Advanced view if needed.

---

### 47. Fallback behavior

Model failure should not normally terminate an Edi task.

Edi should support fallback behavior within the provider, cost, privacy, and capability policy the user has already
chosen.

Conceptually:

> requested role
> → preferred model
> → unavailable/rate-limited
> → compatible fallback
> → continue task

Most users should not need to configure compatible model fallbacks within one authorized provider.

Default:

> **Fallback: Automatic**

Power users can customize fallback behavior under Advanced settings. Never cross into a provider that lacks a saved
credential or into a paid/cloud path the user has not selected.

Fallback handling should account for required capabilities. For example, a Vision request must fall back to another model capable of vision.

---

### 48. Advanced AI settings

Keep advanced configuration available without exposing it to everyone.

Possible Advanced settings:

- fallback models
- provider routing
- per-task model overrides
- context limits
- provider preferences
- model-specific options
- debugging/model usage information

This creates progressive disclosure:

> simple by default
> powerful when requested

---

### 49. Temporary task-level overrides

Power users should be able to override the model for a specific substantial task.

For example, when starting background research:

> Model: Automatic ▾

The user might temporarily choose a different model.

This should remain optional and should not become part of the normal interaction flow.

Default behavior should always use the configured role automatically.

---

### 50. Recommended AI Settings hierarchy

A clean structure would be:

> **Settings**
> → AI
>
> **Provider**
> - OpenRouter
>
> **Model Setup**
> - Recommended
> - Custom
>
> **Model Roles**
> - Companion
> - Deep Work
> - Background Work
> - Vision
> - Utility
>
> **Usage Preference**
> - Lower Cost
> - Balanced
> - Best Quality
>
> **Advanced**
> - Fallbacks
> - Provider routing
> - Context limits
> - Task overrides

Do not show all of this during onboarding.

Onboarding should only require:

> Connect OpenRouter
> → use Automatic model selection

Users who care about individual models can configure them later.

---

### Updated AI configuration principle

Edi should be **role-based rather than model-centric**.

Users should think:

> “Use a stronger model for deep work.”

not:

> “Which exact model should every subsystem call?”

The architecture should follow:

> **Task requirements → model role → user preference → compatible model → fallback**

This keeps Edi simple for normal users while still giving advanced users meaningful control.

### 51. Compact bubble as an interactive surface

The small avatar bubble is a narrowly scoped ambient and human-input surface, not a second conversation transcript.

It should be a **compact dynamic-content surface** that can support lightweight interaction directly where the user is working.

The bubble may contain:

- reminders
- task progress
- contextual suggestions
- quick actions
- approval requests
- short human-input prompts
- voice state such as listening, thinking, and speaking

Ordinary answers, streamed chat, diagrams, media, reports, and other substantial content stay in Conversation or
Dynamic Content. The bubble may offer **View details** to reveal the full context.

---

### 52. Human-in-the-loop actions inside the bubble

The compact bubble should support approvals and other human-in-the-loop interactions.

Examples:

> **Send this email?**
> Approve · Edit · Deny

> **Create this calendar event?**
> Approve · Change · Cancel

> **Edi needs permission to continue**
> Allow once · Deny

> **Found 6 suitable jobs**
> Review · Save

Consequential actions should remain governed by Edi’s capability and approval policies regardless of where the approval UI is rendered.

The bubble is only the presentation surface. It does not bypass the capability broker.

---

### 53. Compact-to-expanded content model

Requests and notices shown in the bubble should be able to reveal their related item in the main Dynamic Content
area.

The interaction model should be:

> Avatar
> → compact dynamic bubble
> → expand / move / open
> → full Dynamic Content surface

This should feel like the same piece of content expanding rather than navigating to an unrelated page.

For example:

**Compact**

> 💼 4 strong job matches
> 2 remote · 1 especially strong
> View

**Expanded**

The main content area displays:

- full job cards
- match reasoning
- salary/location
- sources
- save/apply actions
- related task state

The same principle applies to compact references for:

- reports
- research
- notes
- approvals
- task results
- connected-app results

The full artifact itself does not need a bubble renderer. This keeps the character lightweight and prevents old
assistant text from replaying when the workspace opens.

---

### 54. Semantic content with compact and expanded representations

Dynamic content should have semantic artifact/content types rather than being implemented as arbitrary HTML.

Each relevant content type may provide a compact summary when there is a real ambient or human-input use case, plus
an expanded renderer for Dynamic Content. A compact representation is not mandatory for every artifact.

For example:

> `JobSearchResult`

may have:

- compact renderer
- expanded renderer

Likewise:

- report
- diagram
- task
- reminder
- approval
- note
- chart
- checklist
- research result

Core principle:

> **Content has a compact representation and an expanded representation.**

The data/state should remain the same while the presentation changes.

---

### 55. Liquid Glass visual direction

Edi’s visual language should take inspiration from the modern iOS/macOS **Liquid Glass** aesthetic.

Desired characteristics:

- translucent layered surfaces
- background blur
- subtle material depth
- soft highlights
- restrained refraction
- rounded geometry
- minimal hard borders
- smooth transitions
- content appearing suspended above the desktop
- native-feeling motion

The goal is not generic SaaS glassmorphism.

The intended direction is:

> **macOS-native + Liquid Glass + warm character presence**

Edi should feel like something living on the desktop rather than a frosted web dashboard.

---

### 56. Material hierarchy

Do not make every interface equally transparent.

Use several material levels based on context.

**Light Glass**

Suitable for:

- avatar bubble
- tiny suggestions
- lightweight reminders
- quick status

**Content Glass**

Suitable for:

- conversations
- dynamic cards
- task results
- approvals
- diagrams
- compact Workspace content

**High-contrast / more solid surfaces**

Suitable for:

- long reports
- code
- dense tables
- settings
- forms
- permission management
- content where readability is more important than transparency

Liquid Glass should be an identity, not a readability constraint.

---

### 57. Shared visual language between bubble and workspace

The bubble and main Dynamic Content surface should use the same design system.

Share:

- typography
- spacing
- radius scale
- materials
- icons
- semantic colors
- motion
- content models
- control styles

This is necessary for the compact-to-expanded transition to feel continuous.

The bubble should feel like a smaller state of the workspace, not a separate UI product.

---

### 58. Keyboard shortcut model

Edi should have one memorable default shortcut for its primary interaction, with customization available for power users.

The settled default is:

> **⌥ Space** — hold for push-to-talk, release to submit

It requires real key-down/key-up handling and must not be implemented as a press-only toggle. Conflicts should be
reported in Settings, but conflict testing does not reopen the default choice.

Users should be able to change it under:

> **Settings → Keyboard Shortcuts**

The primary shortcut wakes Edi if sleeping and starts push-to-talk. A single character click starts hands-free
conversation mode; opening content remains an explicit menu/navigation action.

---

### 59. Configurable keyboard shortcuts

Additional actions can eventually expose configurable shortcuts such as:

- Talk to Edi
- Push to talk
- Show/hide Edi
- Open/close bubble
- Expand current content
- Stop/cancel current Edi action
- Approve current action
- Open Edi workspace

Do not require normal users to learn all of them.

The design principle should be:

> **One shortcut for everyday Edi use, optional shortcuts for power users.**

Keyboard settings should detect or warn about conflicting shortcuts where possible.

---

### 60. Compact bubble design principle

The compact bubble should function as Edi’s **mini ambient and decision surface**, not as a duplicate chat window.

It combines:

- concise notices
- suggestions
- task state
- approvals
- human input
- quick actions
- voice state

while preserving the ability to expand anything substantial into the main Dynamic Content area.

The intended progression is:

> **Edi needs attention → compact bubble → quick interaction if sufficient → reveal full context when more space is needed**

This keeps Edi lightweight during normal desktop work while still giving the user access to a much richer workspace when necessary.

### 61. Scalable repository structure

Edi should evolve toward a **modular monorepo organized by product domains and trust boundaries**, not by generic technical layers.

Current architecture is already strong and should be evolved incrementally rather than rewritten.

The guiding rule:

> A folder becomes a package because it represents a stable domain boundary, not simply because the repository is getting large.

Recommended target direction:

```text
edi/
├── apps/
│   └── desktop/
│       ├── src/
│       │   ├── main/
│       │   ├── preload/
│       │   └── renderer/
│       └── scripts/
│
├── packages/
│   ├── contracts/
│   ├── agent/
│   ├── capabilities/
│   ├── tasks/
│   ├── artifacts/
│   ├── workspace/
│   ├── models/
│   ├── extensions/
│   ├── voice/
│   ├── storage/
│   └── ui/
│
├── docs/
│   └── architecture/
│
├── benchmarks/
├── tooling/
└── package.json
```

Do not create every package immediately. Extract domains only when they have enough responsibility and stable boundaries to justify it.

---

### 62. `packages/contracts`

`contracts` should be the shared language between processes and domains.

It should contain things like:

- IPC request/response contracts
- commands and events
- task states
- capability IDs
- approval schemas
- artifact schemas
- content document types
- settings contracts
- worker protocols
- runtime validation schemas

It should remain plain TypeScript and should not depend on:

- Electron
- React
- providers
- OS APIs

The purpose is to let main, preload, renderer, workers, and domain packages communicate through explicit versioned contracts.

---

### 63. `packages/agent`

The agent package should contain provider-independent agent behavior.

Possible responsibilities:

- agent runtime
- context assembly
- orchestration
- tool selection
- routing
- run budgets
- cancellation
- worker/subagent coordination
- agent errors
- self-awareness context assembly

Electron main should host the agent runtime rather than contain all agent logic directly.

Conceptually:

> `packages/agent` = agent behavior
> `apps/desktop/src/main` = Electron host/adapters

This becomes especially important as Edi gains:

- background workers
- multiple concurrent tasks
- model routing
- watches
- retries
- worker history

---

### 64. `packages/capabilities`

Capabilities should remain the central security and execution boundary for Edi.

This package should eventually contain:

- capability registry
- policy
- permission requirements
- approvals
- execution contracts
- grants
- audit information
- capability discovery

All privileged functionality should pass through the same model:

> agent/tool request
> → capability lookup
> → validate input
> → check grants
> → ask for approval where required
> → execute
> → record result

This includes:

- built-in tools
- Composio
- connectors
- MCP
- skills that invoke tools
- filesystem operations
- computer use later

No extension system should create a parallel permission model.

---

### 65. `packages/tasks`

Edi should have a dedicated task domain for work that continues independently from a conversation.

Responsibilities may include:

- task lifecycle
- queueing
- background execution
- progress
- retries
- cancellation
- waiting states
- approval pauses
- scheduled tasks
- condition watches
- task events

Example states:

- queued
- running
- waiting
- needs approval
- completed
- failed
- cancelled

A conversation may create a task, but the task should not depend on the conversation remaining open.

This powers experiences like:

> “Find suitable jobs while I code.”

---

### 66. `packages/artifacts`

Artifacts should be a dedicated domain separate from their React presentation.

Possible artifact types:

- note
- report
- diagram
- chart
- table
- checklist
- research result
- job search result
- image
- media
- file

The package should own:

- semantic artifact types
- schemas
- IDs
- metadata
- serialization
- lifecycle
- renderer contracts
- persistence references

It should not own React UI.

Renderer features decide how each semantic artifact appears in compact and expanded form.

---

### 67. `packages/workspace`

Edi Workspace should become the local persistent home for user-visible artifacts.

Responsibilities:

- local artifact storage
- notes
- reports
- diagrams
- exports
- workspace search
- workspace item metadata
- safe file boundaries
- import/export coordination

The existing Edi Notes capability becomes one part of this domain.

Workspace should not automatically imply arbitrary filesystem access.

Its storage boundary remains scoped to Edi-owned data.

---

### 68. `packages/models`

Model selection should become a first-class domain instead of being embedded directly in agent code.

Responsibilities:

- provider registry
- model metadata
- capability detection
- model roles
- automatic routing
- fallback resolution
- cost/quality preferences
- availability
- compatibility checks

Model roles currently include:

- Companion
- Deep Work
- Background Work
- Vision
- Utility

Features request a role or capability requirement, not a hardcoded model name.

Preferred flow:

> task requirements
> → model role
> → user preference
> → compatible model
> → fallback

---

### 69. `packages/extensions`

Extensions should own extension lifecycle and ecosystem concerns.

Possible responsibilities:

- manifests
- installation
- validation
- compatibility
- versioning
- dependency handling
- update lifecycle
- rollback
- extension health
- skill metadata
- MCP metadata
- connector contribution metadata
- skin packs
- voice packs

Skills, MCP, connectors, and other extension types may later become separate packages if they grow enough.

Do not split them prematurely.

---

### 70. `packages/voice`

Voice should remain provider-independent.

Responsibilities may include:

- speech provider contracts
- local/cloud adapter interfaces
- voice profiles
- audio queue contracts
- cancellation
- semantic mood mapping
- runtime availability
- custom voice metadata

Provider-specific implementations such as:

- Pocket TTS
- Chatterbox Turbo
- Cartesia
- ElevenLabs

should sit behind the same bounded interface.

Voice identity remains separate from Edi identity/personality.

---

### 71. `packages/storage`

Storage should own durable persistence mechanics.

Responsibilities may include:

- SQLite schema
- migrations
- repositories
- transactions
- recovery
- retention
- database versioning

Other product domains should depend on repository interfaces rather than knowing database details.

Avoid multiple independent persistence systems for the same state.

---

### 72. `packages/ui`

Extract the design system into a package only once it becomes stable enough to justify reuse.

Possible contents:

- design tokens
- Liquid Glass materials
- typography
- spacing
- radius scale
- icons
- motion primitives
- accessibility helpers
- buttons
- inputs
- menus
- segmented controls
- surface primitives

Feature-specific components should **not** go here.

Good:

> `ui/Button`

Bad:

> `ui/JobSearchResult`

Feature UI remains with the feature.

---

### 73. Desktop main-process structure

The Electron main process should gradually become mostly infrastructure and composition.

Recommended direction:

```text
main/
├── bootstrap/
├── ipc/
├── windows/
├── platform/
├── adapters/
│   ├── filesystem/
│   ├── keychain/
│   ├── notifications/
│   ├── capture/
│   └── accessibility/
├── workers/
└── index.ts
```

`main/index.ts` should remain a composition root.

Its job should mainly be:

- create services
- register capabilities
- register IPC
- create windows
- start workers/runtime
- handle application lifecycle

Avoid putting domain behavior directly into `index.ts`.

---

### 74. Preload structure

Preload should stay deliberately small and narrow.

Possible structure:

```text
preload/
├── bridge/
├── validation/
└── index.ts
```

Its responsibilities:

- expose explicitly allowed APIs
- validate data crossing the boundary
- hide raw Electron/IPC APIs
- avoid business logic
- avoid secrets
- avoid privileged operations

Renderer code should never receive unrestricted IPC access.

---

### 75. Renderer structure

Keep the renderer feature-oriented.

Recommended direction:

```text
renderer/
├── app/
├── surfaces/
├── features/
├── presentation/
└── styles/
```

Possible features:

```text
features/
├── conversation/
├── workspace/
├── tasks/
├── content/
├── approvals/
├── appearance/
├── voice/
├── ai-settings/
├── extensions/
├── skills/
├── connections/
├── mcp/
├── permissions/
├── activity/
├── suggestions/
└── computer-use/
```

Each feature should own its own:

- components
- hooks
- state
- adapters
- local helpers
- tests

Do not let global `components/`, `hooks/`, or `utils/` directories become dumping grounds.

---

### 76. Feature-local organization

A feature may use a structure such as:

```text
features/tasks/
├── components/
├── hooks/
├── state/
├── adapters/
├── types/
├── tests/
└── index.ts
```

Only genuinely reusable primitives should move to shared packages.

Prefer:

> `features/tasks/hooks/useTasks`

instead of eventually accumulating:

> `renderer/hooks/useTasks`
> `renderer/hooks/useVoice`
> `renderer/hooks/useMcp`
> `renderer/hooks/useWorkspace`

This makes ownership obvious.

---

### 77. Dependency direction

Dependency direction matters more than exact folder names.

Core domains should remain plain TypeScript wherever possible.

Desired direction:

> renderer features
> → contracts/domain APIs

> Electron adapters
> → domain interfaces

> agent
> → capabilities

> capabilities
> → injected execution ports

Avoid dependencies such as:

- `agent → Electron`
- `tasks → React`
- `workspace → BrowserWindow`
- `skills → ipcRenderer`
- `storage → UI`

This keeps core domains testable and makes future platform support possible without designing for other platforms prematurely.

---

### 78. pnpm workspace and TypeScript boundaries

As packages become real architectural boundaries, use:

- pnpm workspaces
- explicit workspace dependencies
- TypeScript project references where beneficial
- package-level tests
- package-level public exports

This helps:

- editor performance
- build performance
- dependency visibility
- enforcing boundaries
- preventing accidental cross-domain imports

Do not package very small features purely for organizational aesthetics.

---

### 79. Avoid generic architecture buckets

Avoid repository-wide folders/packages such as:

- `utils`
- `helpers`
- `common`
- `shared`
- `core`
- `services`
- `models`

unless their responsibility is extremely specific.

These tend to become dumping grounds as applications grow.

Prefer explicit domain names such as:

- tasks
- artifacts
- capabilities
- workspace
- voice
- agent

A developer should be able to infer ownership from the folder name.

---

### 80. Architecture index cleanup

The current generated anatomy includes large amounts of build/runtime noise.

Architecture indexing should ignore things such as:

- `out/`
- `dist/`
- `release/`
- `*.app/`
- `node_modules/`
- `.venv/`
- coverage
- generated bundles
- Electron runtime assets
- generated native/runtime caches

The architecture index should describe Edi’s source architecture, not everything contained inside a packaged Electron application.

---

### 81. Architecture documentation

Keep human-written architecture docs alongside generated anatomy.

Recommended documents:

```text
docs/architecture/
├── overview.md
├── electron-processes.md
├── agent-runtime.md
├── capabilities-and-approvals.md
├── background-tasks.md
├── artifacts-and-workspace.md
├── models-and-routing.md
├── voice.md
├── extensions.md
└── security-boundaries.md
```

Generated anatomy is useful for navigation.

Human-written architecture documentation should explain:

- why boundaries exist
- ownership
- dependency direction
- trust boundaries
- lifecycle
- architectural decisions

---

### 82. Repository scaling principle

The repository should be organized around **product domains and trust boundaries, not technologies**.

Electron is the shell.

React is presentation.

OpenRouter is a provider.

Composio is a provider/integration mechanism.

MCP is a protocol.

The durable product domains are things like:

- Agent
- Capabilities
- Tasks
- Artifacts
- Workspace
- Models
- Voice
- Character
- Extensions
- Connections

The architecture should make those concepts obvious.

The key goal is:

> Edi should be able to grow substantially in features, tools, workers, integrations, content types, and UI without turning the repository into a collection of giant generic folders or tightly coupled Electron code.


### Multi-surface Edi

Edi should be designed as **a companion, not an Electron app**. The desktop pet is its primary home, but Edi's core should eventually work across other surfaces such as VS Code/Cursor, browser extensions, web, and mobile.

Core domains like **Agent, Tasks, Capabilities, Workspace, Artifacts, Models, Skills, and Identity** should remain independent of Electron. Each host provides its own context and capabilities through adapters.

```text
                 Edi Core
                    │
       ┌────────────┼────────────┐
       │            │            │
    Desktop      VS Code      Browser
```

Edi is currently desktop-first and **not fully structured this way yet**, but the planned package separation provides the foundation. The key architectural rule going forward is:

> **Core Edi domains must not depend on Electron or a specific UI surface.**