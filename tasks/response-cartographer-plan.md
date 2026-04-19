# Response Cartographer — Project Plan

A library that takes an LLM response and renders it as an interactive spatial layout — code blocks prominent, decisions highlighted, alternatives side-by-side, caveats connected to what they qualify — so developers can **scan instead of read**.

---

## 1. Core Idea

LLM responses are walls of text. Engineers have to scroll, hunt for the code, compare alternatives across paragraphs, find the caveat that contradicts the recommendation. That's a spatial task performed on linear content — a fundamental mismatch.

This library fixes it. Paste any LLM response, get back a spatial map:

- The **recommendation** large and central
- **Alternatives** flanking, side-by-side
- **Code blocks** prominent, copyable
- **Caveats** connected via lines to what they qualify
- **Background context** collapsed, expandable on hover

One screen. Five-second scan. Done.

---

## 2. Goals

**v1.0 goals:**

- Parse any LLM response into structured blocks using an LLM annotation pass
- WASM-powered layout engine that positions variable-sized blocks with semantic grouping
- Precise text measurement via Pretext for pixel-perfect positioning
- Multiple layout modes (decision, tutorial, comparison, exploration, code-first)
- Framework adapters for React and Svelte
- **Revision diff** mode: show what changed between two response versions

**Non-goals:**

- Replacing the LLM chat interface (this renders *output*, doesn't generate it)
- Running inference locally (user brings their own provider)
- Being a general "document layout" tool (scope: LLM responses)

---

## 3. Architecture

```
┌──────────────────────────────────────────────────────────────┐
│          @response-cartographer/react | /svelte | /vanilla    │
│                                                               │
│   <ResponseMap text={llmResponse} provider="anthropic" />    │
└──────────────────────┬───────────────────────────────────────┘
                       │
┌──────────────────────▼───────────────────────────────────────┐
│                 @response-cartographer/core                   │
│                                                               │
│   Annotator → ModeDetector → Measurer → LayoutEngine →       │
│   Renderer                                                    │
└─────┬──────────────┬──────────────┬──────────────┬───────────┘
      │              │              │              │
      ▼              ▼              ▼              ▼
 ┌─────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐
 │  LLM    │   │ Mode     │   │ Pretext  │   │ @r-c/    │
 │ (user   │   │ selection│   │          │   │ wasm-    │
 │  brings │   │ (decision│   │ (measures│   │ layout   │
 │  own)   │   │ tutorial │   │ text at  │   │ (Rust)   │
 │         │   │ compare, │   │ assigned │   │          │
 │ parses  │   │ etc.)    │   │ sizes/   │   │ force +  │
 │ into    │   │          │   │ weights) │   │ constraint│
 │ blocks  │   │          │   │          │   │ solver   │
 └─────────┘   └──────────┘   └──────────┘   └──────────┘
```

### Data flow

1. User passes raw LLM response text
2. `Annotator` sends text to an LLM with a structured output prompt, returns `ResponseStructure` (blocks, relationships, decision summary)
3. `ModeDetector` picks the right layout mode based on content (decision, tutorial, etc.)
4. `Measurer` uses Pretext to measure every block at its assigned size/weight
5. `LayoutEngine` (Rust/WASM) runs force-directed + constraint-based positioning
6. `Renderer` outputs DOM with positioned, styled text + interactive overlays

### Why WASM here

The layout problem is genuinely hard:

- N text blocks with variable sizes, semantic relationships, importance scores
- Must fit container, no overlap, spatially group related blocks, smooth transitions on resize
- Force-directed simulation needs hundreds of iterations per frame during animation
- Collision detection is O(n²) without spatial indexing (quadtree)

Pure JS can't hit 60fps on this for moderate-complexity responses (20+ blocks). Rust/WASM makes it feasible.

### Why Pretext

Blocks have wildly different fonts and sizes (code blocks vs. prose vs. callouts). Layout decisions depend on knowing exact rendered dimensions. Pretext gives ground-truth measurements so the WASM engine can position accurately.

---

## 4. Package Structure

```
response-cartographer/
├── packages/
│   ├── core/
│   │   ├── annotator.ts        # LLM → structured blocks
│   │   ├── mode-detector.ts    # Picks layout mode
│   │   ├── measurer.ts         # Pretext wrapper
│   │   ├── session.ts          # Pipeline orchestrator
│   │   └── types.ts
│   ├── wasm-layout/            # Rust layout engine
│   │   ├── src/
│   │   │   ├── lib.rs
│   │   │   ├── force.rs        # Force-directed simulation
│   │   │   ├── constraints.rs  # Fit container, no overlap
│   │   │   ├── quadtree.rs     # Spatial indexing
│   │   │   ├── grid.rs         # Grid/column layouts
│   │   │   └── transition.rs   # Smooth relayout
│   │   └── Cargo.toml
│   ├── react/
│   ├── svelte/
│   └── vanilla/
├── apps/
│   ├── playground/             # Paste a response, see it mapped
│   └── docs/
└── examples/
    ├── decision-view/
    ├── tutorial-view/
    ├── comparison-view/
    └── revision-diff/
```

---

## 5. Key Interfaces

### Annotation output (from LLM)

```typescript
interface ResponseStructure {
  blocks: ContentBlock[];
  relationships: BlockRelationship[];
  decision?: DecisionSummary;
}

interface ContentBlock {
  id: string;
  text: string;
  type: 'recommendation' | 'alternative' | 'code' | 'explanation'
      | 'caveat' | 'pro' | 'con' | 'step' | 'context' | 'question';
  importance: number;            // 0-1
  language?: string;             // for code blocks
  groupId?: string;              // clusters related blocks
}

interface BlockRelationship {
  from: string;
  to: string;
  type: 'qualifies' | 'supports' | 'contradicts' | 'implements' | 'alternative_to';
}

interface DecisionSummary {
  question: string;
  recommendation: string;
  confidence: 'strong' | 'moderate' | 'weak';
  conditions: string[];
}
```

### Layout output (from WASM)

```typescript
interface LayoutResult {
  positions: PositionedBlock[];
  connections: Connection[];     // Visual lines between related blocks
  bounds: { width: number; height: number };
}

interface PositionedBlock {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  fontWeight: number;
  opacity: number;
}
```

### Public API

```typescript
// Core
const cartographer = createCartographer({
  annotator: { provider: 'anthropic', model: '...' },
});
const view = await cartographer.map(responseText, { width: 1200, height: 800 });

// React
<ResponseMap text={llmResponse} provider="anthropic" />
<ResponseMap text={llmResponse} mode="comparison" />
<RevisionDiff before={v1} after={v2} />

// Svelte
<ResponseMap text={llmResponse} provider="anthropic" />
```

---

## 6. Layout Modes

Not every response needs the same layout. The library picks automatically but can be overridden.

- **Decision mode** — for "should I use X or Y" responses. Recommendation center, alternatives flanking, pros/cons as cards
- **Tutorial mode** — for "how do I do X". Steps flow top-to-bottom, code blocks prominent, context collapsible
- **Comparison mode** — for "compare X, Y, Z". Grid/column layout, equal space, differences highlighted
- **Exploration mode** — for open-ended analysis. Force-directed, importance-driven sizing, semantic clustering
- **Code-first mode** — for mostly-code responses. Code block dominates, prose annotations attach to sides

---

## 7. The Killer Feature: Revision Diff

When you ask an LLM to revise its response, the library diffs the two spatial layouts:

- Blocks that stayed the same: stable position
- New blocks: animate in, highlighted
- Removed blocks: fade out
- Changed blocks: show inline diff

Makes "what did the model actually change" instantly visible. Today you have to re-read the whole thing.

```tsx
<RevisionDiff before={firstResponse} after={revisedResponse} />
```

---

## 8. Interactions

- **Click code block**: copies it
- **Hover caveat**: draws line to what it qualifies
- **Click expand**: reveals collapsed context
- **Zoom slider**: progressive disclosure — zoomed out shows only decision + code, zoomed in shows everything
- **Flatten toggle**: switch back to linear text view
- **Search**: highlights semantically matching blocks

---

## 9. Build and Tooling

- **pnpm workspaces + Turborepo**
- **wasm-pack** for the Rust layout engine
- **Pretext** as a core dependency for measurement
- **tsup** for package builds
- **Vite** for playground/docs
- **Vitest** + **Playwright** for tests
- **Changesets** for versioning

---

## 10. Development Phases

**Phase 1 — Foundations (2 weeks)**
- Monorepo + WASM build pipeline
- Core `Session` and annotator with one provider (Anthropic)
- Basic block parsing working end-to-end

**Phase 2 — Layout engine (3 weeks)**
- Rust/WASM force-directed layout
- Quadtree spatial indexing
- Constraint solver (fit container, no overlap)
- Pretext integration for measurement

**Phase 3 — Layout modes (2 weeks)**
- Mode detection logic
- Decision, tutorial, comparison, exploration, code-first implementations
- Grid/column layouts for structured modes

**Phase 4 — Framework adapters (2 weeks)**
- React components (`ResponseMap`, `RevisionDiff`)
- Svelte components
- Interactive playground

**Phase 5 — Revision diff + polish (2 weeks)**
- Layout diffing algorithm
- Smooth transition animations
- Search, zoom, flatten features
- Accessibility pass

**Phase 6 — Launch**
- v1.0 to npm
- Launch post, demo video, example gallery

**Total to v1.0: ~11 weeks**

---

## 11. Why This Is Novel

- No existing library parses LLM responses into spatial layouts
- Chat interfaces (ChatGPT, Claude.ai) render linearly; this is additive, not replacing
- LLM-parsing-LLM-output is a use case that's only viable post-2023
- The WASM force-directed + constraint layout with variable-size text nodes is genuinely new

---

## 12. Risks

- **Annotation quality**: if the LLM parses a response incorrectly, the layout is wrong. Need strong prompts and fallback modes.
- **Latency**: annotation pass adds 1–3s. Consider streaming blocks as they parse, or using a smaller/faster model for annotation.
- **Layout aesthetics**: the spatial output has to look good or the whole thing fails. This is a design project as much as engineering.
- **Scope of "LLM responses"**: responses vary wildly. Need to handle edge cases (very short, very long, mostly code, non-English).

---

## 13. Dogfood Opportunity

Your personal site could ship with this: show your own Claude conversations, spatially mapped. Demonstrates the library and makes a memorable landing page. The library *is* the portfolio piece.
