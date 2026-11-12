# Security

Edi can read your screen, files and connected accounts, and act on them with your approval, so security reports are taken seriously.

## Reporting a problem

Please report privately through GitHub: **Security → Report a vulnerability** on this repository (https://github.com/whytepeter/edi/security/advisories/new). Do not open a public issue for a vulnerability.

Include what you did, what happened, and what you expected. A proof of concept helps.

## What counts

- A way for web content, a file, a connected app, a skill or a character package to make Edi act without the person's approval, or to read or send data it shouldn't.
- A way for a renderer window, an interactive page or a generated view to reach the main process beyond its allowlisted commands.
- Stored credentials exposed to a renderer, a log, a prompt or another process.
- A screenshot or microphone capture taken when the person did not ask for one, or while privacy mode forbids it.

Prompt injection that only changes what Edi says, without an unapproved action or data leaving the Mac, is a quality problem: a normal issue is fine.

## How Edi is built to contain problems

- The model only acts through tools. Tool calls are validated and anything that changes something is shown for approval first.
- Web pages are read by a separate model with no tools, and only links the run has already seen can be fetched.
- Generated HTML runs in a sandbox with no network, storage or bridge. Generated views are plain data drawn by Edi's own components.
- Character packages and skills are data, never code.
- API keys are encrypted with Electron safeStorage and are not returned to the interface.
