# VFIR Implementation Progress

## Status: Phases 1–6 complete

---

## Phase 1 — Monorepo Scaffolding ✅

**Files created:**
- `package.json` — root workspace config with pnpm scripts
- `pnpm-workspace.yaml` — workspace package globs
- `tsconfig.base.json` — shared TS config extended by all packages
- `biome.json` — linter/formatter config (tabs, single quotes, 100-col)
- `.gitignore` — ignores node_modules, dist, target, pkg, .svelte-kit
- `.nvmrc` — pins Node 20
- `rust-toolchain.toml` — pins Rust stable + wasm32 target

**Issues resolved:**
- TypeScript 6 deprecates `baseUrl` when using `moduleResolution: bundler` — fixed with `"ignoreDeprecations": "6.0"` in tsconfig.base.json

---

## Phase 2 — Core Package (`@vfir/core`) ✅

**Files created:**
- `packages/core/package.json`
- `packages/core/tsconfig.json`
- `packages/core/src/types.ts` — all shared interfaces: `AxisConfig`, `AxisState`, `AxisSnapshot`, `EasingFn`, `InterpolatorOptions`, `GlyphMetrics`, `MeasureRequest`, etc.
- `packages/core/src/easing.ts` — `linear`, `easeInQuad`, `easeOutQuad`, `easeInOutQuad`, `easeOutCubic`, `easeInOutCubic`, `easeOutBack`, `cubicBezier()`
- `packages/core/src/interpolator.ts` — `Interpolator` class with RAF-based spring loop, subscriber pattern, `set()`, `setAll()`, `jumpTo()`, `getSnapshot()`
- `packages/core/src/metrics.ts` — `MetricsProvider` with LRU cache (500 entries), OffscreenCanvas measurement, per-character advance widths
- `packages/core/src/renderer.ts` — `Renderer` ties Interpolator + MetricsProvider into one object
- `packages/core/src/wasm-bridge.ts` — lazy WASM loader (`loadWasm()`, `isWasmReady()`, `getWasm()`)
- `packages/core/src/index.ts` — barrel export
- `packages/core/src/types/wasm.d.ts` — type stub for `@vfir/wasm` so core builds without wasm-pack output

**Build:** `pnpm --filter @vfir/core run build` ✅

---

## Phase 3 — WASM Package (`@vfir/wasm`) ✅ (source only)

**Files created:**
- `packages/wasm/Cargo.toml` — `cdylib` crate, `wasm-bindgen` dep, release `opt-level = "s"`
- `packages/wasm/src/lib.rs` — implements:
  - `compute_layout(advances, available_width, break_points)` → line-break indices
  - `interpolate_axes(from, to, t, curve_type)` → linear/ease-out-cubic/spring
  - `cubic_bezier_interpolate(x1, y1, x2, y2, t)` → bezier curve evaluation
- `packages/wasm/package.json` — `wasm-pack build` script

**Note:** `wasm-pack` is not installed in this environment. The Rust source is complete and ready to build. Run `cargo install wasm-pack && pnpm build:wasm` to compile. CI will build it via the `wasm` job in `.github/workflows/ci.yml` (Phase 9).

---

## Phase 4 — Vanilla DOM Adapter (`@vfir/vanilla`) ✅

**Files created:**
- `packages/vanilla/package.json`
- `packages/vanilla/tsconfig.json`
- `packages/vanilla/src/index.ts` — `vfir(options)` function: accepts CSS selector or element, subscribes to interpolator, writes `font-variation-settings` on every frame

**Build:** `pnpm --filter @vfir/vanilla run build` ✅

---

## Phase 5 — Svelte 5 Adapter (`@vfir/svelte`) ✅

**Files created:**
- `packages/svelte/package.json`
- `packages/svelte/tsconfig.json`
- `packages/svelte/src/action.ts` — `createVariableFont()` returns a Svelte action + imperative API
- `packages/svelte/src/variableFont.svelte.ts` — `variableFont()` runes-based controller with `$state` reactive axes and a `use:font.apply` action
- `packages/svelte/src/VariableText.svelte` — wrapper component with `tag`, `class`, `onupdate` props; uses `untrack()` to treat options as stable init config
- `packages/svelte/src/index.ts` — barrel export

**Issues resolved:**
- Svelte compile warning about `options` captured outside reactive context in `VariableText.svelte` — fixed with `untrack(() => variableFont(options))`

**Build:** `pnpm --filter @vfir/svelte run build` ✅

---

## Phase 6 — Playground App ✅

**Files created:**
- `apps/playground/package.json` — Vite + Svelte + workspace deps
- `apps/playground/vite.config.ts` — `@sveltejs/vite-plugin-svelte`, externalizes `@vfir/wasm`
- `apps/playground/tsconfig.json`
- `apps/playground/index.html`
- `apps/playground/src/main.ts` — Svelte 5 `mount()`
- `apps/playground/src/App.svelte` — interactive playground with sliders for all 5 Recursive axes (wght, slnt, CASL, CRSV, MONO), two live text samples, animated with `easeOutCubic` + `stiffness: 0.06`

**Issues resolved:**
- `pnpm create vite` is interactive — scaffolded manually instead
- `@vfir/wasm` import analysis failure in Vite dev server — fixed with a `resolve.alias` in `vite.config.ts` that auto-detects whether `packages/wasm/pkg/` is built; falls back to `src/wasm-stub.ts` (no-op stubs) if not

**New file:** `apps/playground/src/wasm-stub.ts` — no-op stubs for all WASM exports, used when wasm-pack hasn't been run

**Build output:** 42.48 KB / **16.11 KB gzipped** — under 50 KB budget ✅

---

## Remaining Phases (not yet executed)

| Phase | Status |
|-------|--------|
| Phase 7: Unit tests (Vitest) | Pending |
| Phase 8: Hero-text example | Pending |
| Phase 9: CI & Changesets | Pending |

---

## Known gaps / next steps

1. **WASM build**: Install wasm-pack (`cargo install wasm-pack`) and run `pnpm build:wasm` to compile the Rust module.
2. **Unit tests**: Write `vitest.config.ts` + test files per plan (Phases 7).
3. **Hero-text example**: Standalone HTML example in `examples/hero-text/` (Phase 8).
4. **CI**: `.github/workflows/ci.yml` (Phase 9).
5. **Changesets**: `pnpm changeset init` for versioning (Phase 9).
6. **`pnpm dev`**: Run `pnpm --filter playground dev` to open the playground in a browser.
