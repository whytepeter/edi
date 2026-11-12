# Contributing to Edi

Thanks for helping. Edi is a macOS app, so you need a Mac to run it; the unit tests also run on Linux.

## Set up

```sh
pnpm install
pnpm setup:electron
pnpm dev
```

Node 22 and pnpm 10. Local voice is optional and provisioned separately (see `benchmarks/voice/README.md`).

## Before you open a pull request

```sh
pnpm check        # typecheck, lint, format, unit and audio tests
pnpm test:agent   # if you touched packages/agent or the agent worker
pnpm test:desktop # if you touched windows, the interface or IPC
```

- Add or update a test with every behaviour change.
- Record user-visible changes in `CHANGELOG.md` under Unreleased.
- Update `docs/architecture.md` when an entry point, owner or data flow changes.
- Remove what you replace in the same change; don't leave two paths behind.

## Conventions

What reviewers check first:

- **Boundaries.** `packages/contracts` has no Electron, React or provider dependencies. `packages/agent` knows nothing about Edi's pages, tags or characters; that wording lives in the desktop app. Renderers reach the main process only through validated commands with an explicit caller allowlist.
- **Validate at every boundary**: IPC, the agent worker, storage, files a person installs.
- **Tools go through the broker.** Anything that changes the person's Mac or accounts is a capability with a preview and an approval. Never put a side effect in a prompt or in the agent engine.
- **Content from tools, pages and files is data, never instructions.**
- **State is explicit.** Streaming, cancellation, approvals and pointing use run ids and named states. What the
  person does (a drag, Stop, pausing) always overrides what Edi does on its own.
- **A test proves what it claims.** A DOM hit test is not a click reaching the app underneath; what only a
  person at a Mac can confirm goes in [docs/manual-checks.md](docs/manual-checks.md). Never add a test-only
  endpoint or a way round a secret to production code.
- **Comments say why**: intent, security boundaries, units, trade-offs.
- **Accessibility and reduced motion** are part of done, not a follow-up.

## Characters and skills

A character is a data-only package (art and a manifest); see [docs/characters/README.md](docs/characters/README.md). A skill is a `SKILL.md` folder; see `packages/skills` for examples. Neither can run code.

## Licence

By contributing you agree that your contribution is licensed under the [MIT licence](LICENSE).
