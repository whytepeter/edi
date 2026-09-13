# Product documents

The product plan lives in the parent workspace; architecture and roadmap live here:

- [Product plan](../../EDI-PRODUCT-PLAN.md)
- [Architecture](ARCHITECTURE.md)
- [Roadmap](ROADMAP.md)

Current milestone: **0 — desktop and audio foundations**. The shell, bundled avatars, OpenRouter text, local hold-to-talk pipeline, SQLite history, reviewed note writes, screen context, and presentation overlay are implemented at foundation level. Cloud voice, hands-free conversation, full rich content, and external installations remain upcoming work.

See [foundation validation](FOUNDATION-VALIDATION.md) for evidence and the remaining milestone-0 checks.

See [engineering conventions](ENGINEERING.md) for module boundaries, state ownership, commenting, and verification expectations.

See the [codebase guide](CODEBASE.md) for the current directory map, subsystem entry points, lifecycle, data
flow, and where to make common changes.

See [permission architecture](PERMISSIONS.md) for the just-in-time permission registry and privacy-first screen-context policy.

See [audio runtime](AUDIO-RUNTIME.md) for the isolated playback module, cancellation contract, measured checks, and remaining integration work.
