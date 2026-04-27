# vfir

**Variable Font Interpolation Renderer.** A framework-agnostic core for real-time variable font axis interpolation (Pretext for layout, optional Rust/WASM for math), plus a Svelte 5 adapter and a set of analysis tools for LLM developers (`@prompt-studio/core`, `@vfir/cartographer`).

## Repo layout

```
packages/core/          # @vfir/core — Interpolator, MetricsProvider, Renderer, easing, WASM bridge
packages/wasm/          # @vfir/wasm — Rust WASM module (layout + interpolation math)
packages/svelte/        # @vfir/svelte — Svelte 5 adapter (runes, actions)
packages/vanilla/       # @vfir/vanilla — Plain DOM adapter
packages/prompt-studio/ # @prompt-studio/core — Tokenization, analysis, diff
packages/cartographer/  # @vfir/cartographer — Streaming LLM response → spatial map
apps/playground/        # Vite + Svelte 5 demo app (the tabs below)
```

## Getting started

```bash
pnpm install
pnpm dev          # run the playground
pnpm build        # build all packages
pnpm build:wasm   # build the Rust/WASM module (requires wasm-pack)
```

## Playground tabs

The playground (`apps/playground`) is the main place to see everything in action. It has four tabs:

### Sliders

The minimal demo. Drag sliders for each Recursive font axis (`wght`, `slnt`, `CASL`, `CRSV`, `MONO`) and watch sample text interpolate in real time. This is the canonical use of `@vfir/svelte`'s `variableFont` action — set axis targets, the renderer eases toward them with a spring.

### Kinetic

Kinetic typography. A long passage is laid out word-by-word via Pretext, then each word gets its own `Interpolator` so axes can animate independently — words can swell into bold, lean into italics, and settle back, with per-word stiffness and easing. Demonstrates the core `Renderer` + `Interpolator` APIs without any framework binding.

### Prompt Studio

Token-level analysis for LLM prompts, powered by `@prompt-studio/core`.

- **Analyze** — paste a prompt, see token count, character/byte stats, model cost estimates, and token boundary highlighting. Pluggable tokenizers (`cl100k_base`, `o200k_base`) and model pricing for the common GPT/Claude families.
- **Diff** — paste two prompt variants and see a token-level diff: which tokens were added, removed, or kept, and how the cost changes.

### Response Map

A "cartographer" view for streaming LLM responses, powered by `@vfir/cartographer`. Stream a response from the API (or paste one), and the model's output is parsed into content blocks (claims, alternatives, pros/cons, caveats, context) and laid out spatially on a pannable/zoomable canvas instead of as a linear scroll. You can hide blocks, select a subset, and "send to Prompt Studio" to re-tokenize the trimmed prompt — a feedback loop between response shape and prompt shape.

## Conventions

See `AGENTS.md` for repo-wide conventions (pnpm workspaces, ESM-only, Biome, Svelte 5 runes, task logs in `tasks/`).
