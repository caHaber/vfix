# VFIR Implementation Plan — Variable Font Interpolation Renderer

## Context

Building `vfir` from scratch in an empty repo (`/Users/cahaber/workspace/vfix`). The goal is a framework-agnostic core library + Svelte 5 adapter for real-time variable font axis interpolation with WASM-backed layout. The plan is designed to be executed step-by-step by an LLM (Haiku) with minimal ambiguity.

**Repo state**: Empty except for `README.md`. Everything must be scaffolded from scratch.

---

## Phase 1: Monorepo Scaffolding & Toolchain

### Step 1.1: Root workspace config

Create the following files at the repo root (`/Users/cahaber/workspace/vfix/`):

**`package.json`**
```json
{
  "name": "vfir",
  "private": true,
  "packageManager": "pnpm@9.15.4",
  "engines": { "node": ">=20" },
  "scripts": {
    "build": "pnpm -r --filter './packages/*' run build",
    "build:wasm": "pnpm --filter @vfir/wasm run build",
    "dev": "pnpm --filter playground run dev",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "biome check .",
    "lint:fix": "biome check --write .",
    "typecheck": "pnpm -r run typecheck"
  }
}
```

**`pnpm-workspace.yaml`**
```yaml
packages:
  - 'packages/*'
  - 'apps/*'
  - 'examples/*'
```

**`.nvmrc`**
```
20
```

**`tsconfig.base.json`** (shared TypeScript config all packages extend)
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "dist",
    "lib": ["ES2022", "DOM", "DOM.Iterable"]
  },
  "exclude": ["node_modules", "dist"]
}
```

**`biome.json`**
```json
{
  "$schema": "https://biomejs.dev/schemas/1.9.4/schema.json",
  "organizeImports": { "enabled": true },
  "linter": {
    "enabled": true,
    "rules": { "recommended": true }
  },
  "formatter": {
    "enabled": true,
    "indentStyle": "tab",
    "lineWidth": 100
  },
  "javascript": {
    "formatter": { "quoteStyle": "single", "semicolons": "always" }
  }
}
```

**`.gitignore`**
```
node_modules/
dist/
.turbo/
*.tsbuildinfo
target/
pkg/
.vite/
.svelte-kit/
```

**`rust-toolchain.toml`**
```toml
[toolchain]
channel = "stable"
targets = ["wasm32-unknown-unknown"]
```

### Step 1.2: Create directory structure

Create these directories (they can be empty initially — each step below populates them):

```
packages/core/src/
packages/wasm/src/
packages/svelte/src/
packages/vanilla/src/
apps/playground/src/
examples/hero-text/
tooling/benchmarks/
```

### Step 1.3: Install root dev dependencies

Run from repo root:
```bash
pnpm add -Dw vitest @biomejs/biome typescript
```

---

## Phase 2: Core Package (`packages/core`)

This is the framework-agnostic engine. No DOM, no framework — pure logic.

### Step 2.1: Package config

**`packages/core/package.json`**
```json
{
  "name": "@vfir/core",
  "version": "0.0.1",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": { "import": "./dist/index.js", "types": "./dist/index.d.ts" }
  },
  "scripts": {
    "build": "tsup src/index.ts --format esm --dts --clean",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "tsup": "^8.0.0"
  }
}
```

**`packages/core/tsconfig.json`**
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src"]
}
```

### Step 2.2: Type definitions

**`packages/core/src/types.ts`**

Define ALL core types. These are the contract everything else depends on.

```typescript
/** Configuration for a single font axis */
export interface AxisConfig {
  /** OpenType axis tag, e.g. 'wght', 'wdth', 'slnt', or custom */
  tag: string;
  /** Minimum allowed value */
  min: number;
  /** Maximum allowed value */
  max: number;
  /** Default/initial value */
  default: number;
}

/** Runtime state of a single axis */
export interface AxisState {
  tag: string;
  min: number;
  max: number;
  default: number;
  /** Current interpolated value */
  current: number;
  /** Target value (drives animation) */
  target: number;
  /** Easing function for this axis */
  easing: EasingFn;
}

/** A snapshot of all axis values at a point in time */
export type AxisSnapshot = Record<string, number>;

/** Easing function signature: takes progress 0-1, returns eased 0-1 */
export type EasingFn = (t: number) => number;

/** Unsubscribe function returned by subscribe() */
export type Unsubscribe = () => void;

/** Options for creating an Interpolator */
export interface InterpolatorOptions {
  /** Map of axis tag to config */
  axes: Record<string, AxisConfig>;
  /** Default easing for all axes (can be overridden per-axis) */
  easing?: EasingFn;
  /** Interpolation speed factor (0-1, where 1 = instant) */
  stiffness?: number;
  /** Threshold below which interpolation snaps to target */
  epsilon?: number;
}

/** Result from the layout engine */
export interface LayoutResult {
  /** Line break indices */
  breaks: number[];
  /** Per-line widths */
  lineWidths: number[];
  /** Total height */
  totalHeight: number;
}

/** Glyph-level metrics from measurement */
export interface GlyphMetrics {
  /** Total measured width */
  width: number;
  /** Total measured height */
  height: number;
  /** Ascent from baseline */
  ascent: number;
  /** Descent from baseline */
  descent: number;
  /** Per-character advance widths */
  glyphAdvances: Float32Array;
  /** Valid line-break indices */
  breakPoints: Uint32Array;
}

/** A single measurement request */
export interface MeasureRequest {
  text: string;
  axes: AxisSnapshot;
  fontSize: number;
}

/** Subscriber callback */
export type SubscriberFn = (snapshot: AxisSnapshot) => void;
```

### Step 2.3: Easing functions

**`packages/core/src/easing.ts`**

```typescript
import type { EasingFn } from './types.js';

export const linear: EasingFn = (t) => t;

export const easeInQuad: EasingFn = (t) => t * t;

export const easeOutQuad: EasingFn = (t) => t * (2 - t);

export const easeInOutQuad: EasingFn = (t) =>
  t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;

export const easeOutCubic: EasingFn = (t) => --t * t * t + 1;

export const easeInOutCubic: EasingFn = (t) =>
  t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1;

/** Spring-like easing with overshoot */
export const easeOutBack: EasingFn = (t) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};

/** Create a cubic bezier easing function */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): EasingFn {
  // Newton-Raphson approximation for cubic bezier
  return (t: number): number => {
    if (t === 0 || t === 1) return t;

    let start = 0;
    let end = 1;
    let mid: number;

    // Binary search for t on the x curve
    for (let i = 0; i < 20; i++) {
      mid = (start + end) / 2;
      const xMid = bezierPoint(mid, x1, x2);
      if (Math.abs(xMid - t) < 0.0001) break;
      if (xMid < t) start = mid;
      else end = mid;
    }

    // biome-ignore lint: mid is always assigned after 1+ iteration
    return bezierPoint(mid!, y1, y2);
  };
}

function bezierPoint(t: number, p1: number, p2: number): number {
  return 3 * (1 - t) * (1 - t) * t * p1 + 3 * (1 - t) * t * t * p2 + t * t * t;
}
```

### Step 2.4: Interpolator (the core abstraction)

**`packages/core/src/interpolator.ts`**

```typescript
import { linear } from './easing.js';
import type {
  AxisConfig,
  AxisSnapshot,
  AxisState,
  EasingFn,
  InterpolatorOptions,
  SubscriberFn,
  Unsubscribe,
} from './types.js';

export class Interpolator {
  private axes: Map<string, AxisState> = new Map();
  private subscribers: Set<SubscriberFn> = new Set();
  private rafId: number | null = null;
  private dirty = false;
  private stiffness: number;
  private epsilon: number;

  constructor(options: InterpolatorOptions) {
    this.stiffness = options.stiffness ?? 0.08;
    this.epsilon = options.epsilon ?? 0.01;
    const defaultEasing = options.easing ?? linear;

    for (const [tag, config] of Object.entries(options.axes)) {
      this.axes.set(tag, {
        tag,
        min: config.min,
        max: config.max,
        default: config.default,
        current: config.default,
        target: config.default,
        easing: defaultEasing,
      });
    }
  }

  /** Set a single axis target value */
  set(tag: string, value: number): void {
    const axis = this.axes.get(tag);
    if (!axis) return;
    axis.target = Math.max(axis.min, Math.min(axis.max, value));
    this.scheduleTick();
  }

  /** Set multiple axis target values at once */
  setAll(values: Record<string, number>): void {
    for (const [tag, value] of Object.entries(values)) {
      const axis = this.axes.get(tag);
      if (!axis) continue;
      axis.target = Math.max(axis.min, Math.min(axis.max, value));
    }
    this.scheduleTick();
  }

  /** Instantly jump to target values (no animation) */
  jumpTo(values: Record<string, number>): void {
    for (const [tag, value] of Object.entries(values)) {
      const axis = this.axes.get(tag);
      if (!axis) continue;
      const clamped = Math.max(axis.min, Math.min(axis.max, value));
      axis.target = clamped;
      axis.current = clamped;
    }
    this.notify();
  }

  /** Set easing for a specific axis */
  setEasing(tag: string, easing: EasingFn): void {
    const axis = this.axes.get(tag);
    if (axis) axis.easing = easing;
  }

  /** Get current snapshot of all axis values */
  getSnapshot(): AxisSnapshot {
    const snapshot: AxisSnapshot = {};
    for (const [tag, state] of this.axes) {
      snapshot[tag] = state.current;
    }
    return snapshot;
  }

  /** Get a single axis config */
  getAxis(tag: string): Readonly<AxisState> | undefined {
    return this.axes.get(tag);
  }

  /** Get all axis tags */
  getAxes(): string[] {
    return Array.from(this.axes.keys());
  }

  /** Subscribe to axis value changes */
  subscribe(fn: SubscriberFn): Unsubscribe {
    this.subscribers.add(fn);
    // Immediately call with current state
    fn(this.getSnapshot());
    return () => this.subscribers.delete(fn);
  }

  /** Stop the render loop and clean up */
  destroy(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.subscribers.clear();
  }

  private scheduleTick(): void {
    this.dirty = true;
    if (this.rafId === null) {
      this.rafId = requestAnimationFrame(() => this.tick());
    }
  }

  private tick(): void {
    this.rafId = null;

    if (!this.dirty) return;

    let anyMoving = false;
    for (const axis of this.axes.values()) {
      if (Math.abs(axis.target - axis.current) < this.epsilon) {
        axis.current = axis.target;
      } else {
        axis.current += (axis.target - axis.current) * this.stiffness;
        anyMoving = true;
      }
    }

    this.notify();

    if (anyMoving) {
      this.rafId = requestAnimationFrame(() => this.tick());
    } else {
      this.dirty = false;
    }
  }

  private notify(): void {
    const snapshot = this.getSnapshot();
    for (const fn of this.subscribers) {
      fn(snapshot);
    }
  }
}
```

### Step 2.5: Metrics provider (measurement + caching layer)

**`packages/core/src/metrics.ts`**

This wraps browser font measurement with LRU caching. Uses OffscreenCanvas when available, falls back to a hidden DOM canvas.

```typescript
import type { AxisSnapshot, GlyphMetrics, MeasureRequest } from './types.js';

/** LRU cache for measurement results */
class LRUCache<V> {
  private map = new Map<string, V>();

  constructor(private maxSize: number) {}

  get(key: string): V | undefined {
    const value = this.map.get(key);
    if (value !== undefined) {
      // Move to end (most recently used)
      this.map.delete(key);
      this.map.set(key, value);
    }
    return value;
  }

  set(key: string, value: V): void {
    if (this.map.has(key)) {
      this.map.delete(key);
    } else if (this.map.size >= this.maxSize) {
      // Delete oldest entry
      const firstKey = this.map.keys().next().value;
      if (firstKey !== undefined) this.map.delete(firstKey);
    }
    this.map.set(key, value);
  }

  clear(): void {
    this.map.clear();
  }
}

export interface MetricsProviderOptions {
  fontFamily: string;
  cacheSize?: number;
}

export class MetricsProvider {
  private cache: LRUCache<GlyphMetrics>;
  private canvas: OffscreenCanvas | HTMLCanvasElement;
  private ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;
  private fontFamily: string;

  constructor(options: MetricsProviderOptions) {
    this.fontFamily = options.fontFamily;
    this.cache = new LRUCache(options.cacheSize ?? 500);

    if (typeof OffscreenCanvas !== 'undefined') {
      this.canvas = new OffscreenCanvas(1, 1);
      this.ctx = this.canvas.getContext('2d')!;
    } else {
      this.canvas = document.createElement('canvas');
      this.ctx = this.canvas.getContext('2d')!;
    }
  }

  /** Build a CSS font-variation-settings string from axis values */
  private buildVariationSettings(axes: AxisSnapshot): string {
    return Object.entries(axes)
      .map(([tag, value]) => `"${tag}" ${value}`)
      .join(', ');
  }

  /** Build the full CSS font string */
  private buildFont(axes: AxisSnapshot, fontSize: number): string {
    // font-variation-settings must be set separately on canvas context
    return `${fontSize}px "${this.fontFamily}"`;
  }

  /** Cache key for a measurement request */
  private cacheKey(text: string, axes: AxisSnapshot, fontSize: number): string {
    const axisStr = Object.entries(axes)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}:${Math.round(v * 100) / 100}`)
      .join(',');
    return `${text}|${axisStr}|${fontSize}`;
  }

  /** Measure a single text string at given axis values and font size */
  measure(text: string, axes: AxisSnapshot, fontSize: number): GlyphMetrics {
    const key = this.cacheKey(text, axes, fontSize);
    const cached = this.cache.get(key);
    if (cached) return cached;

    // Set font on context
    this.ctx.font = this.buildFont(axes, fontSize);

    // Measure full string
    const metrics = this.ctx.measureText(text);

    // Measure per-character advances
    const advances = new Float32Array(text.length);
    for (let i = 0; i < text.length; i++) {
      const charMetrics = this.ctx.measureText(text[i]);
      advances[i] = charMetrics.width;
    }

    // Find valid break points (spaces, hyphens)
    const breaks: number[] = [];
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (ch === ' ' || ch === '-' || ch === '\n') {
        breaks.push(i);
      }
    }

    const result: GlyphMetrics = {
      width: metrics.width,
      height: (metrics.actualBoundingBoxAscent ?? fontSize) +
              (metrics.actualBoundingBoxDescent ?? 0),
      ascent: metrics.actualBoundingBoxAscent ?? fontSize * 0.8,
      descent: metrics.actualBoundingBoxDescent ?? fontSize * 0.2,
      glyphAdvances: advances,
      breakPoints: new Uint32Array(breaks),
    };

    this.cache.set(key, result);
    return result;
  }

  /** Measure multiple requests (batched) */
  measureBatch(requests: MeasureRequest[]): GlyphMetrics[] {
    return requests.map((r) => this.measure(r.text, r.axes, r.fontSize));
  }

  /** Invalidate cache (e.g., when font loads) */
  invalidate(): void {
    this.cache.clear();
  }
}
```

### Step 2.6: Render coordinator

**`packages/core/src/renderer.ts`**

Ties the Interpolator and MetricsProvider together into a single update loop.

```typescript
import { Interpolator } from './interpolator.js';
import { MetricsProvider } from './metrics.js';
import type { AxisSnapshot, GlyphMetrics, InterpolatorOptions, Unsubscribe } from './types.js';

export interface TextBlock {
  id: string;
  text: string;
  fontSize: number;
  availableWidth: number;
}

export interface RenderState {
  axes: AxisSnapshot;
  metrics: Map<string, GlyphMetrics>;
}

export type RenderCallback = (state: RenderState) => void;

export interface RendererOptions extends InterpolatorOptions {
  fontFamily: string;
  cacheSize?: number;
}

export class Renderer {
  readonly interpolator: Interpolator;
  readonly metrics: MetricsProvider;
  private blocks: Map<string, TextBlock> = new Map();
  private renderCallbacks: Set<RenderCallback> = new Set();
  private unsubInterpolator: Unsubscribe;

  constructor(options: RendererOptions) {
    this.interpolator = new Interpolator(options);
    this.metrics = new MetricsProvider({
      fontFamily: options.fontFamily,
      cacheSize: options.cacheSize,
    });

    this.unsubInterpolator = this.interpolator.subscribe((axes) => {
      this.onAxesChanged(axes);
    });
  }

  /** Register a text block to be measured and laid out */
  addBlock(block: TextBlock): void {
    this.blocks.set(block.id, block);
  }

  /** Remove a text block */
  removeBlock(id: string): void {
    this.blocks.delete(id);
  }

  /** Subscribe to render updates */
  onRender(fn: RenderCallback): Unsubscribe {
    this.renderCallbacks.add(fn);
    return () => this.renderCallbacks.delete(fn);
  }

  /** Clean up everything */
  destroy(): void {
    this.unsubInterpolator();
    this.interpolator.destroy();
    this.renderCallbacks.clear();
    this.blocks.clear();
  }

  private onAxesChanged(axes: AxisSnapshot): void {
    const metricsMap = new Map<string, GlyphMetrics>();

    for (const [id, block] of this.blocks) {
      const m = this.metrics.measure(block.text, axes, block.fontSize);
      metricsMap.set(id, m);
    }

    const state: RenderState = { axes, metrics: metricsMap };
    for (const fn of this.renderCallbacks) {
      fn(state);
    }
  }
}
```

### Step 2.7: Barrel export

**`packages/core/src/index.ts`**
```typescript
export { Interpolator } from './interpolator.js';
export { MetricsProvider } from './metrics.js';
export { Renderer } from './renderer.js';
export * from './easing.js';
export type * from './types.js';
```

### Step 2.8: Install core dev deps & verify build

```bash
cd packages/core && pnpm add -D tsup && cd ../..
pnpm --filter @vfir/core run build
```

---

## Phase 3: WASM Package (`packages/wasm`)

### Step 3.1: Rust project setup

**`packages/wasm/Cargo.toml`**
```toml
[package]
name = "vfir-wasm"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib"]

[dependencies]
wasm-bindgen = "0.2"
serde = { version = "1", features = ["derive"] }
serde-wasm-bindgen = "0.6"

[profile.release]
opt-level = "s"
lto = true
```

**`packages/wasm/src/lib.rs`**

Implement two core WASM functions:

```rust
use wasm_bindgen::prelude::*;

/// Compute line breaks given glyph advances and available width.
/// Returns an array of line-break indices.
#[wasm_bindgen]
pub fn compute_layout(
    advances: &[f32],
    available_width: f32,
    break_points: &[u32],
) -> Vec<u32> {
    let mut breaks = Vec::new();
    let mut line_width: f32 = 0.0;
    let mut last_break: usize = 0;

    for &bp in break_points {
        let bp = bp as usize;
        // Sum advances from last_break to bp
        let segment_width: f32 = advances[last_break..=bp.min(advances.len() - 1)].iter().sum();

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

/// Interpolate between two sets of axis values.
/// `from` and `to` must have the same length.
/// `t` is progress from 0.0 to 1.0.
/// `curve_type`: 0 = linear, 1 = ease-out cubic, 2 = spring
#[wasm_bindgen]
pub fn interpolate_axes(
    from: &[f32],
    to: &[f32],
    t: f32,
    curve_type: u8,
) -> Vec<f32> {
    let t_eased = match curve_type {
        1 => {
            // ease-out cubic
            let t1 = t - 1.0;
            t1 * t1 * t1 + 1.0
        }
        2 => {
            // spring approximation (damped oscillation)
            let decay = (-5.0 * t).exp();
            1.0 - decay * (1.0 - t)
        }
        _ => t, // linear
    };

    from.iter()
        .zip(to.iter())
        .map(|(a, b)| a + (b - a) * t_eased)
        .collect()
}

/// Cubic bezier interpolation for arbitrary control points
#[wasm_bindgen]
pub fn cubic_bezier_interpolate(
    x1: f32, y1: f32,
    x2: f32, y2: f32,
    t: f32,
) -> f32 {
    // Binary search for t on x-curve, then evaluate y
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
    3.0 * (1.0 - t).powi(2) * t * p1
        + 3.0 * (1.0 - t) * t.powi(2) * p2
        + t.powi(3)
}
```

### Step 3.2: WASM build script

**`packages/wasm/package.json`**
```json
{
  "name": "@vfir/wasm",
  "version": "0.0.1",
  "type": "module",
  "scripts": {
    "build": "wasm-pack build --target web --release --out-dir pkg",
    "typecheck": "echo 'WASM package — no TS to check'"
  },
  "files": ["pkg/"]
}
```

### Step 3.3: Build & verify

```bash
cd packages/wasm && wasm-pack build --target web --release --out-dir pkg && cd ../..
```

The output in `packages/wasm/pkg/` will contain `.wasm`, `.js`, and `.d.ts` files.

### Step 3.4: Wire WASM into core (lazy loading)

**`packages/core/src/wasm-bridge.ts`**

```typescript
let wasmModule: typeof import('@vfir/wasm') | null = null;
let wasmLoading: Promise<typeof import('@vfir/wasm')> | null = null;

/** Lazy-load the WASM module. Returns null if not yet loaded. */
export async function loadWasm(): Promise<typeof import('@vfir/wasm')> {
  if (wasmModule) return wasmModule;
  if (wasmLoading) return wasmLoading;

  wasmLoading = import('@vfir/wasm').then(async (mod) => {
    // wasm-pack web target requires calling init()
    if ('default' in mod && typeof mod.default === 'function') {
      await mod.default();
    }
    wasmModule = mod;
    return mod;
  });

  return wasmLoading;
}

/** Check if WASM is ready (non-blocking) */
export function isWasmReady(): boolean {
  return wasmModule !== null;
}

/** Get WASM module (throws if not loaded) */
export function getWasm(): typeof import('@vfir/wasm') {
  if (!wasmModule) throw new Error('WASM not loaded — call loadWasm() first');
  return wasmModule;
}
```

Add `@vfir/wasm` as an optional peer dependency in `packages/core/package.json`:
```json
"peerDependencies": {
  "@vfir/wasm": "workspace:*"
},
"peerDependenciesMeta": {
  "@vfir/wasm": { "optional": true }
}
```

Update `packages/core/src/index.ts` to also export:
```typescript
export { loadWasm, isWasmReady, getWasm } from './wasm-bridge.js';
```

---

## Phase 4: Vanilla DOM Adapter (`packages/vanilla`)

Proves the core works without any framework. Minimal API.

### Step 4.1: Package setup

**`packages/vanilla/package.json`**
```json
{
  "name": "@vfir/vanilla",
  "version": "0.0.1",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": { "import": "./dist/index.js", "types": "./dist/index.d.ts" }
  },
  "scripts": {
    "build": "tsup src/index.ts --format esm --dts --clean",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@vfir/core": "workspace:*"
  },
  "devDependencies": {
    "tsup": "^8.0.0"
  }
}
```

**`packages/vanilla/tsconfig.json`**
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src"]
}
```

### Step 4.2: Vanilla adapter implementation

**`packages/vanilla/src/index.ts`**

```typescript
import { Renderer, type RendererOptions, type AxisSnapshot } from '@vfir/core';

export interface VFIRElement {
  /** Update axis targets */
  set(values: Record<string, number>): void;
  /** Jump instantly to values */
  jumpTo(values: Record<string, number>): void;
  /** Destroy and clean up */
  destroy(): void;
  /** Access the underlying renderer */
  renderer: Renderer;
}

export interface VFIROptions extends RendererOptions {
  /** CSS selector or element to target */
  target: string | HTMLElement;
}

/** Apply variable font interpolation to a DOM element */
export function vfir(options: VFIROptions): VFIRElement {
  const el = typeof options.target === 'string'
    ? document.querySelector<HTMLElement>(options.target)
    : options.target;

  if (!el) throw new Error(`Target element not found: ${options.target}`);

  const renderer = new Renderer(options);

  // Apply font-variation-settings on each update
  renderer.interpolator.subscribe((axes: AxisSnapshot) => {
    const settings = Object.entries(axes)
      .map(([tag, value]) => `"${tag}" ${value}`)
      .join(', ');
    el.style.fontVariationSettings = settings;
    el.style.fontFamily = `"${options.fontFamily}"`;
  });

  return {
    set: (values) => renderer.interpolator.setAll(values),
    jumpTo: (values) => renderer.interpolator.jumpTo(values),
    destroy: () => renderer.destroy(),
    renderer,
  };
}
```

---

## Phase 5: Svelte 5 Adapter (`packages/svelte`)

### Step 5.1: Package setup

**`packages/svelte/package.json`**
```json
{
  "name": "@vfir/svelte",
  "version": "0.0.1",
  "type": "module",
  "svelte": "dist/index.js",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": {
      "svelte": "./dist/index.js",
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  },
  "scripts": {
    "build": "svelte-package -i src",
    "typecheck": "svelte-check --tsconfig ./tsconfig.json"
  },
  "dependencies": {
    "@vfir/core": "workspace:*"
  },
  "peerDependencies": {
    "svelte": "^5.0.0"
  },
  "devDependencies": {
    "svelte": "^5.0.0",
    "@sveltejs/package": "^2.0.0",
    "svelte-check": "^4.0.0",
    "typescript": "^5.0.0"
  }
}
```

**`packages/svelte/tsconfig.json`**
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

### Step 5.2: Svelte action (use:directive)

**`packages/svelte/src/action.ts`**

```typescript
import { Renderer, type RendererOptions, type AxisSnapshot } from '@vfir/core';
import type { Action } from 'svelte/action';

export interface VariableFontParams {
  axes: Record<string, number>;
}

export interface VariableFontAttributes {
  'on:vfir-update'?: (e: CustomEvent<AxisSnapshot>) => void;
}

/** Create a variable font action for use with use:directive */
export function createVariableFont(options: RendererOptions) {
  const renderer = new Renderer(options);

  const apply: Action<HTMLElement, VariableFontParams, VariableFontAttributes> = (
    node,
    params,
  ) => {
    // Set initial values
    if (params?.axes) {
      renderer.interpolator.jumpTo(params.axes);
    }

    const unsub = renderer.interpolator.subscribe((axes) => {
      const settings = Object.entries(axes)
        .map(([tag, value]) => `"${tag}" ${value}`)
        .join(', ');
      node.style.fontVariationSettings = settings;
      node.style.fontFamily = `"${options.fontFamily}"`;
      node.dispatchEvent(new CustomEvent('vfir-update', { detail: axes }));
    });

    return {
      update(newParams) {
        if (newParams?.axes) {
          renderer.interpolator.setAll(newParams.axes);
        }
      },
      destroy() {
        unsub();
      },
    };
  };

  return {
    apply,
    set: (values: Record<string, number>) => renderer.interpolator.setAll(values),
    jumpTo: (values: Record<string, number>) => renderer.interpolator.jumpTo(values),
    getSnapshot: () => renderer.interpolator.getSnapshot(),
    destroy: () => renderer.destroy(),
  };
}
```

### Step 5.3: Svelte runes wrapper

**`packages/svelte/src/variableFont.svelte.ts`**

```typescript
import { Renderer, type RendererOptions } from '@vfir/core';
import { onDestroy } from 'svelte';

export interface VariableFontOptions extends RendererOptions {}

/** Reactive variable font controller using Svelte 5 runes */
export function variableFont(options: VariableFontOptions) {
  const renderer = new Renderer(options);
  let currentAxes = $state(renderer.interpolator.getSnapshot());

  const unsub = renderer.interpolator.subscribe((axes) => {
    currentAxes = { ...axes };
  });

  onDestroy(() => {
    unsub();
    renderer.destroy();
  });

  return {
    get axes() {
      return currentAxes;
    },
    set(values: Record<string, number>) {
      renderer.interpolator.setAll(values);
    },
    jumpTo(values: Record<string, number>) {
      renderer.interpolator.jumpTo(values);
    },
    /** Svelte action for applying to elements */
    apply(node: HTMLElement) {
      const innerUnsub = renderer.interpolator.subscribe((axes) => {
        const settings = Object.entries(axes)
          .map(([tag, value]) => `"${tag}" ${value}`)
          .join(', ');
        node.style.fontVariationSettings = settings;
        node.style.fontFamily = `"${options.fontFamily}"`;
      });
      return { destroy: innerUnsub };
    },
    renderer,
  };
}
```

### Step 5.4: VariableText component

**`packages/svelte/src/VariableText.svelte`**

```svelte
<script lang="ts">
  import type { RendererOptions, AxisSnapshot } from '@vfir/core';
  import { variableFont } from './variableFont.svelte.js';
  import type { Snippet } from 'svelte';

  interface Props {
    options: RendererOptions;
    tag?: string;
    class?: string;
    children?: Snippet;
    onupdate?: (axes: AxisSnapshot) => void;
  }

  let { options, tag = 'span', class: className, children, onupdate }: Props = $props();

  const font = variableFont(options);

  $effect(() => {
    if (onupdate) {
      onupdate(font.axes);
    }
  });
</script>

<svelte:element this={tag} use:font.apply class={className}>
  {#if children}
    {@render children()}
  {/if}
</svelte:element>
```

### Step 5.5: Barrel export

**`packages/svelte/src/index.ts`**

```typescript
export { createVariableFont } from './action.js';
export { variableFont } from './variableFont.svelte.js';
export { default as VariableText } from './VariableText.svelte';
```

---

## Phase 6: Playground App (`apps/playground`)

### Step 6.1: Scaffold with Vite + Svelte

```bash
cd apps && pnpm create vite playground --template svelte-ts && cd ..
```

Then modify `apps/playground/package.json` to add workspace deps:
```json
"dependencies": {
  "@vfir/core": "workspace:*",
  "@vfir/svelte": "workspace:*"
}
```

### Step 6.2: Playground page

**`apps/playground/src/App.svelte`** — Replace the default content with:

```svelte
<script lang="ts">
  import { variableFont } from '@vfir/svelte';
  import { easeOutCubic } from '@vfir/core';

  const font = variableFont({
    fontFamily: 'Recursive',
    axes: {
      wght: { tag: 'wght', min: 300, max: 1000, default: 400 },
      slnt: { tag: 'slnt', min: -15, max: 0, default: 0 },
      CASL: { tag: 'CASL', min: 0, max: 1, default: 0 },
      CRSV: { tag: 'CRSV', min: 0, max: 1, default: 0.5 },
      MONO: { tag: 'MONO', min: 0, max: 1, default: 0 },
    },
    easing: easeOutCubic,
    stiffness: 0.06,
  });

  function handleSlider(tag: string, event: Event) {
    const target = event.target as HTMLInputElement;
    font.set({ [tag]: parseFloat(target.value) });
  }
</script>

<svelte:head>
  <link href="https://fonts.googleapis.com/css2?family=Recursive:slnt,wght,CASL,CRSV,MONO@-15..0,300..1000,0..1,0..1,0..1&display=swap" rel="stylesheet">
</svelte:head>

<main>
  <h1 use:font.apply>Variable Font Interpolation</h1>

  <div class="controls">
    {#each Object.entries(font.axes) as [tag, value]}
      <label>
        {tag}: {typeof value === 'number' ? value.toFixed(1) : ''}
        <input
          type="range"
          min={tag === 'slnt' ? -15 : tag === 'wght' ? 300 : 0}
          max={tag === 'wght' ? 1000 : tag === 'slnt' ? 0 : 1}
          step="0.01"
          value={value}
          oninput={(e) => handleSlider(tag, e)}
        />
      </label>
    {/each}
  </div>

  <p use:font.apply class="sample">
    The quick brown fox jumps over the lazy dog.
    Pack my box with five dozen liquor jugs.
  </p>
</main>

<style>
  main {
    max-width: 800px;
    margin: 2rem auto;
    padding: 1rem;
    font-family: system-ui;
  }
  .controls {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin: 2rem 0;
  }
  label {
    display: flex;
    align-items: center;
    gap: 1rem;
    font-family: monospace;
  }
  input[type="range"] {
    flex: 1;
  }
  .sample {
    font-size: 2rem;
    line-height: 1.4;
  }
</style>
```

---

## Phase 7: Testing

### Step 7.1: Vitest config at root

**`vitest.config.ts`** (repo root)
```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.test.ts'],
    environment: 'node',
  },
});
```

### Step 7.2: Unit tests for core

**`packages/core/src/__tests__/interpolator.test.ts`**

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Interpolator } from '../interpolator.js';

// Mock requestAnimationFrame for testing
beforeEach(() => {
  let id = 0;
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => {
    id++;
    setTimeout(() => fn(performance.now()), 0);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (_id: number) => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Interpolator', () => {
  it('should initialize with default values', () => {
    const interp = new Interpolator({
      axes: {
        wght: { tag: 'wght', min: 100, max: 900, default: 400 },
      },
    });
    expect(interp.getSnapshot()).toEqual({ wght: 400 });
    interp.destroy();
  });

  it('should clamp values to axis range', () => {
    const interp = new Interpolator({
      axes: {
        wght: { tag: 'wght', min: 100, max: 900, default: 400 },
      },
    });
    interp.set('wght', 9999);
    const axis = interp.getAxis('wght');
    expect(axis?.target).toBe(900);
    interp.destroy();
  });

  it('should call subscriber with initial state', () => {
    const interp = new Interpolator({
      axes: {
        wght: { tag: 'wght', min: 100, max: 900, default: 400 },
      },
    });
    const fn = vi.fn();
    interp.subscribe(fn);
    expect(fn).toHaveBeenCalledWith({ wght: 400 });
    interp.destroy();
  });

  it('should unsubscribe correctly', () => {
    const interp = new Interpolator({
      axes: {
        wght: { tag: 'wght', min: 100, max: 900, default: 400 },
      },
    });
    const fn = vi.fn();
    const unsub = interp.subscribe(fn);
    unsub();
    expect(interp['subscribers'].size).toBe(0);
    interp.destroy();
  });

  it('jumpTo should set current immediately', () => {
    const interp = new Interpolator({
      axes: {
        wght: { tag: 'wght', min: 100, max: 900, default: 400 },
      },
    });
    interp.jumpTo({ wght: 700 });
    expect(interp.getSnapshot()).toEqual({ wght: 700 });
    interp.destroy();
  });

  it('should list all axis tags', () => {
    const interp = new Interpolator({
      axes: {
        wght: { tag: 'wght', min: 100, max: 900, default: 400 },
        wdth: { tag: 'wdth', min: 75, max: 125, default: 100 },
      },
    });
    expect(interp.getAxes()).toEqual(['wght', 'wdth']);
    interp.destroy();
  });
});
```

**`packages/core/src/__tests__/easing.test.ts`**

```typescript
import { describe, it, expect } from 'vitest';
import { linear, easeInQuad, easeOutQuad, cubicBezier } from '../easing.js';

describe('Easing functions', () => {
  it('linear should return input', () => {
    expect(linear(0)).toBe(0);
    expect(linear(0.5)).toBe(0.5);
    expect(linear(1)).toBe(1);
  });

  it('easeInQuad should start slow', () => {
    expect(easeInQuad(0.5)).toBeLessThan(0.5);
  });

  it('easeOutQuad should end slow', () => {
    expect(easeOutQuad(0.5)).toBeGreaterThan(0.5);
  });

  it('cubicBezier should handle endpoints', () => {
    const ease = cubicBezier(0.25, 0.1, 0.25, 1.0);
    expect(ease(0)).toBe(0);
    expect(ease(1)).toBe(1);
  });

  it('cubicBezier ease-out should be ahead of linear at midpoint', () => {
    const easeOut = cubicBezier(0, 0, 0.58, 1);
    expect(easeOut(0.5)).toBeGreaterThan(0.5);
  });
});
```

### Step 7.3: Run tests

```bash
pnpm test
```

---

## Phase 8: Examples

### Step 8.1: Hero text example

**`examples/hero-text/index.html`** — standalone HTML file using `@vfir/vanilla`:

```html
<!DOCTYPE html>
<html>
<head>
  <link href="https://fonts.googleapis.com/css2?family=Recursive:slnt,wght,CASL,CRSV,MONO@-15..0,300..1000,0..1,0..1,0..1&display=swap" rel="stylesheet">
  <style>
    body { margin: 0; display: grid; place-items: center; min-height: 100vh; background: #111; color: #fff; }
    h1 { font-size: 6vw; font-family: 'Recursive'; transition: none; }
  </style>
</head>
<body>
  <h1 id="hero">Casey Haber</h1>
  <script type="module">
    import { vfir } from '@vfir/vanilla';

    const el = vfir({
      target: '#hero',
      fontFamily: 'Recursive',
      axes: {
        wght: { tag: 'wght', min: 300, max: 1000, default: 300 },
        CASL: { tag: 'CASL', min: 0, max: 1, default: 0 },
      },
      stiffness: 0.04,
    });

    document.addEventListener('mousemove', (e) => {
      const x = e.clientX / window.innerWidth;
      const y = e.clientY / window.innerHeight;
      el.set({ wght: 300 + x * 700, CASL: y });
    });
  </script>
</body>
</html>
```

---

## Phase 9: CI & Publishing Setup

### Step 9.1: GitHub Actions

**`.github/workflows/ci.yml`**
```yaml
name: CI
on: [push, pull_request]

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version-file: '.nvmrc'
          cache: 'pnpm'
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm typecheck
      - run: pnpm build
      - run: pnpm test

  wasm:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
        with:
          targets: wasm32-unknown-unknown
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version-file: '.nvmrc'
          cache: 'pnpm'
      - run: cargo install wasm-pack
      - run: pnpm install --frozen-lockfile
      - run: pnpm build:wasm
```

### Step 9.2: Changesets

```bash
pnpm add -Dw @changesets/cli
pnpm changeset init
```

---

## Execution Order (for Haiku)

Execute these phases strictly in order. Each phase depends on the prior one.

1. **Phase 1** — Monorepo scaffolding (Steps 1.1-1.3). After this, run `pnpm install` to confirm workspace resolves.
2. **Phase 2** — Core package (Steps 2.1-2.8). After this, run `pnpm --filter @vfir/core run build` to confirm it compiles.
3. **Phase 3** — WASM package (Steps 3.1-3.4). Only if Rust/wasm-pack is installed; otherwise skip and revisit later. After this, verify WASM builds.
4. **Phase 4** — Vanilla adapter (Steps 4.1-4.2). Build with `pnpm --filter @vfir/vanilla run build`.
5. **Phase 5** — Svelte adapter (Steps 5.1-5.5). Build with `pnpm --filter @vfir/svelte run build`.
6. **Phase 6** — Playground app (Steps 6.1-6.2). Run with `pnpm dev` to verify interactively.
7. **Phase 7** — Tests (Steps 7.1-7.3). Run with `pnpm test`.
8. **Phase 8** — Examples (Step 8.1). Verify hero-text works in playground dev server.
9. **Phase 9** — CI & Changesets (Steps 9.1-9.2). Push to GitHub and confirm Actions pass.

## Verification

After all phases:
- `pnpm build` succeeds with no errors
- `pnpm test` passes all tests
- `pnpm lint` reports no errors
- `pnpm dev` launches playground with interactive font axis sliders
- Moving sliders smoothly animates font-variation-settings on the text

## Key Files Summary

| File | Purpose |
|------|---------|
| `packages/core/src/types.ts` | All shared type definitions |
| `packages/core/src/interpolator.ts` | Central interpolation engine |
| `packages/core/src/metrics.ts` | Font measurement + LRU cache |
| `packages/core/src/renderer.ts` | Ties interpolator + metrics together |
| `packages/core/src/easing.ts` | Easing function library |
| `packages/core/src/wasm-bridge.ts` | Lazy WASM loader |
| `packages/wasm/src/lib.rs` | Rust WASM: layout + interpolation |
| `packages/vanilla/src/index.ts` | Plain DOM adapter |
| `packages/svelte/src/action.ts` | Svelte use:directive |
| `packages/svelte/src/variableFont.svelte.ts` | Svelte 5 runes wrapper |
| `packages/svelte/src/VariableText.svelte` | Svelte component |
| `apps/playground/src/App.svelte` | Interactive dev playground |
