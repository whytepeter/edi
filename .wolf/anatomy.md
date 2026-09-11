# anatomy.md

> Auto-maintained by OpenWolf. Last scanned: 2026-09-11T08:05:09.372Z
> Files: 28 tracked | Anatomy hits: 0 | Misses: 0

> Project structure index. Auto-maintained by OpenWolf hooks and daemon.
> Run `openwolf scan` to generate, or wait for the first Claude Code session.
> Status: Pending initial scan

## ./

- `.gitignore` — Git ignore rules (~28 tok)
- `AGENTS.md` — OpenWolf (~75 tok)
- `CLAUDE.md` — OpenWolf (~99 tok)
- `GEMINI.md` — OpenWolf (~75 tok)
- `package.json` — Node.js package manifest (~192 tok)
- `pnpm-workspace.yaml` (~11 tok)
- `README.md` — Project documentation (~547 tok)

## apps/desktop/

- `electron.vite.config.ts` (~150 tok)
- `package.json` — Node.js package manifest (~294 tok)
- `tsconfig.json` — TypeScript configuration (~117 tok)

## apps/desktop/out/main/

- `index.js` — electron: getEnumValues, joinValues, jsonStringifyReplacer + 39 more (~39354 tok)

## apps/desktop/out/preload/

- `index.js` — electron: getEnumValues, joinValues, jsonStringifyReplacer + 39 more (~37973 tok)

## apps/desktop/out/renderer/

- `index.html` — Edi (~158 tok)

## apps/desktop/out/renderer/assets/

- `index-CDKZwNty.css` — Styles: 5 rules, 3 media queries (~2309 tok)
- `index-DF_AL7vG.js` — getDefaultExportFromCjs: requireReactJsxRuntime_production, jsxProd, requireJsxRuntime + 16 more (~226495 tok)

## apps/desktop/src/main/

- `index.ts` — Settings: persist, publish, load, createWindows (~1506 tok)

## apps/desktop/src/preload/

- `index.ts` — Declares DesktopBridge (~217 tok)

## apps/desktop/src/renderer/

- `index.html` — Edi (~131 tok)

## apps/desktop/src/renderer/src/

- `compact.css` — Styles: 3 media queries (~2206 tok)
- `CompactApp.tsx` — Icon — uses useState, useEffect (~2688 tok)
- `main.tsx` (~73 tok)
- `pet.css` — Styles: 5 rules (~104 tok)
- `Pet.tsx` — Pet (~368 tok)

## docs/

- `README.md` — Project documentation (~118 tok)

## packages/contracts/

- `package.json` — Node.js package manifest (~47 tok)

## packages/contracts/src/

- `index.test.ts` (~220 tok)
- `index.ts` — Zod schemas: skinSchema, settingsSchema, commandSchema (~358 tok)

## tests/desktop/

- `smoke.mjs` — profile: launch (~1032 tok)
