# Cartographer — Streaming Circle Editor

**Date:** 2026-04-23
**Model:** claude-opus-4-7
**Status:** Complete (v1 editor; Phase-1 transcript flow still pending)

## Summary

Turned the Response Map from a static batch-layout viewer into a live,
editable circle-cloud. Blocks stream in from the annotator, arrange into
groups under a soft force simulation, then settle. The user can pan,
zoom, select, resize, and delete blocks on an infinite canvas. Text is
measured with pretext and rendered inside snug circles sized to the
line-broken ink.

## What was done

### New package surface

- **[packages/cartographer/src/streaming-layout.ts](packages/cartographer/src/streaming-layout.ts)** (new)
  — `StreamingLayout` class. Mutable force-directed layout that grows as
  blocks arrive. Owns growable `Float32Array`s (1.5× growth, O(1) swap-
  remove), drives one WASM `force_step` iteration per `step()`, and
  decouples rendered `(rx, ry)` from physics target `(x, y)` via an
  alpha-lerp so motion stays silky even while the sim solves.
  - **Soft-collision physics**: `REPULSION 500`, `DAMPING 0.92`, `DT 0.8`,
    very weak global `CENTERING 0.004`. Circles can touch.
  - **Group forces**: per-member pull toward the group's centroid
    (`GROUP_PULL 0.03`), plus inter-group inverse-square centroid push
    (`INTER_GROUP_REPULSION 60000`) so groups occupy visibly distinct
    regions.
  - **Settle**: per-block velocity snap below `0.1` → zero, full freeze
    once RMS velocity drops below `0.15`. Freeze cleared by any
    add/remove/scale mutation.
  - **Snug circle sizing**: `diameter = hypot(inkW, inkH) + 10px`, where
    `inkH = fontSize * 1.1 + (lineCount - 1) * lineHeight`. The ink
    rectangle is cap-to-baseline for line 1 and lineHeight per extra
    line — skips the ~35% trailing padding that otherwise left circles
    empty at top/bottom.
  - **Scaling**: `scaleBlock(id, factor)` clamps effective scale to
    `[0.4, 4]`, updates width/height, wakes the sim.
  - **Infinite canvas**: `clamp_to_bounds` is no longer called from
    here; the viewport handles bounding visually.
- **[packages/cartographer/src/serialize.ts](packages/cartographer/src/serialize.ts)** (new)
  — `serializeToPrompt(structure, { hiddenIds, positions })`. Re-emits
  groups as `## Label` headers, renders code blocks in fences, caveats
  as blockquote notes, questions as `**Question:**`. Respects hidden
  ids so the user's deletions survive into the output. Sorts groups
  and intra-group members by spatial position when available.
- **Streaming annotator**: [annotator.ts](packages/cartographer/src/annotator.ts)
  now exposes `Annotator.stream(responseText, onEvent, signal)`.
  System prompt emits one JSON object per line (block, group,
  relationship, decision — discriminated by `kind`), parsed
  incrementally so blocks land on the canvas as Claude produces them.
- **Session extensions**: [session.ts](packages/cartographer/src/session.ts)
  adds `streamAnnotate()` (passthrough to annotator.stream),
  `createStreamingLayout()` (awaits `loadWasm()` then constructs a
  `StreamingLayout`), and `layoutStructure()` for re-laying out an
  edited structure without re-calling the API.

### Type + measurer changes

- [types.ts](packages/cartographer/src/types.ts) — added `lineHeight`
  and `lineCount` on `MeasuredBlock` (needed for tight ink height), and
  `diameter?` on `PositionedBlock`.
- [measurer.ts](packages/cartographer/src/measurer.ts) — added
  `measureOne(block, maxWidth)` (variable-width re-flow) and
  `measureSquareish(block)` (re-wraps at `sqrt(area)` when natural
  aspect > 1.4) so circles start circle-shaped.

### Playground: Response Map rewrite

[apps/playground/src/ResponseMap.svelte](apps/playground/src/ResponseMap.svelte)
went from a static grid renderer to the interactive editor. Deltas:

- **Viewport**: CSS transform layer with `panX`/`panY`/`zoom` state.
  Wheel zooms around the cursor (`exp(-deltaY * 0.0015)`), drag-to-pan
  with a 3px threshold so clicks don't register as pans. Reset view
  button recenters on captured world-center.
- **Circle rendering**: each block renders as a `border-radius: 9999px`
  flex-centered div sized to `diameter`, text wrapped in a
  `.cm-block-text` span constrained to the measured width. CSS padding
  is zero — breathing room comes from the diameter math alone.
- **Selection**: click a circle to select, click empty space or Escape
  to deselect. Selection is a visual ring + state key used by keyboard
  handlers.
- **Resize**: `+`/`=` scales selected block by 1.2, `-`/`_` by 1/1.2,
  calling `streamingLayout.scaleBlock`. Neighbors resettle via the
  freeze-wake.
- **Delete**: `Delete` / `Backspace` removes the selected block from
  the layout and marks it hidden for serialization.
- **Streaming ingestion**: "Map response" button now calls
  `session.streamAnnotate()` and pipes events into the layout. New
  circles fade in (FADE_IN_MS 500) at their spawn point, then glide
  toward their settling position.
- **HUD**: zoom percentage + −/+/⟲ controls bottom-right.
- **Energy indicator**: uses `layout.energy()` (render-based motion,
  not velocity) to decide when to stop the animation loop.

## Key decisions

- **Physics/render decouple via lerp**: earlier attempts tried to make
  the WASM solver converge harder. That's the wrong knob — solvers
  have sub-pixel drift near equilibrium. The right fix is to separate
  rendered positions from target positions and let render glide
  independently.
- **Freeze on quiet**: once the whole cloud drops below the RMS
  velocity threshold, zero velocities *and* skip `force_step`. Without
  the skip, the solver keeps emitting tiny target perturbations even
  from a zero-velocity start.
- **Inter-group repulsion at the centroid, not per-block**: applying
  the force uniformly across all members of a group keeps intra-group
  arrangement stable while still separating clusters.
- **Snug fit via tight ink height**: the "text doesn't fit snugly"
  symptom was `totalHeight = lineCount × lineHeight`, which includes
  ~35% lineHeight padding. Computing `fontSize * 1.1 + (lineCount - 1)
  × lineHeight` and moving to an absolute 10px padding margin gave
  visibly tighter circles without clipping descenders.
- **Infinite canvas over clamp**: bounding circles to the viewport
  fought with user scale changes. Viewport pan/zoom is a strictly
  better affordance.
- **`layout.energy()` returns rendered motion, not velocity**: the loop
  terminator cares about "is anything visibly moving?", not "is the
  solver still running?". Rendered-motion lets us stop rAF sooner after
  freeze.

## Key files

| File | Purpose |
|------|---------|
| `packages/cartographer/src/streaming-layout.ts` | **new** — live force sim |
| `packages/cartographer/src/serialize.ts` | **new** — structure → prompt |
| `packages/cartographer/src/annotator.ts` | +`stream()` NDJSON events |
| `packages/cartographer/src/session.ts` | +`streamAnnotate`, `createStreamingLayout`, `layoutStructure` |
| `packages/cartographer/src/measurer.ts` | +`measureOne`, +`measureSquareish` |
| `packages/cartographer/src/types.ts` | +`lineHeight`, +`lineCount`, +`diameter` |
| `packages/cartographer/src/layout-engine.ts` | fallback MeasuredBlock updated |
| `packages/cartographer/src/index.ts` | export new surface |
| `apps/playground/src/ResponseMap.svelte` | circle-cloud editor UI |

## Open items

- **Transcript → Prompt flow (Phase 1)** — [todo/transcript-to-prompt-plan.md](todo/transcript-to-prompt-plan.md).
  Plan written and updated with today's progress; implementation pending
  (new `TranscriptAnnotator`, `serializeTranscriptToPrompt`,
  `TranscriptStudio.svelte`, tab wire-up).
- **Group label interactions** — click label to select all members;
  drag to reorder output; merge by drop.
- **Session persistence** — autosave canvas state (blocks + scales +
  deletions + pan/zoom) to localStorage.
- **Undo/redo** for add/remove/scale.
- **Shared `MetricsProvider` per `(fontSize, lineHeight)` pair** in
  Measurer. Minor perf win; still one provider per block right now.
