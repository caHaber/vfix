# Response Cartographer — Implementation

**Date:** 2026-04-22
**Status:** Complete (v1)

## Summary

Added `@vfir/cartographer` as a new package in the vfir monorepo and wired it into the playground as a "Response Map" tab. Takes an LLM response, annotates it via the Anthropic API (user-provided key), and renders the parsed content blocks as an animated spatial layout.

## What was done

### New package: `@vfir/cartographer` (`packages/cartographer/`)

- **`types.ts`**: `ContentBlock`, `BlockType`, `LayoutMode`, `ResponseStructure`, `MeasuredBlock`, `PositionedBlock`, `LayoutResult`, `MapOptions`
- **`annotator.ts`**: Calls Anthropic Messages API (browser-safe with `anthropic-dangerous-direct-browser-access` header). Tolerant `parseJsonResponse()` strips fences and extracts the first `{...}` block. Default model: `claude-haiku-4-5-20251001`.
- **`mode-detector.ts`**: `detectMode()` — returns `decision` if `decision{}` is populated or any block has `type=recommendation`, otherwise `exploration`.
- **`measurer.ts`**: `Measurer` wraps `@vfir/core`'s `MetricsProvider` (Pretext) to measure each block at its type-appropriate font size and weight. One `MetricsProvider` per block (simple for v1).
- **`layout-engine.ts`**: `LayoutEngine` with two async paths:
  - **Decision mode**: deterministic placement — recommendation centered top, alternatives in a row, pros left / cons right, caveats below, context last. No WASM needed.
  - **Exploration mode**: 120-iteration force-directed simulation using the new `force_step` + `clamp_to_bounds` WASM exports. Falls back to JS stub via Vite alias when WASM isn't built.
- **`session.ts`**: `Session` orchestrates `Annotator → detectMode → Measurer → LayoutEngine`. Caches the last annotation (by input text equality) so re-layout on resize doesn't re-call the API.
- **`index.ts`**: Barrel export.

### Extended `@vfir/wasm` (`packages/wasm/src/lib.rs`)

Added two new Rust exports alongside the existing three:

- **`force_step`**: One iteration of N-body force simulation. AABB repulsion + importance-weighted centering. Returns flat `[x, y, vx, vy, ...]` for N blocks.
- **`clamp_to_bounds`**: Clamps block centers so their AABBs stay inside container bounds. Returns flat `[x, y, ...]`.

### Extended playground stub (`apps/playground/src/wasm-stub.ts`)

Added JS implementations of `force_step` and `clamp_to_bounds` with identical signatures. Dev works without `wasm-pack`.

### Extended WASM type declarations (`packages/core/src/types/wasm.d.ts`)

Added TypeScript signatures for `force_step` and `clamp_to_bounds`.

### New playground tab: `ResponseMap.svelte`

- Toolbar: password input for Anthropic API key (localStorage), mode selector (auto/decision/exploration), "Map response" button with loading states.
- Split layout: 360px textarea on left for pasting LLM response; canvas on right.
- **Interpolator-animated block transitions**: one `Interpolator` (from `@vfir/core`) per block, axes `x`/`y`/`opacity`. Same spring engine that animates font axes now animates spatial positions — new blocks slide in from their initial coords, blocks reposition smoothly on relayout.
- Per-type CSS accents (recommendation = purple border, alternative = blue, pro = green, con = red, caveat = amber left-border, code = monospace dark, context = transparent dim).

### `apps/playground/src/App.svelte`

Added `response-map` tab to the `Tab` union, nav button, and `{:else}` branch.

## Key decisions

- **Annotation caching in Session**: same input text → no API call on resize. Different text → fresh annotation. Keeps resize snappy.
- **Routing through `@vfir/core` wasm bridge**: `layoutExploration` calls `loadWasm()` then `getWasm()` rather than importing `@vfir/wasm` directly. This avoids a DTS resolution failure (the stub/pkg is resolved by Vite at runtime, not by tsup at build time). The `--external @vfir/wasm` flag also added to the tsup build command for good measure.
- **`PositionedBlock` carries `text` and `type`**: avoids a separate lookup map in the component.
- **Single `MetricsProvider` per block in Measurer**: straightforward for v1, could share instances per `(fontSize, lineHeight)` pair in v2.

## Key files

| File | Purpose |
|------|---------|
| `packages/cartographer/src/types.ts` | All shared interfaces |
| `packages/cartographer/src/annotator.ts` | Anthropic API client |
| `packages/cartographer/src/mode-detector.ts` | Mode heuristic |
| `packages/cartographer/src/measurer.ts` | Per-block text measurement |
| `packages/cartographer/src/layout-engine.ts` | Decision + exploration layouts |
| `packages/cartographer/src/session.ts` | Pipeline orchestrator |
| `packages/wasm/src/lib.rs` | +`force_step`, +`clamp_to_bounds` |
| `packages/core/src/types/wasm.d.ts` | +TS types for new WASM exports |
| `apps/playground/src/wasm-stub.ts` | +JS fallbacks for new WASM exports |
| `apps/playground/src/ResponseMap.svelte` | Playground UI component |
| `apps/playground/src/App.svelte` | +`response-map` tab |

## Open items (v2)

- SVG connection lines between related blocks (relationships array is annotated but unused in layout)
- Revision diff mode (`<RevisionDiff before after />`)
- Tutorial / comparison / code-first layout modes
- React and vanilla adapters
- Streaming annotation (render blocks as they parse)
- Shared `MetricsProvider` instances per `(fontSize, lineHeight)` in Measurer
- On-canvas click interactions: copy code block, expand context, flatten to linear view
