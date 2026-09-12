# Changelog

Meaningful product and architecture changes are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Edi is not versioned for public release yet.

## Unreleased

### Added

- A compact, request-bound approval bubble with Approve, Deny, and View details actions.
- Just-in-time microphone and Screen Recording permission cards backed by one typed permission registry.
- Local screen-intent policy so ordinary questions do not attach screenshots.
- Note read, edit, and delete capabilities addressed by stable note IDs.
- A dedicated macOS media-permission module that owns native prompts and Electron session policy.
- Strict indexed-access, switch-fallthrough, and override checks across every TypeScript package.
- A developer codebase guide covering process boundaries, subsystem ownership, data flow, and common changes.

### Changed

- A short click starts hands-free conversation; holding Edi or pressing ⌥ Space starts push-to-talk.
- The character bubble now shows listening, thinking, speaking, notices, and approvals instead of chat text.
- Pocket TTS now selects Jane as Edi's default local voice. The host passes the voice explicitly and verifies
  the worker loaded the requested voice before accepting audio.
- Desktop TypeScript configuration now inherits the shared workspace rules.
- OpenRouter image input now uses the AI SDK's current file-part contract.
- Product milestones now stage self-awareness, semantic artifacts, provider/model settings, background work,
  proactivity, computer use, and community extensions without making post-alpha ideas private-alpha gates.

### Fixed

- Prevented the last assistant reply from replaying whenever the content card opens.
- Prevented generic and pasted-content requests from capturing the screen.
- Prevented note reads from following replacement symlinks or loading files larger than 64 KiB.
- Removed the oversized hold-to-talk hint from routine character and shortcut interactions.

### Removed

- Ordinary assistant-response streaming in the side-of-head character bubble.
- The obsolete renderer text-reveal helper and its tests.

### Security

- Approval actions are bound to the current run and tool call and accepted only from approved surfaces.
- Microphone capture is allowed only for the pet renderer while a voice turn is opening or listening.
- The approval preload validates bounded display data and exposes no raw Electron or IPC object.
- Agent workers reject malformed, oversized, or unexpected startup data before it reaches provider code.
