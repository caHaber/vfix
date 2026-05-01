# vfir

**Variable Font Interpolation Renderer.** A framework-agnostic core for real-time variable font axis interpolation (Pretext for layout, optional Rust/WASM for math), plus a Svelte 5 adapter and a set of analysis tools for LLM developers (`@prompt-studio/core`, `@vfir/cartographer`, `@vfir/smart-charts` + `@vfir/wasm-stats`).

## Repo layout

```
packages/variable-font-core/    # @variable-font/core   — Interpolator, MetricsProvider, Renderer, easing, WASM bridge
packages/variable-font-svelte/  # @variable-font/svelte — Svelte 5 adapter (runes, actions, components)
packages/wasm/                  # @vfir/wasm            — Rust WASM module (font/layout/cartographer math)
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

## Playground tabs

The playground (`apps/playground`) is the main place to see everything in action. It has five tabs:

### Sliders

The minimal demo. Drag sliders for each Recursive font axis (`wght`, `slnt`, `CASL`, `CRSV`, `MONO`) and watch sample text interpolate in real time. This is the canonical use of `@variable-font/svelte`'s `variableFont` action — set axis targets, the renderer eases toward them with a spring.

### Kinetic

Kinetic typography. A long passage is laid out word-by-word via Pretext, then each word gets its own `Interpolator` so axes can animate independently — words can swell into bold, lean into italics, and settle back, with per-word stiffness and easing. Demonstrates the core `Renderer` + `Interpolator` APIs without any framework binding.

### Prompt Studio

Token-level analysis for LLM prompts, powered by `@prompt-studio/core`.

- **Analyze** — paste a prompt, see token count, character/byte stats, model cost estimates, and token boundary highlighting. Pluggable tokenizers (`cl100k_base`, `o200k_base`) and model pricing for the common GPT/Claude families.
- **Diff** — paste two prompt variants and see a token-level diff: which tokens were added, removed, or kept, and how the cost changes.

### Response Map

A "cartographer" view for streaming LLM responses, powered by `@vfir/cartographer`. Stream a response from the API (or paste one), and the model's output is parsed into content blocks (claims, alternatives, pros/cons, caveats, context) and laid out spatially on a pannable/zoomable canvas instead of as a linear scroll. You can hide blocks, select a subset, and "send to Prompt Studio" to re-tokenize the trimmed prompt — a feedback loop between response shape and prompt shape.

### Smart Charts

WASM-powered chart pipeline with built-in statistical intelligence and optional LLM enhancement, powered by `@vfir/smart-charts` + `@vfir/wasm-stats`. Pick a built-in dataset (e.g. product reviews), and the pipeline runs sentiment + keyword extraction in Rust/WASM, then renders via Layercake. A click-to-debug status pill in the corner indicates whether the real WASM module loaded or the JS stub fell back.

## Architecture principles

- **Pretext for layout** — all text measurement and line-breaking goes through `@chenglou/pretext`, wrapped in core's `MetricsProvider`. Adapters and apps never call Pretext directly.
- **WASM with JS fallback** — core checks `isWasmReady()` at runtime. If WASM is loaded, use it for interpolation math; otherwise fall back to JS. Apps work without WASM.
- **Framework-agnostic core** — `@variable-font/core` has no DOM or framework dependencies. Adapters wrap it for Svelte, etc.
- **Pluggable tokenizers** — `TokenizerRegistry` supports lazy-loaded tokenizers. New tokenizer families are additive.

## Conventions

- pnpm workspaces, ESM only (`"type": "module"` everywhere)
- TypeScript strict, ES2022, bundler `moduleResolution`
- Biome for lint/format (tabs, single quotes, semicolons, 100-col)
- Svelte 5 runes (`$state`, `$effect`, `$props`) — no legacy reactive syntax
- No CSS-in-JS — plain `<style>` blocks in Svelte, CSS files elsewhere

See `AGENTS.md` for the full repo-wide conventions.
