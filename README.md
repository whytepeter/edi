# Edi

A small desktop companion for macOS. Edi sits on your desktop, listens when you hold it, answers out loud, and can look at your screen, point at things, and do things on your Mac after you approve them.

Edi is open source under the [MIT licence](LICENSE). It is early software: expect rough edges.

## What it does

- **Talk to it.** Hold **⌥ Space** anywhere, or hold Edi itself, and speak. Let go when you're done. Speech is recognized on your Mac with whisper.cpp (or Cartesia, if you choose it), and Edi answers aloud.
- **Answers beside the character.** The reply appears in a bubble next to Edi as it is written, with a field to reply and an **Open** button for the full conversation. Approvals appear there too.
- **Sees the screen when you ask.** A screenshot is taken only when your question refers to what is visible. Edi can point at and annotate what it is talking about; it never moves your pointer.
- **Acts with your approval.** Notes, files, reminders, calendar, opening apps and links, your own Shortcuts. Every change is shown to you first, and Edi can undo its own reversible actions.
- **Shows instead of reading out.** Longer answers open as documents, checklists, tables, diagrams, or generated views with figures, charts and buttons you can tap.
- **Works in the background.** Tasks keep running while you do other things; schedules run later or on repeat.
- **Connects to your apps.** Remote and local MCP servers, and Composio-backed connectors.
- **Characters.** Edi and Mochi ship with the app. A character is a data-only package with its own art and manner of speaking; see [making a character](docs/characters/README.md).

## Run it

Requires macOS, Node 22 and pnpm 10. Edi is developed and tested on Apple silicon; other Macs are untested.

```sh
pnpm install
pnpm setup:electron
pnpm dev
```

Only the character appears at launch. Right-click it for **Open Edi**, **Settings**, **Sleep Edi** and **Quit Edi**.

Then open **Settings → AI**, paste an [OpenRouter](https://openrouter.ai) API key and pick a model. Edi has no built-in key and no default paid model.

Local voice (whisper.cpp for hearing, Kokoro and Chatterbox for speaking) is provisioned separately; see [benchmarks/voice/README.md](benchmarks/voice/README.md). Without it Edi still works by typing, and says plainly that voice isn't set up. `EDI_VOICE=off pnpm dev` turns local voice off.

## What leaves your Mac

- Your question, recent turns of the conversation, Edi's instructions and any screenshots that question needed go to OpenRouter and the model you chose.
- Web search runs on OpenRouter and sends the search query there.
- Cloud voices (Cartesia, ElevenLabs) receive the text they speak, only if you choose one and add its key.
- Connected apps receive what a tool call sends them.

History, settings, notes and generated content stay on your Mac: SQLite and JSON in the app's data folder, and files under `~/Documents/Edi`. API keys are encrypted with Electron safeStorage and never returned to the interface. Nothing about you is sent to Fewer Labs.

## Develop

```sh
pnpm check          # typecheck, lint, format, unit and audio tests
pnpm test:agent     # builds, then runs the real agent worker with mocked network
pnpm test:desktop   # launches the app and checks the windows
pnpm voice:report   # where spoken replies spend their wait, from recorded timings
pnpm package        # an unsigned local app under apps/desktop/release
```

| Path | What it is |
| --- | --- |
| `packages/agent` | The brain: one run through a model and its tools, with no window or model service built in |
| `packages/capabilities` | The tool broker and built-in tools; validates, asks for approval, records outcomes |
| `packages/contracts` | Schemas and pure logic shared by every process |
| `packages/storage` | Local SQLite history |
| `packages/characters`, `packages/skills` | Bundled characters and skills |
| `apps/desktop` | The Electron app: windows, voice, permissions, the interface |
| `native` | Small macOS helpers (global hotkey, screen capture) and build scripts |

Start with the [architecture](docs/architecture.md); the rest of the documents are indexed in [docs/README.md](docs/README.md). To use the brain in something else, see `packages/agent/src/index.ts` and its test, which runs it with a scripted model and two plain functions.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). To report a security problem, see [SECURITY.md](SECURITY.md). Third-party components and their licences are listed in [THIRD_PARTY.md](THIRD_PARTY.md).
