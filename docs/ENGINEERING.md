# Engineering conventions

These are implementation requirements, not a claim that the initial scaffold is finished.

## Boundaries

- Contracts: versioned schemas, domain types, geometry, and pure functions. No Electron, React, provider SDK, secrets, or filesystem dependencies.
- Native main: permissions, windows, persistence, credential ownership, and worker supervision. Renderers request narrow operations through validated IPC.
- Agent worker: provider calls and bounded run execution. No direct OS actions; future tools go through the capability broker.
- Presentation: trusted block renderers and a presentation controller. Agent data selects approved block types, never executable components or arbitrary HTML.
- Features: conversation, settings, appearance, and extensions own their UI. Split the current shell into feature modules as those flows ship; do not keep growing one JSX file.

## State and interaction

Use explicit run IDs and state transitions for streaming, cancellation, pending questions, approvals, and presentation. Keep emotion, movement, agent state, and skin assets independent. User drag/Stop/pause override autonomous behavior. Document precedence and interruption rules before adding animation timers.

## Maintainability

Use strict TypeScript and validate data at process, provider, storage, and extension boundaries. Keep functions small and names domain-specific. Format source consistently; avoid compressed one-line components in new work. Comments explain intent, security boundaries, units, coordinate systems, and non-obvious tradeoffs—not a narration of obvious code. Public contracts and significant design decisions need short documentation plus usage examples.

Tests accompany behavior: pure contract/state tests, mocked provider tests, renderer interactions, and packaged smoke checks. Manual platform evidence is recorded separately; a DOM hit test is not an OS click-through test. Never add test-only provider endpoints or secret bypasses to production code.

Before a milestone closes, review structure, duplicated state, failure paths, accessible names/keyboard use, reduced motion, credential handling, and documentation. A successful build alone does not close an acceptance gate.
