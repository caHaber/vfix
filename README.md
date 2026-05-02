# vfir

**Variable Font Interpolation Renderer.** A framework-agnostic core for real-time variable font axis interpolation (Pretext for layout, optional Rust/WASM for math), plus a Svelte 5 adapter and a set of analysis tools for LLM developers (`@prompt-studio/core`, `@vfir/cartographer`, `@vfir/smart-charts` + `@vfir/wasm-stats`).

## Repo layout

```
packages/variable-font-core/    # @variable-font/core   — Interpolator, BatchedInterpolator, MetricsProvider, Renderer, easing, WASM bridge + diagnostics
packages/variable-font-svelte/  # @variable-font/svelte — Svelte 5 adapter (runes, actions, components)
packages/wasm/                  # @vfir/wasm            — Rust WASM module (font/layout/cartographer math + batched spring + radial bloom kernel)
packages/wasm-stats/            # @vfir/wasm-stats      — Rust WASM module (statistical engine + text aggregations)
packages/prompt-studio/         # @prompt-studio/core   — Tokenization, analysis, diff
packages/cartographer/          # @vfir/cartographer    — Streaming LLM response → spatial map / editor
packages/smart-charts/          # @vfir/smart-charts    — WASM stats + LLM enhancement + Layercake renderer
apps/playground/                # Vite + Svelte 5 demo app (the tabs below)
```

## Getting started

```bash
pnpm install
pnpm dev                # run the playground
pnpm build              # build all packages
pnpm build:wasm         # build the Rust/WASM module (requires wasm-pack)
pnpm build:wasm-stats   # build the wasm-stats Rust module
pnpm test               # vitest
pnpm lint               # biome check
pnpm typecheck          # per-package tsc / svelte-check
```

Requires Node ≥ 20 and pnpm 9. Rust + `wasm-pack` are only needed if you want to build the WASM modules locally — both the playground and `@variable-font/core` fall back to JS stubs when WASM isn't built.

## Core API surface

`@variable-font/core` exports:

- **`Interpolator`** — single spring-eased interpolator over a named-axis config. Used by the Sliders tab via the Svelte `variableFont` action.
- **`BatchedInterpolator`** — one spring step over N independent groups × K axes per group, packed into a single `Float32Array`. Per-group stiffness, single RAF, single WASM call per tick. The Kinetic tab drives ~1000 words through one of these.
- **`MetricsProvider`** — wraps `@chenglou/pretext` for measurement and line-breaking. `slnt` is omitted from the canvas font shorthand to keep Pretext's prepared-text cache warm during animation.
- **`Renderer`** — ties an `Interpolator` to a `MetricsProvider` and caches the per-block `LayoutResult`, short-circuiting re-layouts when the canvas font shorthand hasn't changed (so animating CASL/CRSV/MONO/slnt re-uses the previous layout).
- **`loadWasm`, `isWasmReady`, `getWasm`, `getWasmDiagnostics`** — lazy WASM bridge plus a diagnostics snapshot (backend, init duration, init error, export names, wasm-memory bytes, loaded-at) that mirrors `@vfir/smart-charts` so the playground can show a status pill on any tab.

The `@vfir/wasm` Rust module exports kernels that core uses when available: `interpolate_axes`, `interpolate_batch` (per-element stiffness, returns a trailing `any_moving` flag), `compute_radial_targets` (kinetic radial bloom with smoothstep falloff), `cubic_bezier_interpolate`, plus the cartographer primitives (`force_step`, `clamp_to_bounds`, `compute_layout`).

## Playground tabs

The playground (`apps/playground`) is the main place to see everything in action. It has five tabs:

### Kinetic

Kinetic typography over the README itself. Pretext lays the prose out word-by-word; one `BatchedInterpolator` drives `{wght, CASL, slnt, MONO, CRSV}` per word in a single Float32Array. Mouse-move computes the per-word target via `compute_radial_targets` (Rust/WASM) using a smoothstep falloff, click triggers a single RAF-driven wave-front ripple instead of per-word `setTimeout`s. The top sticky bar carries the keyboard-style hints and a click-to-debug WASM status pill that opens a diagnostics modal (backend, init duration, exports, WebAssembly support, UA). Words are placed via plain `left`/`top` (no `transform`, no `will-change`) inside per-line wrappers with `content-visibility: auto`, so the compositor doesn't lift each word into its own GPU layer and off-screen lines skip style/layout/paint entirely.

### Variable Fonts

The minimal demo (formerly "Sliders"). Drag sliders for each Recursive font axis (`wght`, `slnt`, `CASL`, `CRSV`, `MONO`) and watch sample text interpolate in real time. This is the canonical use of `@variable-font/svelte`'s `variableFont` action — set axis targets, the renderer eases toward them with a spring.

### Smart Charts

WASM-powered chart pipeline with built-in statistical intelligence and optional LLM enhancement, powered by `@vfir/smart-charts` + `@vfir/wasm-stats`. Pick a built-in dataset (e.g. product reviews), and the pipeline runs sentiment + keyword extraction in Rust/WASM, then renders via Layercake. A click-to-debug status pill in the corner indicates whether the real WASM module loaded or the JS stub fell back.

### Response Map

A "cartographer" view for streaming LLM responses, powered by `@vfir/cartographer`. Stream a response from the API (or paste one), and the model's output is parsed into content blocks (claims, alternatives, pros/cons, caveats, context) and laid out spatially on a pannable/zoomable canvas instead of as a linear scroll. You can hide blocks, select a subset, and "send to Prompt Studio" to re-tokenize the trimmed prompt — a feedback loop between response shape and prompt shape.

### Prompt Studio

Token-level analysis for LLM prompts, powered by `@prompt-studio/core`.

- **Analyze** — paste a prompt, see token count, character/byte stats, model cost estimates, and token boundary highlighting. Pluggable tokenizers (`cl100k_base`, `o200k_base`) and model pricing for the common GPT/Claude families.
- **Diff** — paste two prompt variants and see a token-level diff: which tokens were added, removed, or kept, and how the cost changes.

## Architecture principles

- **Pretext for layout** — all text measurement and line-breaking goes through `@chenglou/pretext`, wrapped in core's `MetricsProvider`. Adapters and apps never call Pretext directly.
- **WASM with JS fallback** — core checks `isWasmReady()` at runtime. If WASM is loaded, batched math (`interpolate_batch`, `compute_radial_targets`) runs in Rust; otherwise an identical-shape JS fallback runs. Apps work without WASM.
- **Framework-agnostic core** — `@variable-font/core` has no DOM or framework dependencies. Adapters wrap it for Svelte, etc.
- **Pluggable tokenizers** — `TokenizerRegistry` supports lazy-loaded tokenizers. New tokenizer families are additive.
- **Compositor-friendly DOM** — animated text avoids `will-change` and per-element `transform` (which lift each element into its own GPU layer that font-variation-settings can't actually use). Use `left/top` for absolute placement, `contain: paint` to bound paint regions, and per-line `content-visibility: auto` so off-screen lines skip the rendering pipeline.

## Conventions

- pnpm workspaces, ESM only (`"type": "module"` everywhere)
- TypeScript strict, ES2022, bundler `moduleResolution`
- Biome for lint/format (tabs, single quotes, semicolons, 100-col)
- Svelte 5 runes (`$state`, `$effect`, `$props`) — no legacy reactive syntax
- No CSS-in-JS — plain `<style>` blocks in Svelte, CSS files elsewhere

See `AGENTS.md` for the full repo-wide conventions.
