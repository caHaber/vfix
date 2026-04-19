# VFIR Core Scaffold — Monorepo + Core Packages

**Date:** 2026-04-18
**Status:** Complete

## Summary

Scaffolded the full vfir monorepo and implemented Phases 1–6 of the implementation plan.

## What was done

### Phase 1: Monorepo Scaffolding
- Root `package.json` with pnpm workspaces, biome, typescript, vitest
- `pnpm-workspace.yaml` covering `packages/*`, `apps/*`, `examples/*`
- `tsconfig.base.json` (ES2022, bundler moduleResolution, strict)
- `biome.json`, `.gitignore`, `rust-toolchain.toml`, `.nvmrc`

### Phase 2: Core Package (`packages/core`)
- **Types** (`types.ts`): AxisConfig, AxisState, AxisSnapshot, InterpolatorOptions, LayoutWord, LayoutResult
- **Interpolator** (`interpolator.ts`): Spring-based axis interpolation with rAF loop, WASM fast-path (falls back to JS lerp)
- **MetricsProvider** (`metrics.ts`): Wraps `@chenglou/pretext` for text measurement and line-breaking layout
- **Renderer** (`renderer.ts`): Coordinates Interpolator + MetricsProvider
- **Easing** (`easing.ts`): linear, easeInQuad, easeOutQuad, easeInOutQuad, easeOutCubic, easeInOutCubic, easeOutBack, cubicBezier
- **WASM Bridge** (`wasm-bridge.ts`): Lazy WASM loader with `loadWasm()`, `isWasmReady()`, `getWasm()`
- Built with tsup (ESM + DTS)

### Phase 3: WASM Package (`packages/wasm`)
- Rust source (`src/lib.rs`): `compute_layout`, `interpolate_axes` (linear/cubic/spring), `cubic_bezier_interpolate`
- Builds via `wasm-pack` (available in CI, builds locally if wasm-pack installed)

### Phase 4: Vanilla Adapter (`packages/vanilla`)
- `vfir()` function: applies `font-variation-settings` to DOM element via Renderer subscription

### Phase 5: Svelte 5 Adapter (`packages/svelte`)
- `variableFont()` runes wrapper: `.axes`, `.set()`, `.jumpTo()`, `.apply` action, `.renderer`
- `createVariableFont()` action-based API
- `VariableText` component

### Phase 6: Playground (`apps/playground`)
- **Sliders tab**: Axis control sliders + live font preview
- **Kinetic tab**: ~180 concurrent Interpolator instances, mouse proximity bloom, click ripple, Pretext-powered word layout, ResizeObserver responsive re-layout

## Key files

| File | Purpose |
|------|---------|
| `packages/core/src/interpolator.ts` | Central interpolation engine |
| `packages/core/src/metrics.ts` | Pretext-based measurement + layout |
| `packages/core/src/renderer.ts` | Coordinator |
| `packages/wasm/src/lib.rs` | Rust WASM module |
| `packages/svelte/src/variableFont.svelte.ts` | Svelte 5 runes wrapper |
| `apps/playground/src/KineticText.svelte` | Kinetic typography demo |

## Remaining from plan

- Phase 7: Unit tests (Vitest)
- Phase 8: Hero-text example (`examples/hero-text/`)
- Phase 9: CI (GitHub Actions) + Changesets
