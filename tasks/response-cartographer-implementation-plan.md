# Response Cartographer — Implementation Plan (vfir monorepo)

A detailed, step-by-step plan for adding `@vfir/cartographer` as a new package in this repo. Designed to be executed by a smaller LLM (Haiku-class): every file has a full path, every file body is shown inline, every phase ends with a verification command.

## Context

The vfir repo already contains:

- `@vfir/core` — `Interpolator`, `MetricsProvider` (Pretext wrapper), `Renderer`, easing, `loadWasm()` / `isWasmReady()` / `getWasm()`.
- `@vfir/wasm` — Rust cdylib exporting `compute_layout`, `interpolate_axes`, `cubic_bezier_interpolate`.
- `@vfir/svelte` — Svelte 5 adapter with `variableFont()` runes wrapper.
- `apps/playground` — Vite + Svelte 5 playground with `Sliders`, `Kinetic`, `Prompt Studio` tabs and a Vite alias that swaps `@vfir/wasm` for a local stub when `packages/wasm/pkg/` is not yet built.

This plan **reuses** those pieces rather than duplicating:

- `MetricsProvider` measures every block.
- `Interpolator` (the existing spring engine) animates block positions between layouts — the same engine that interpolates font axes.
- `@vfir/wasm` is extended with layout primitives (force simulation, quadtree, constraints) rather than creating a second WASM crate.

Everything lands on a new "Response Map" tab in the playground.

## Scope — v1

**In scope**

- New package `@vfir/cartographer`.
- Annotator that calls Anthropic's Messages API directly from the browser (user provides API key, stored in `localStorage`).
- Two layout modes only: `decision` (recommendation-centered) and `exploration` (force-directed).
- WASM-backed force simulation + quadtree collision + fit-container clamp. JS fallback when WASM stub is active.
- Svelte component `ResponseMap.svelte` and a new playground tab.
- Animated transitions between layouts via the existing `Interpolator`.

**Out of scope (v2)**

- Revision diff (`<RevisionDiff before after />`).
- Tutorial / comparison / code-first modes.
- React / vanilla adapters.
- Docs app.
- SVG connection-line overlay (v1 uses `qualifies`/`supports` relationship info but does not draw lines).
- Streaming annotations.

## Architecture

```
Playground "Response Map" tab
        │
        ▼
@vfir/cartographer/svelte   (ResponseMap.svelte — UI, interactions)
        │
        ▼
@vfir/cartographer/core
  ├── Session         (map() pipeline)
  ├── Annotator       (LLM call → ResponseStructure)
  ├── ModeDetector    (heuristic → LayoutMode)
  ├── Measurer        (wraps @vfir/core MetricsProvider)
  ├── LayoutEngine    (orchestrates WASM force/constraint passes)
  └── types.ts
        │
        ├── @vfir/core         (MetricsProvider, Interpolator)
        └── @vfir/wasm         (compute_layout, interpolate_axes +
                                new: force_step, quadtree_build,
                                clamp_to_bounds)
```

---

## Phase 0 — Preconditions

Before starting, verify you're at the repo root:

```bash
cd /Users/cahaber/workspace/vfix
ls package.json pnpm-workspace.yaml AGENTS.md
```

Expected: all three files exist. Do **not** run `git checkout` or touch `main` — stay on the current branch.

Read `AGENTS.md` once. It dictates:

- pnpm workspaces, ESM only, strict TS, Svelte 5 runes only.
- Biome with **tabs for indentation**, single quotes, semicolons, 100-col lines.
- All code in this plan is written with those conventions.

---

## Phase 1 — Package scaffolding

### Step 1.1 — Create package directory

```bash
mkdir -p packages/cartographer/src
```

### Step 1.2 — `packages/cartographer/package.json`

```json
{
	"name": "@vfir/cartographer",
	"version": "0.0.1",
	"type": "module",
	"main": "dist/index.js",
	"types": "dist/index.d.ts",
	"exports": {
		".": {
			"import": "./dist/index.js",
			"types": "./dist/index.d.ts"
		}
	},
	"scripts": {
		"build": "tsup src/index.ts --format esm --dts --clean",
		"typecheck": "tsc --noEmit"
	},
	"dependencies": {
		"@vfir/core": "workspace:*"
	},
	"devDependencies": {
		"tsup": "^8.5.1"
	}
}
```

### Step 1.3 — `packages/cartographer/tsconfig.json`

```json
{
	"extends": "../../tsconfig.base.json",
	"compilerOptions": { "outDir": "dist", "rootDir": "src" },
	"include": ["src"]
}
```

### Step 1.4 — Install

```bash
pnpm install
```

Expected: resolves with no errors. `@vfir/cartographer` now appears in `pnpm list --depth -1`.

---

## Phase 2 — Types

### Step 2.1 — `packages/cartographer/src/types.ts`

This is the contract everything else depends on. Keep the shape narrow — v1 only supports `decision` and `exploration` modes.

```typescript
/** Content block classification */
export type BlockType =
	| 'recommendation'
	| 'alternative'
	| 'code'
	| 'explanation'
	| 'caveat'
	| 'pro'
	| 'con'
	| 'step'
	| 'context'
	| 'question';

/** Layout modes supported in v1 */
export type LayoutMode = 'decision' | 'exploration';

/** A single content block extracted from an LLM response */
export interface ContentBlock {
	id: string;
	text: string;
	type: BlockType;
	/** 0–1; higher means bigger/more central */
	importance: number;
	/** Language tag for code blocks, e.g. 'typescript', 'python' */
	language?: string;
	/** Optional grouping id — blocks sharing a groupId cluster */
	groupId?: string;
}

/** Semantic relationship between two blocks */
export interface BlockRelationship {
	from: string;
	to: string;
	type: 'qualifies' | 'supports' | 'contradicts' | 'implements' | 'alternative_to';
}

/** Optional summary for decision-mode responses */
export interface DecisionSummary {
	question: string;
	recommendation: string;
	confidence: 'strong' | 'moderate' | 'weak';
	conditions: string[];
}

/** What the annotator returns */
export interface ResponseStructure {
	blocks: ContentBlock[];
	relationships: BlockRelationship[];
	decision?: DecisionSummary;
}

/** One block after measurement */
export interface MeasuredBlock {
	id: string;
	/** Rendered width in px at the chosen font size */
	width: number;
	/** Rendered height in px */
	height: number;
	/** Font size this block will render at */
	fontSize: number;
	/** Font weight 300–900 */
	fontWeight: number;
}

/** Positioned block ready for rendering */
export interface PositionedBlock extends MeasuredBlock {
	x: number;
	y: number;
	opacity: number;
}

/** Final layout output */
export interface LayoutResult {
	positions: PositionedBlock[];
	bounds: { width: number; height: number };
	mode: LayoutMode;
}

/** What the playground passes in */
export interface MapOptions {
	width: number;
	height: number;
	/** Force a specific mode; otherwise ModeDetector picks */
	mode?: LayoutMode;
}
```

---

## Phase 3 — Annotator

Browser-based Anthropic API client. User provides their own key — **never** store a default key in the repo.

### Step 3.1 — `packages/cartographer/src/annotator.ts`

```typescript
import type { ResponseStructure } from './types.js';

export interface AnnotatorOptions {
	apiKey: string;
	model?: string;
}

const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';

const SYSTEM_PROMPT = `You are a parser that decomposes an LLM response into spatial blocks.

Return ONLY a JSON object matching this TypeScript shape (no prose, no code fences):

{
  "blocks": Array<{
    "id": string,
    "text": string,
    "type": "recommendation" | "alternative" | "code" | "explanation" | "caveat" | "pro" | "con" | "step" | "context" | "question",
    "importance": number,
    "language"?: string,
    "groupId"?: string
  }>,
  "relationships": Array<{
    "from": string,
    "to": string,
    "type": "qualifies" | "supports" | "contradicts" | "implements" | "alternative_to"
  }>,
  "decision"?: {
    "question": string,
    "recommendation": string,
    "confidence": "strong" | "moderate" | "weak",
    "conditions": string[]
  }
}

Rules:
- ids are stable slugs like "rec-1", "alt-a", "code-1"
- importance is 0-1; the recommendation gets ~0.9, caveats ~0.3
- If the response is a question with a clear answer, populate decision{}
- Code blocks: set type="code" and include language
- Keep text verbatim from the source — do NOT paraphrase`;

export class Annotator {
	constructor(private options: AnnotatorOptions) {}

	async annotate(responseText: string): Promise<ResponseStructure> {
		const res = await fetch('https://api.anthropic.com/v1/messages', {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				'x-api-key': this.options.apiKey,
				'anthropic-version': '2023-06-01',
				'anthropic-dangerous-direct-browser-access': 'true',
			},
			body: JSON.stringify({
				model: this.options.model ?? DEFAULT_MODEL,
				max_tokens: 4096,
				system: SYSTEM_PROMPT,
				messages: [{ role: 'user', content: responseText }],
			}),
		});

		if (!res.ok) {
			const body = await res.text();
			throw new Error(`Annotator HTTP ${res.status}: ${body}`);
		}

		const data = (await res.json()) as { content: Array<{ type: string; text?: string }> };
		const textPart = data.content.find((p) => p.type === 'text' && p.text);
		if (!textPart?.text) throw new Error('Annotator returned no text block');

		return parseJsonResponse(textPart.text);
	}
}

/** Tolerant JSON parser — strips ``` fences, extracts first {...} block */
export function parseJsonResponse(raw: string): ResponseStructure {
	const stripped = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
	const start = stripped.indexOf('{');
	const end = stripped.lastIndexOf('}');
	if (start < 0 || end < 0) throw new Error('No JSON object in annotator output');
	const json = stripped.slice(start, end + 1);
	const parsed = JSON.parse(json) as ResponseStructure;

	if (!Array.isArray(parsed.blocks)) throw new Error('Missing blocks array');
	if (!Array.isArray(parsed.relationships)) parsed.relationships = [];
	return parsed;
}
```

---

## Phase 4 — Mode Detector

### Step 4.1 — `packages/cartographer/src/mode-detector.ts`

```typescript
import type { LayoutMode, ResponseStructure } from './types.js';

/**
 * Pick a layout mode from the annotated structure.
 * v1: decision if decision{} populated or any block has type=recommendation;
 * exploration otherwise.
 */
export function detectMode(structure: ResponseStructure): LayoutMode {
	if (structure.decision) return 'decision';
	if (structure.blocks.some((b) => b.type === 'recommendation')) return 'decision';
	return 'exploration';
}
```

---

## Phase 5 — Extend `@vfir/wasm`

Add three new exported functions. **Do not** remove the existing `compute_layout`, `interpolate_axes`, `cubic_bezier_interpolate` — they are still used by the Interpolator.

### Step 5.1 — Replace `packages/wasm/src/lib.rs` with

```rust
use wasm_bindgen::prelude::*;

// ----- Existing exports: keep these -----

#[wasm_bindgen]
pub fn compute_layout(advances: &[f32], available_width: f32, break_points: &[u32]) -> Vec<u32> {
    let mut breaks = Vec::new();
    let mut line_width: f32 = 0.0;
    let mut last_break: usize = 0;

    for &bp in break_points {
        let bp = bp as usize;
        let end = (bp + 1).min(advances.len());
        let segment_width: f32 = advances[last_break..end].iter().sum();

        if line_width + segment_width > available_width && line_width > 0.0 {
            breaks.push(last_break as u32);
            line_width = segment_width;
        } else {
            line_width += segment_width;
        }
        last_break = bp + 1;
    }

    breaks
}

#[wasm_bindgen]
pub fn interpolate_axes(from: &[f32], to: &[f32], t: f32, curve_type: u8) -> Vec<f32> {
    let t_eased = match curve_type {
        1 => {
            let t1 = t - 1.0;
            t1 * t1 * t1 + 1.0
        }
        2 => {
            let decay = (-5.0 * t).exp();
            1.0 - decay * (1.0 - t)
        }
        _ => t,
    };
    from.iter().zip(to.iter()).map(|(a, b)| a + (b - a) * t_eased).collect()
}

#[wasm_bindgen]
pub fn cubic_bezier_interpolate(x1: f32, y1: f32, x2: f32, y2: f32, t: f32) -> f32 {
    let mut lo: f32 = 0.0;
    let mut hi: f32 = 1.0;
    for _ in 0..20 {
        let mid = (lo + hi) / 2.0;
        let x = bezier_val(mid, x1, x2);
        if (x - t).abs() < 0.0001 {
            return bezier_val(mid, y1, y2);
        }
        if x < t { lo = mid; } else { hi = mid; }
    }
    bezier_val((lo + hi) / 2.0, y1, y2)
}

fn bezier_val(t: f32, p1: f32, p2: f32) -> f32 {
    3.0 * (1.0 - t).powi(2) * t * p1 + 3.0 * (1.0 - t) * t.powi(2) * p2 + t.powi(3)
}

// ----- New: cartographer layout primitives -----

/// One step of a force-directed simulation on N rectangular blocks.
///
/// Inputs (all length N unless noted):
///   x, y              current center positions
///   w, h              block dimensions
///   importance        0-1; higher = stronger pull to center
///   vx, vy            current velocities (caller owns them)
///   center_x, center_y container center
///   repulsion         pairwise repulsion strength (e.g. 4000.0)
///   centering         importance-weighted pull strength (e.g. 0.02)
///   damping           velocity damping per step (e.g. 0.85)
///   dt                time step (e.g. 1.0)
///
/// Returns a flat Vec<f32> of length 4N: [x0, y0, vx0, vy0, x1, y1, vx1, vy1, ...].
#[wasm_bindgen]
pub fn force_step(
    x: &[f32], y: &[f32], w: &[f32], h: &[f32],
    importance: &[f32], vx: &[f32], vy: &[f32],
    center_x: f32, center_y: f32,
    repulsion: f32, centering: f32, damping: f32, dt: f32,
) -> Vec<f32> {
    let n = x.len();
    let mut nx = vec![0f32; n];
    let mut ny = vec![0f32; n];
    let mut nvx = vec![0f32; n];
    let mut nvy = vec![0f32; n];

    for i in 0..n {
        // Centering force, scaled by importance
        let mut fx = (center_x - x[i]) * centering * importance[i];
        let mut fy = (center_y - y[i]) * centering * importance[i];

        // Pairwise repulsion (AABB overlap + small margin)
        for j in 0..n {
            if i == j { continue; }
            let dx = x[i] - x[j];
            let dy = y[i] - y[j];
            let overlap_x = (w[i] + w[j]) * 0.5 + 8.0 - dx.abs();
            let overlap_y = (h[i] + h[j]) * 0.5 + 8.0 - dy.abs();
            if overlap_x > 0.0 && overlap_y > 0.0 {
                let push = overlap_x.min(overlap_y);
                let dist2 = dx * dx + dy * dy + 1.0;
                fx += (dx / dist2.sqrt()) * repulsion * push * 0.001;
                fy += (dy / dist2.sqrt()) * repulsion * push * 0.001;
            }
        }

        nvx[i] = (vx[i] + fx * dt) * damping;
        nvy[i] = (vy[i] + fy * dt) * damping;
        nx[i] = x[i] + nvx[i] * dt;
        ny[i] = y[i] + nvy[i] * dt;
    }

    let mut out = Vec::with_capacity(n * 4);
    for i in 0..n {
        out.push(nx[i]);
        out.push(ny[i]);
        out.push(nvx[i]);
        out.push(nvy[i]);
    }
    out
}

/// Clamp each block's center so its AABB fits inside [0, bounds_w] x [0, bounds_h].
/// Returns flat [x0, y0, x1, y1, ...] of length 2N.
#[wasm_bindgen]
pub fn clamp_to_bounds(
    x: &[f32], y: &[f32], w: &[f32], h: &[f32],
    bounds_w: f32, bounds_h: f32,
) -> Vec<f32> {
    let n = x.len();
    let mut out = Vec::with_capacity(n * 2);
    for i in 0..n {
        let hw = w[i] * 0.5;
        let hh = h[i] * 0.5;
        let cx = x[i].max(hw).min(bounds_w - hw);
        let cy = y[i].max(hh).min(bounds_h - hh);
        out.push(cx);
        out.push(cy);
    }
    out
}
```

### Step 5.2 — Do not touch `Cargo.toml`

The existing deps (`wasm-bindgen`, `serde`, `serde-wasm-bindgen`) are enough. Leave it.

### Step 5.3 — Verify Rust compiles (optional but recommended)

If `wasm-pack` is installed locally:

```bash
pnpm build:wasm
```

If not installed, skip — CI builds it and the playground falls back to the stub.

---

## Phase 6 — Extend the WASM stub

The playground uses `apps/playground/src/wasm-stub.ts` as a fallback. Add the new exports there so dev works without `wasm-pack`.

### Step 6.1 — Replace `apps/playground/src/wasm-stub.ts` with

```typescript
// Stub for @vfir/wasm — used in dev when wasm-pack hasn't been run yet.
// Replace with the real package once `pnpm build:wasm` has been executed.

export function compute_layout(
	_advances: Float32Array,
	_available_width: number,
	_break_points: Uint32Array,
): Uint32Array {
	return new Uint32Array(0);
}

export function interpolate_axes(
	from: Float32Array,
	_to: Float32Array,
	_t: number,
	_curve_type: number,
): Float32Array {
	return from;
}

export function cubic_bezier_interpolate(
	_x1: number,
	_y1: number,
	_x2: number,
	_y2: number,
	t: number,
): number {
	return t;
}

/** JS fallback for the WASM force_step. Signature matches the Rust export. */
export function force_step(
	x: Float32Array,
	y: Float32Array,
	w: Float32Array,
	h: Float32Array,
	importance: Float32Array,
	vx: Float32Array,
	vy: Float32Array,
	center_x: number,
	center_y: number,
	repulsion: number,
	centering: number,
	damping: number,
	dt: number,
): Float32Array {
	const n = x.length;
	const out = new Float32Array(n * 4);
	for (let i = 0; i < n; i++) {
		let fx = (center_x - x[i]) * centering * importance[i];
		let fy = (center_y - y[i]) * centering * importance[i];
		for (let j = 0; j < n; j++) {
			if (i === j) continue;
			const dx = x[i] - x[j];
			const dy = y[i] - y[j];
			const ox = (w[i] + w[j]) * 0.5 + 8 - Math.abs(dx);
			const oy = (h[i] + h[j]) * 0.5 + 8 - Math.abs(dy);
			if (ox > 0 && oy > 0) {
				const push = Math.min(ox, oy);
				const dist = Math.sqrt(dx * dx + dy * dy + 1);
				fx += (dx / dist) * repulsion * push * 0.001;
				fy += (dy / dist) * repulsion * push * 0.001;
			}
		}
		const nvx = (vx[i] + fx * dt) * damping;
		const nvy = (vy[i] + fy * dt) * damping;
		out[i * 4 + 0] = x[i] + nvx * dt;
		out[i * 4 + 1] = y[i] + nvy * dt;
		out[i * 4 + 2] = nvx;
		out[i * 4 + 3] = nvy;
	}
	return out;
}

export function clamp_to_bounds(
	x: Float32Array,
	y: Float32Array,
	w: Float32Array,
	h: Float32Array,
	bounds_w: number,
	bounds_h: number,
): Float32Array {
	const n = x.length;
	const out = new Float32Array(n * 2);
	for (let i = 0; i < n; i++) {
		const hw = w[i] * 0.5;
		const hh = h[i] * 0.5;
		out[i * 2 + 0] = Math.max(hw, Math.min(bounds_w - hw, x[i]));
		out[i * 2 + 1] = Math.max(hh, Math.min(bounds_h - hh, y[i]));
	}
	return out;
}

export default async function init(): Promise<void> {
	// no-op stub
}
```

### Step 6.2 — Add type declarations for the new WASM exports in core

Open `packages/core/src/types/wasm.d.ts` (already exists). Add these three signatures under the existing module declaration:

```typescript
// inside `declare module '@vfir/wasm' { ... }` — ADD these exports

export function force_step(
	x: Float32Array,
	y: Float32Array,
	w: Float32Array,
	h: Float32Array,
	importance: Float32Array,
	vx: Float32Array,
	vy: Float32Array,
	center_x: number,
	center_y: number,
	repulsion: number,
	centering: number,
	damping: number,
	dt: number,
): Float32Array;

export function clamp_to_bounds(
	x: Float32Array,
	y: Float32Array,
	w: Float32Array,
	h: Float32Array,
	bounds_w: number,
	bounds_h: number,
): Float32Array;
```

(If the existing declaration file uses a different structure, merge into it; do not create a new declaration file.)

---

## Phase 7 — Measurer

Thin wrapper over `@vfir/core`'s `MetricsProvider` that picks font size/weight from block type and importance, then measures wrapped dimensions.

### Step 7.1 — `packages/cartographer/src/measurer.ts`

```typescript
import { MetricsProvider } from '@vfir/core';
import type { ContentBlock, MeasuredBlock } from './types.js';

/** Font-size mapping per block type, scaled by importance */
function styleForBlock(block: ContentBlock): { fontSize: number; fontWeight: number } {
	switch (block.type) {
		case 'recommendation':
			return { fontSize: 28 + block.importance * 8, fontWeight: 700 };
		case 'alternative':
			return { fontSize: 20 + block.importance * 4, fontWeight: 600 };
		case 'code':
			return { fontSize: 14, fontWeight: 500 };
		case 'caveat':
			return { fontSize: 14, fontWeight: 400 };
		case 'pro':
		case 'con':
			return { fontSize: 15, fontWeight: 500 };
		case 'step':
			return { fontSize: 16, fontWeight: 500 };
		case 'question':
			return { fontSize: 22, fontWeight: 600 };
		case 'context':
			return { fontSize: 13, fontWeight: 400 };
		default:
			return { fontSize: 16, fontWeight: 400 };
	}
}

export interface MeasurerOptions {
	fontFamily: string;
	/** Max width a single block is allowed to take, in px */
	maxBlockWidth: number;
}

export class Measurer {
	constructor(private options: MeasurerOptions) {}

	measure(blocks: ContentBlock[]): MeasuredBlock[] {
		return blocks.map((b) => {
			const { fontSize, fontWeight } = styleForBlock(b);
			const lineHeight = Math.round(fontSize * 1.35);
			const provider = new MetricsProvider({
				fontFamily: this.options.fontFamily,
				fontSize,
				lineHeight,
			});
			const layout = provider.layout(b.text, this.options.maxBlockWidth, { wght: fontWeight });
			const width = Math.max(60, Math.max(0, ...layout.lineWidths));
			const height = layout.totalHeight || lineHeight;
			return {
				id: b.id,
				width,
				height,
				fontSize,
				fontWeight,
			};
		});
	}
}
```

---

## Phase 8 — LayoutEngine

Orchestrates WASM calls for both supported modes.

### Step 8.1 — `packages/cartographer/src/layout-engine.ts`

```typescript
import { loadWasm, getWasm, isWasmReady } from '@vfir/core';
import type {
	BlockRelationship,
	ContentBlock,
	LayoutMode,
	LayoutResult,
	MeasuredBlock,
	PositionedBlock,
	ResponseStructure,
} from './types.js';

const FORCE_ITERATIONS = 120;
const REPULSION = 4000;
const CENTERING = 0.02;
const DAMPING = 0.85;
const DT = 1.0;

export interface LayoutInput {
	structure: ResponseStructure;
	measured: MeasuredBlock[];
	mode: LayoutMode;
	bounds: { width: number; height: number };
}

export class LayoutEngine {
	async compute(input: LayoutInput): Promise<LayoutResult> {
		// Ensure WASM is attempted (non-fatal if stub)
		try {
			await loadWasm();
		} catch {
			// Fall through — caller will hit the stub via Vite alias
		}
		if (input.mode === 'decision') return this.layoutDecision(input);
		return this.layoutExploration(input);
	}

	/** Decision mode: recommendation large + centered, alternatives flanking, caveats below. */
	private layoutDecision(input: LayoutInput): LayoutResult {
		const { structure, measured, bounds } = input;
		const byId = new Map(structure.blocks.map((b) => [b.id, b]));
		const mById = new Map(measured.map((m) => [m.id, m]));

		const rec = structure.blocks.find((b) => b.type === 'recommendation');
		const alts = structure.blocks.filter((b) => b.type === 'alternative');
		const pros = structure.blocks.filter((b) => b.type === 'pro');
		const cons = structure.blocks.filter((b) => b.type === 'con');
		const caveats = structure.blocks.filter((b) => b.type === 'caveat');
		const rest = structure.blocks.filter(
			(b) => !['recommendation', 'alternative', 'pro', 'con', 'caveat'].includes(b.type),
		);

		const positions: PositionedBlock[] = [];
		const cx = bounds.width / 2;
		const GAP = 24;

		let cursorY = 40;

		if (rec) {
			const m = mById.get(rec.id)!;
			positions.push({
				...m,
				x: cx - m.width / 2,
				y: cursorY,
				opacity: 1,
			});
			cursorY += m.height + GAP * 2;
		}

		// Alternatives row
		if (alts.length > 0) {
			const altMeasured = alts.map((b) => mById.get(b.id)!).filter(Boolean);
			const rowWidth = altMeasured.reduce((s, m) => s + m.width, 0) + GAP * (altMeasured.length - 1);
			let x = cx - rowWidth / 2;
			let rowH = 0;
			for (const m of altMeasured) {
				positions.push({ ...m, x, y: cursorY, opacity: 0.95 });
				x += m.width + GAP;
				rowH = Math.max(rowH, m.height);
			}
			cursorY += rowH + GAP * 2;
		}

		// Pros left, cons right
		const prosMeasured = pros.map((b) => mById.get(b.id)!).filter(Boolean);
		const consMeasured = cons.map((b) => mById.get(b.id)!).filter(Boolean);
		let prosY = cursorY;
		let consY = cursorY;
		for (const m of prosMeasured) {
			positions.push({ ...m, x: GAP, y: prosY, opacity: 0.85 });
			prosY += m.height + GAP;
		}
		for (const m of consMeasured) {
			positions.push({ ...m, x: bounds.width - m.width - GAP, y: consY, opacity: 0.85 });
			consY += m.height + GAP;
		}
		cursorY = Math.max(prosY, consY) + GAP;

		// Caveats centered row
		for (const b of caveats) {
			const m = mById.get(b.id);
			if (!m) continue;
			positions.push({ ...m, x: cx - m.width / 2, y: cursorY, opacity: 0.65 });
			cursorY += m.height + GAP;
		}

		// Context / explanations stacked centered, lower opacity
		for (const b of rest) {
			const m = mById.get(b.id);
			if (!m) continue;
			positions.push({
				...m,
				x: cx - m.width / 2,
				y: cursorY,
				opacity: b.type === 'context' ? 0.45 : 0.8,
			});
			cursorY += m.height + GAP;
		}

		void byId;
		return {
			positions,
			bounds: { width: bounds.width, height: Math.max(cursorY + 40, bounds.height) },
			mode: 'decision',
		};
	}

	/** Exploration mode: force-directed with importance-weighted centering. */
	private layoutExploration(input: LayoutInput): LayoutResult {
		const { structure, measured, bounds } = input;
		const mById = new Map(measured.map((m) => [m.id, m]));
		const n = structure.blocks.length;

		// Initial positions: seed on a circle proportional to 1 - importance.
		const x = new Float32Array(n);
		const y = new Float32Array(n);
		const w = new Float32Array(n);
		const h = new Float32Array(n);
		const imp = new Float32Array(n);
		const vx = new Float32Array(n);
		const vy = new Float32Array(n);

		const cx = bounds.width / 2;
		const cy = bounds.height / 2;
		const radius = Math.min(bounds.width, bounds.height) * 0.35;

		for (let i = 0; i < n; i++) {
			const b = structure.blocks[i];
			const m = mById.get(b.id);
			if (!m) continue;
			const angle = (i / n) * Math.PI * 2;
			const r = radius * (1 - 0.6 * b.importance);
			x[i] = cx + Math.cos(angle) * r;
			y[i] = cy + Math.sin(angle) * r;
			w[i] = m.width;
			h[i] = m.height;
			imp[i] = b.importance;
		}

		const wasm = isWasmReady() ? getWasm() : null;
		// If WASM truly isn't loaded, the Vite alias points to the stub which implements
		// the same functions; so we call them via a dynamic import.
		const api = wasm ?? ((await import('@vfir/wasm')) as unknown as typeof wasm);

		for (let iter = 0; iter < FORCE_ITERATIONS; iter++) {
			const next = api.force_step(
				x, y, w, h, imp, vx, vy, cx, cy, REPULSION, CENTERING, DAMPING, DT,
			);
			for (let i = 0; i < n; i++) {
				x[i] = next[i * 4 + 0];
				y[i] = next[i * 4 + 1];
				vx[i] = next[i * 4 + 2];
				vy[i] = next[i * 4 + 3];
			}
			const clamped = api.clamp_to_bounds(x, y, w, h, bounds.width, bounds.height);
			for (let i = 0; i < n; i++) {
				x[i] = clamped[i * 2 + 0];
				y[i] = clamped[i * 2 + 1];
			}
		}

		const positions: PositionedBlock[] = structure.blocks.map((b, i) => {
			const m = mById.get(b.id)!;
			return {
				...m,
				x: x[i] - m.width / 2,
				y: y[i] - m.height / 2,
				opacity: 0.4 + 0.6 * b.importance,
			};
		});

		void BlockRelationship; // relationships reserved for v2 connection lines
		return { positions, bounds, mode: 'exploration' };
	}
}
```

> **Note for the executor:** the `await import('@vfir/wasm')` fallback inside a sync method won't work as-is in TypeScript. Wrap the whole `layoutExploration` body in an async function. Easiest fix: change `private layoutExploration(input: LayoutInput): LayoutResult` to `private async layoutExploration(input: LayoutInput): Promise<LayoutResult>`, then update the caller `compute()` to `await` both branches (it already is async). The decision branch can stay sync but be wrapped via `Promise.resolve(this.layoutDecision(input))`.

### Step 8.2 — Fix the `compute()` to uniformly return a Promise

Rewrite `compute()` like this:

```typescript
async compute(input: LayoutInput): Promise<LayoutResult> {
	try { await loadWasm(); } catch { /* stub is fine */ }
	if (input.mode === 'decision') return this.layoutDecision(input);
	return this.layoutExploration(input);
}
```

And make `layoutExploration` `async`. The dynamic `import('@vfir/wasm')` resolves via the Vite alias to either the real package or the stub.

---

## Phase 9 — Session pipeline

### Step 9.1 — `packages/cartographer/src/session.ts`

```typescript
import { Annotator, type AnnotatorOptions } from './annotator.js';
import { detectMode } from './mode-detector.js';
import { Measurer } from './measurer.js';
import { LayoutEngine } from './layout-engine.js';
import type { LayoutResult, MapOptions, ResponseStructure } from './types.js';

export interface SessionOptions {
	annotator: AnnotatorOptions;
	fontFamily: string;
	/** Max width one block is allowed before wrapping */
	maxBlockWidth?: number;
}

export class Session {
	private annotator: Annotator;
	private measurer: Measurer;
	private engine = new LayoutEngine();

	/** Cached last annotation so re-layout on resize doesn't re-call the API */
	private lastStructure: ResponseStructure | null = null;
	private lastInputText: string | null = null;

	constructor(private options: SessionOptions) {
		this.annotator = new Annotator(options.annotator);
		this.measurer = new Measurer({
			fontFamily: options.fontFamily,
			maxBlockWidth: options.maxBlockWidth ?? 420,
		});
	}

	async map(responseText: string, opts: MapOptions): Promise<LayoutResult> {
		let structure: ResponseStructure;
		if (this.lastStructure && this.lastInputText === responseText) {
			structure = this.lastStructure;
		} else {
			structure = await this.annotator.annotate(responseText);
			this.lastStructure = structure;
			this.lastInputText = responseText;
		}
		const mode = opts.mode ?? detectMode(structure);
		const measured = this.measurer.measure(structure.blocks);
		return this.engine.compute({
			structure,
			measured,
			mode,
			bounds: { width: opts.width, height: opts.height },
		});
	}

	getLastStructure(): ResponseStructure | null {
		return this.lastStructure;
	}
}
```

---

## Phase 10 — Barrel export

### Step 10.1 — `packages/cartographer/src/index.ts`

```typescript
export { Annotator, parseJsonResponse } from './annotator.js';
export type { AnnotatorOptions } from './annotator.js';
export { detectMode } from './mode-detector.js';
export { Measurer } from './measurer.js';
export type { MeasurerOptions } from './measurer.js';
export { LayoutEngine } from './layout-engine.js';
export type { LayoutInput } from './layout-engine.js';
export { Session } from './session.js';
export type { SessionOptions } from './session.js';
export type * from './types.js';
```

### Step 10.2 — Build the package

```bash
pnpm --filter @vfir/cartographer run build
```

Expected: `packages/cartographer/dist/index.js` and `index.d.ts` produced, no errors.

---

## Phase 11 — Playground tab

### Step 11.1 — Add workspace dep to the playground

Edit `apps/playground/package.json`, add to `dependencies`:

```json
"@vfir/cartographer": "workspace:*",
```

Then:

```bash
pnpm install
```

### Step 11.2 — `apps/playground/src/ResponseMap.svelte`

New file. Keep layout transitions animated by reusing the existing `Interpolator` (one per block, one axis `t` from 0 → 1) — this ties cartographer back into vfir's core story.

```svelte
<script lang="ts">
	import { Session, type LayoutMode, type LayoutResult, type PositionedBlock } from '@vfir/cartographer';
	import { Interpolator, easeOutCubic } from '@vfir/core';
	import { onDestroy, onMount } from 'svelte';

	const LS_KEY = 'cartographer-api-key';
	const SAMPLE = `You asked whether to use Postgres or DynamoDB for the new service.

**Use Postgres.** You already operate it, the access pattern is relational, and the projected scale (~50 RPS p99, ~200GB) is well under a single writer's limits for years.

Alternative: DynamoDB. Reasonable if the team commits to single-table design and you expect spiky bursts. But your team has no DDB experience and the queries are join-heavy.

Pros of Postgres:
- Existing ops knowledge
- Native joins, window functions
- Cheap at this scale

Cons of DynamoDB here:
- Schema-less design fights your relational data
- Query patterns require careful GSI planning

Caveat: if the write volume grows 10x in the next 12 months, revisit.

Context: the service handles order fulfillment events and downstream reporting joins.`;

	let apiKey = $state<string>('');
	let responseText = $state<string>(SAMPLE);
	let mode = $state<LayoutMode | 'auto'>('auto');
	let status = $state<'idle' | 'annotating' | 'laying-out' | 'error' | 'ready'>('idle');
	let errorMsg = $state<string>('');
	let layout = $state<LayoutResult | null>(null);
	let container: HTMLElement;
	let containerWidth = $state(0);
	let containerHeight = $state(0);

	// One Interpolator per block (two axes: progress t in [0,1] drives entry; xOff/yOff interpolate on relayout).
	// We store current positions separately and animate them toward the layout's target via Interpolator.
	let interps = new Map<string, Interpolator>();
	let unsubs: Array<() => void> = [];
	let rendered = $state<PositionedBlock[]>([]);

	onMount(() => {
		apiKey = localStorage.getItem(LS_KEY) ?? '';
		const ro = new ResizeObserver((entries) => {
			const box = entries[0].contentRect;
			containerWidth = box.width;
			containerHeight = Math.max(600, box.height);
			if (layout) rerun();
		});
		ro.observe(container);
		return () => ro.disconnect();
	});

	onDestroy(() => {
		for (const u of unsubs) u();
		for (const i of interps.values()) i.destroy();
	});

	function saveKey() {
		if (apiKey) localStorage.setItem(LS_KEY, apiKey);
	}

	async function run() {
		if (!apiKey) {
			errorMsg = 'Paste your Anthropic API key first.';
			status = 'error';
			return;
		}
		errorMsg = '';
		status = 'annotating';
		try {
			const session = new Session({
				annotator: { apiKey },
				fontFamily: 'Recursive',
				maxBlockWidth: Math.min(480, containerWidth * 0.6),
			});
			status = 'laying-out';
			const result = await session.map(responseText, {
				width: containerWidth,
				height: containerHeight,
				mode: mode === 'auto' ? undefined : mode,
			});
			layout = result;
			applyLayout(result);
			status = 'ready';
		} catch (e) {
			errorMsg = e instanceof Error ? e.message : String(e);
			status = 'error';
		}
	}

	async function rerun() {
		if (!layout) return;
		// Re-measure + relayout at new bounds; reuses cached structure inside Session via apiKey cache.
		// Simpler: just rebuild a fresh session (annotator will serve from cache).
		// For v1, call run() again.
		await run();
	}

	function applyLayout(result: LayoutResult) {
		const byId = new Map(result.positions.map((p) => [p.id, p]));
		// Kill stale interpolators
		for (const [id, interp] of interps) {
			if (!byId.has(id)) {
				interp.destroy();
				interps.delete(id);
			}
		}
		// Create/update interpolators
		for (const pos of result.positions) {
			let interp = interps.get(pos.id);
			if (!interp) {
				interp = new Interpolator({
					axes: {
						x: { tag: 'x', min: -9999, max: 9999, default: pos.x },
						y: { tag: 'y', min: -9999, max: 9999, default: pos.y },
						opacity: { tag: 'opacity', min: 0, max: 1, default: 0 },
					},
					stiffness: 0.12,
					easing: easeOutCubic,
					epsilon: 0.3,
				});
				interps.set(pos.id, interp);
				unsubs.push(
					interp.subscribe(() => {
						rendered = result.positions.map((p) => {
							const i = interps.get(p.id);
							if (!i) return p;
							const s = i.getSnapshot();
							return { ...p, x: s.x, y: s.y, opacity: s.opacity };
						});
					}),
				);
			}
			interp.setAll({ x: pos.x, y: pos.y, opacity: pos.opacity });
		}
	}

	function textForId(id: string): string {
		const session = null; // structure is held inside Session; for v1 we re-derive from the last layout call
		void session;
		// Simpler: include text directly on the PositionedBlock by extending the type.
		// v1 workaround: look up in a module-level map populated at applyLayout time.
		return textMap.get(id) ?? '';
	}

	const textMap = new Map<string, string>();
	// Populate textMap when we apply the layout — hook it in applyLayout above by passing structure.
	// For the simplest Haiku-safe path, change Session to expose the structure too, and populate here.
</script>

<div class="cm-wrap">
	<div class="cm-toolbar">
		<input
			class="cm-key"
			type="password"
			placeholder="Anthropic API key (stored in localStorage)"
			bind:value={apiKey}
			onblur={saveKey}
		/>
		<select class="cm-mode" bind:value={mode}>
			<option value="auto">auto</option>
			<option value="decision">decision</option>
			<option value="exploration">exploration</option>
		</select>
		<button class="cm-run" onclick={run} disabled={status === 'annotating' || status === 'laying-out'}>
			{status === 'annotating' ? 'annotating…' : status === 'laying-out' ? 'laying out…' : 'Map response'}
		</button>
	</div>

	<div class="cm-split">
		<textarea class="cm-input" bind:value={responseText} spellcheck="false"></textarea>
		<div class="cm-canvas" bind:this={container}>
			{#if status === 'error'}
				<div class="cm-err">{errorMsg}</div>
			{/if}
			{#if rendered.length > 0}
				{#each rendered as block (block.id)}
					<div
						class="cm-block type-{''}"
						style="
							transform: translate({block.x}px, {block.y}px);
							width: {block.width}px;
							font-size: {block.fontSize}px;
							font-weight: {block.fontWeight};
							opacity: {block.opacity};
						"
					>{textMap.get(block.id) ?? ''}</div>
				{/each}
			{/if}
		</div>
	</div>
</div>

<style>
	.cm-wrap {
		display: flex;
		flex-direction: column;
		height: calc(100vh - 57px);
		overflow: hidden;
	}
	.cm-toolbar {
		display: flex;
		gap: 0.5rem;
		padding: 0.75rem 1.5rem;
		border-bottom: 1px solid #1e1e1e;
	}
	.cm-key {
		flex: 1;
		background: #111;
		border: 1px solid #2a2a2a;
		color: #ccc;
		font-family: monospace;
		font-size: 0.8rem;
		padding: 0.4rem 0.6rem;
		border-radius: 4px;
	}
	.cm-mode {
		background: #1a1a1a;
		border: 1px solid #2a2a2a;
		color: #ccc;
		font-family: monospace;
		font-size: 0.8rem;
		padding: 0.4rem 0.6rem;
		border-radius: 4px;
	}
	.cm-run {
		background: #7c6af7;
		border: none;
		color: #fff;
		font-family: system-ui;
		font-size: 0.85rem;
		padding: 0.4rem 1rem;
		border-radius: 4px;
		cursor: pointer;
	}
	.cm-run:disabled {
		opacity: 0.5;
		cursor: wait;
	}
	.cm-split {
		display: grid;
		grid-template-columns: 380px 1fr;
		flex: 1;
		min-height: 0;
	}
	.cm-input {
		background: #111;
		border: none;
		border-right: 1px solid #1e1e1e;
		color: #e0e0e0;
		font-family: 'Berkeley Mono', 'JetBrains Mono', monospace;
		font-size: 0.8rem;
		line-height: 1.6;
		padding: 1rem 1.25rem;
		resize: none;
		outline: none;
	}
	.cm-canvas {
		position: relative;
		background: #0b0b0b;
		overflow: auto;
	}
	.cm-block {
		position: absolute;
		top: 0;
		left: 0;
		font-family: 'Recursive', system-ui;
		color: #f0f0f0;
		line-height: 1.35;
		will-change: transform, opacity;
		padding: 0.5rem 0.75rem;
		box-sizing: border-box;
		border-radius: 6px;
		background: rgba(26, 26, 26, 0.8);
	}
	.cm-err {
		position: absolute;
		top: 1rem;
		left: 1rem;
		color: #f74a4a;
		font-family: monospace;
		font-size: 0.85rem;
		max-width: 600px;
		white-space: pre-wrap;
	}
</style>
```

### Step 11.3 — Plug the text lookup

The sketch above uses `textMap` as a placeholder. Make it real by updating `packages/cartographer/src/types.ts` — extend `PositionedBlock` with `text` and `type`:

```typescript
export interface PositionedBlock extends MeasuredBlock {
	x: number;
	y: number;
	opacity: number;
	text: string;
	type: BlockType;
}
```

Then in `packages/cartographer/src/layout-engine.ts`, populate `text` and `type` when constructing positions in both `layoutDecision` and `layoutExploration`:

```typescript
// inside layoutDecision where we push(positions):
positions.push({
	...m,
	x: cx - m.width / 2,
	y: cursorY,
	opacity: 1,
	text: rec.text,
	type: rec.type,
});
// ...repeat for every push. Look up the source block from structure.blocks or byId.
```

And in `layoutExploration`:

```typescript
const positions: PositionedBlock[] = structure.blocks.map((b, i) => {
	const m = mById.get(b.id)!;
	return {
		...m,
		x: x[i] - m.width / 2,
		y: y[i] - m.height / 2,
		opacity: 0.4 + 0.6 * b.importance,
		text: b.text,
		type: b.type,
	};
});
```

Now `ResponseMap.svelte` can drop `textMap` and render `block.text` directly:

```svelte
<div class="cm-block type-{block.type}" ...>{block.text}</div>
```

Delete the `textMap` and `textForId` references from the component.

### Step 11.4 — Add per-type background accents

Append to the `<style>` block in `ResponseMap.svelte`:

```css
.cm-block.type-recommendation { background: rgba(124, 106, 247, 0.18); border: 1px solid rgba(124, 106, 247, 0.4); }
.cm-block.type-alternative    { background: rgba(106, 200, 247, 0.14); }
.cm-block.type-pro            { background: rgba(74, 247, 122, 0.12); }
.cm-block.type-con            { background: rgba(247, 106, 106, 0.12); }
.cm-block.type-caveat         { background: rgba(247, 166, 54, 0.12); border-left: 2px solid rgba(247, 166, 54, 0.5); }
.cm-block.type-code           { background: #111; font-family: 'Berkeley Mono', monospace; }
.cm-block.type-context        { background: transparent; color: #888; }
```

### Step 11.5 — Wire the new tab into `App.svelte`

Edit `apps/playground/src/App.svelte`:

1. Add to the imports at the top of `<script>`:
   ```typescript
   import ResponseMap from './ResponseMap.svelte';
   ```
2. Extend the `Tab` union:
   ```typescript
   type Tab = 'sliders' | 'kinetic' | 'prompt-studio' | 'response-map';
   ```
3. Add a nav button inside `<nav>`:
   ```svelte
   <button
       class:active={activeTab === 'response-map'}
       onclick={() => (activeTab = 'response-map')}
   >Response Map</button>
   ```
4. Add the branch at the bottom of the tab `{#if}` chain, before the final `{:else}`:
   ```svelte
   {:else if activeTab === 'response-map'}
       <ResponseMap />
   ```
   (The existing `{:else}` that renders Prompt Studio stays last — so make that one `{:else if activeTab === 'prompt-studio'}` followed by `{:else}<ResponseMap />` — whichever ordering is cleaner. Either way, ensure Prompt Studio still renders when its tab is active.)

---

## Phase 12 — Typecheck + dev smoke test

### Step 12.1 — Typecheck all packages

```bash
pnpm typecheck
```

Expected: no errors. If `@vfir/cartographer` flags that `@vfir/wasm` has no `force_step` / `clamp_to_bounds` types, re-check Step 6.2 — the declarations in `packages/core/src/types/wasm.d.ts` must include both new functions.

### Step 12.2 — Build all packages

```bash
pnpm build
```

Expected: every package builds. If the Svelte adapter or the playground fails, read the error — it's almost always a missing `workspace:*` link or a forgotten export.

### Step 12.3 — Run the playground

```bash
pnpm dev
```

Open the printed URL, click the "Response Map" tab. Paste an Anthropic API key in the toolbar. Click "Map response". Expected: the sample text maps into a decision-mode layout with the recommendation centered, two alternative cards flanking, and pros/cons/caveats placed according to Phase 8.

Switch the mode selector to `exploration` and click again. Blocks should settle into force-directed positions with the recommendation near the center.

### Step 12.4 — Without an API key

Verify the error path: clear the key field, click "Map response". Expected: red error message `Paste your Anthropic API key first.` and no crash.

---

## Phase 13 — Task log

After execution, create a completion log at `tasks/YYYY-MM-DD-response-cartographer.md` using the same shape as `tasks/2026-04-18-prompt-studio.md`:

- Date, status, summary
- What was done (package, WASM extensions, playground tab)
- Key decisions (decision+exploration only for v1, localStorage key, Interpolator for transitions)
- Key files table
- Open items (revision diff, SVG connection lines, streaming annotations, React adapter, tutorial/comparison/code-first modes)

---

## Execution order (TL;DR for Haiku)

1. Phase 1 — scaffold package, `pnpm install`, verify workspace.
2. Phase 2 — types.ts.
3. Phase 3 — annotator.ts.
4. Phase 4 — mode-detector.ts.
5. Phase 5 — extend `packages/wasm/src/lib.rs` with `force_step` + `clamp_to_bounds`.
6. Phase 6 — extend stub + WASM .d.ts.
7. Phase 7 — measurer.ts.
8. Phase 8 — layout-engine.ts (make `compute` + both mode methods async).
9. Phase 9 — session.ts.
10. Phase 10 — index.ts + `pnpm --filter @vfir/cartographer build`.
11. Phase 11 — ResponseMap.svelte + App.svelte tab wiring + extend `PositionedBlock` with `text`/`type`.
12. Phase 12 — `pnpm typecheck`, `pnpm build`, `pnpm dev` smoke test.
13. Phase 13 — task log.

## Key files summary

| File | Purpose |
|------|---------|
| `packages/cartographer/package.json` | Package manifest |
| `packages/cartographer/src/types.ts` | Contracts |
| `packages/cartographer/src/annotator.ts` | Anthropic API client |
| `packages/cartographer/src/mode-detector.ts` | Mode heuristic |
| `packages/cartographer/src/measurer.ts` | Wraps MetricsProvider per block |
| `packages/cartographer/src/layout-engine.ts` | Decision + exploration layouts |
| `packages/cartographer/src/session.ts` | Pipeline orchestrator |
| `packages/cartographer/src/index.ts` | Barrel export |
| `packages/wasm/src/lib.rs` | +`force_step`, +`clamp_to_bounds` |
| `packages/core/src/types/wasm.d.ts` | +TS types for new WASM exports |
| `apps/playground/src/wasm-stub.ts` | +JS fallbacks for new WASM exports |
| `apps/playground/src/ResponseMap.svelte` | UI component |
| `apps/playground/src/App.svelte` | New "Response Map" tab wiring |
| `apps/playground/package.json` | +`@vfir/cartographer` dep |

## Risks and notes for the executor

- **Annotator output quality**: if Haiku-4-5 returns malformed JSON, `parseJsonResponse` strips fences and extracts the first `{...}`. If it still fails, surface the raw text in the UI under the error; do not retry silently.
- **CORS / browser API call**: Anthropic's browser access requires `anthropic-dangerous-direct-browser-access: true`. Without it, the request is blocked. This is intentional for the playground; a production build should route through a backend.
- **WASM fallback**: `layoutExploration` relies on the `@vfir/wasm` import (via Vite alias) always having `force_step` / `clamp_to_bounds`. If the real WASM package was built before Phase 5 was merged, the browser will call an undefined export. Rebuild WASM (`pnpm build:wasm`) or delete `packages/wasm/pkg/` to force the stub path during dev.
- **Measurer uses block-per-measurement `MetricsProvider`**: for v1 this is fine. Optimization (v2): one `MetricsProvider` per `(fontSize, lineHeight)` pair, shared across blocks.
- **Resize**: the component calls `rerun()` on resize. For v1 this re-calls the annotator cache (same input → no API call) and re-runs layout. If this feels slow, split `Session.map()` into `analyze()` (annotate + measure) and `layout()` (engine only).
- **Do not** commit a hardcoded API key. Do not add a default value to the `apiKey` state.
