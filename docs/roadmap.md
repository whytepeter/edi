# Roadmap

What Edi does today is in the [README](../README.md) and the [changelog](../CHANGELOG.md). This page is what
comes next, in rough order. Nothing here is a promise or a date.

## Next

- **Pointing that survives a moving screen.** Edi already declines to point when the app or page in front has
  changed. Next: find a target again after it scrolled or moved, and hold up across mixed-scale displays, Spaces
  and full-screen apps. The [manual checks](manual-checks.md) cover these by hand today.
- **Local connectors that update safely.** Staged updates, a review when a server's permissions change,
  rollback, process limits and cleanup on removal for local MCP servers.
- **Lower-end hardware.** Edi is developed on one Apple-silicon Mac. Measure it on an 8 GB machine and decide
  whether Intel Macs are supported.
- **Distribution.** The signed, notarized build exists (see [releasing](releasing.md)); a download page and
  automatic updates do not.

## Later

- **Interactive extensions** (sandboxed MCP Apps), only after scoped messaging between a page and Edi is tested.
- **Acting in other apps.** A separate, high-trust capability, apart from seeing the screen: off by default,
  scoped by app and action, visibly active, with an emergency stop, and every consequential step through the
  existing approvals and activity log.
- **A community path for characters and skills**, once signing, compatibility, rollback and moderation are in
  place. Characters stay data-only.

## Only if the need appears

| Need | What it would take |
| --- | --- |
| Edi pays for model calls or sells subscriptions | A gateway, accounts, quotas and billing |
| A large corpus of skills or references | A retrieval index |
| A marketplace of code Edi cannot trust | Enforced isolation, signing, review and revocation |
| Other operating systems | Platform adapters and their own testing |

## Open decisions

- Whether Edi ever funds model usage itself. Today everyone brings their own OpenRouter key.
- Whether Intel Macs are supported.
