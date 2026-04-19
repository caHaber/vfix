# AGENTS.md — Repository Instructions

## Project Overview

**vfir** — Variable Font Interpolation Renderer. A framework-agnostic core library + Svelte 5 adapter for real-time variable font axis interpolation. Includes a prompt analysis tool (Prompt Studio) for LLM developers.

## Monorepo Structure

```
packages/core/          # @vfir/core — Interpolator, MetricsProvider, Renderer, easing, WASM bridge
packages/wasm/          # @vfir/wasm — Rust WASM module (layout, interpolation math)
packages/svelte/        # @vfir/svelte — Svelte 5 adapter (runes, actions, components)
packages/vanilla/       # @vfir/vanilla — Plain DOM adapter
packages/prompt-studio/ # @prompt-studio/core — Tokenization, analysis, diff engine
apps/playground/        # Vite + Svelte playground (Sliders, Kinetic, Prompt Studio tabs)
examples/               # Standalone examples
plans/                  # Implementation plans
tasks/                  # Completed task logs (see Task Tracking below)
```

## Tech Stack

- **Package manager:** pnpm (workspaces)
- **Language:** TypeScript (strict, ES2022, bundler moduleResolution)
- **Build:** tsup (libraries), svelte-package (Svelte adapter), Vite (playground), wasm-pack (Rust)
- **Lint/Format:** Biome
- **Test:** Vitest
- **Key dependencies:** `@chenglou/pretext` (text measurement/layout), `js-tiktoken` (BPE tokenization)

## Common Commands

```bash
pnpm install          # Install all dependencies
pnpm build            # Build all packages
pnpm dev              # Run playground dev server
pnpm test             # Run tests
pnpm lint             # Lint with Biome
pnpm build:wasm       # Build WASM module (requires wasm-pack + Rust)
```

## Architecture Principles

- **Pretext for layout**: All text measurement and line-breaking goes through `@chenglou/pretext`, wrapped in core's `MetricsProvider`. Never call Pretext directly from adapters or apps.
- **WASM with JS fallback**: Core checks `isWasmReady()` at runtime. If WASM is loaded, use it for interpolation math. Otherwise fall back to JS. Apps should work without WASM.
- **Framework-agnostic core**: `@vfir/core` has no DOM or framework dependencies. Adapters wrap it for Svelte, vanilla DOM, etc.
- **Pluggable tokenizers**: `TokenizerRegistry` supports lazy-loaded tokenizers. New tokenizer families are additive.

## Task Tracking

**Always log completed work in the `tasks/` folder.**

- Filename format: `YYYY-MM-DD-short-description.md`
- Include: date, status, summary of what was done, key files changed, remaining/open items
- One task file per logical unit of work (a feature, a phase, a significant change)
- Update existing task files if revisiting prior work

## Code Conventions

- ESM only (`"type": "module"` in all packages)
- Tabs for indentation (Biome config)
- Single quotes, semicolons (Biome config)
- No CSS-in-JS — plain `<style>` blocks in Svelte, CSS files elsewhere
- Svelte 5 runes (`$state`, `$effect`, `$props`) — no legacy reactive syntax
