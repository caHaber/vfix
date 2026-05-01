import { Interpolator } from './interpolator.js';
import { MetricsProvider } from './metrics.js';
import { isWasmReady, getWasm } from './wasm-bridge.js';
import type { AxisSnapshot, InterpolatorOptions, LayoutResult, Unsubscribe } from './types.js';

export interface TextBlock {
	/** Unique id for this block */
	id: string;
	/** The text content */
	text: string;
	/** Available width for line-breaking (px) */
	maxWidth: number;
}

export interface RenderState {
	/** Current axis values */
	axes: AxisSnapshot;
	/** Laid-out text blocks (word positions, line breaks via Pretext) */
	layouts: Map<string, LayoutResult>;
}

export type RenderCallback = (state: RenderState) => void;

export interface RendererOptions extends InterpolatorOptions {
	/** Font family name (must match a loaded variable font) */
	fontFamily: string;
	/** Font size in px */
	fontSize?: number;
	/** Line height in px */
	lineHeight?: number;
}

/**
 * The main engine. Coordinates:
 * - Interpolator: spring-based axis animation (uses WASM when available)
 * - MetricsProvider: Pretext-backed measurement and layout
 * - Render loop: dirty-checking, batched updates to subscribers
 */
export class Renderer {
	readonly interpolator: Interpolator;
	readonly metrics: MetricsProvider;
	private blocks: Map<string, TextBlock> = new Map();
	private renderCallbacks: Set<RenderCallback> = new Set();
	private unsubInterpolator: Unsubscribe;
	readonly fontFamily: string;
	readonly fontSize: number;
	readonly lineHeight: number;

	constructor(options: RendererOptions) {
		this.fontFamily = options.fontFamily;
		this.fontSize = options.fontSize ?? 32;
		this.lineHeight = options.lineHeight ?? Math.round(this.fontSize * 1.4);

		this.interpolator = new Interpolator(options);
		this.metrics = new MetricsProvider({
			fontFamily: options.fontFamily,
			fontSize: this.fontSize,
			lineHeight: this.lineHeight,
		});

		this.unsubInterpolator = this.interpolator.subscribe((axes) => {
			this.onAxesChanged(axes);
		});
	}

	/** Register a text block. Pretext will handle its line-breaking. */
	addBlock(block: TextBlock): void {
		this.blocks.set(block.id, block);
	}

	/** Remove a text block */
	removeBlock(id: string): void {
		this.blocks.delete(id);
	}

	/** Update a block's maxWidth (e.g. on resize). Triggers re-layout. */
	updateBlockWidth(id: string, maxWidth: number): void {
		const block = this.blocks.get(id);
		if (!block) return;
		block.maxWidth = maxWidth;
		// Re-layout with current axes
		this.onAxesChanged(this.interpolator.getSnapshot());
	}

	/** Subscribe to render state updates */
	onRender(fn: RenderCallback): Unsubscribe {
		this.renderCallbacks.add(fn);
		return () => this.renderCallbacks.delete(fn);
	}

	/** Force a re-layout of all blocks at current axes */
	forceLayout(): void {
		this.onAxesChanged(this.interpolator.getSnapshot());
	}

	/** Clean up everything */
	destroy(): void {
		this.unsubInterpolator();
		this.interpolator.destroy();
		this.renderCallbacks.clear();
		this.blocks.clear();
	}

	private onAxesChanged(axes: AxisSnapshot): void {
		const layouts = new Map<string, LayoutResult>();

		for (const [id, block] of this.blocks) {
			// Use Pretext (via MetricsProvider) for layout
			const result = this.metrics.layout(block.text, block.maxWidth, axes);

			// If WASM is loaded, use it for any additional layout computation
			if (isWasmReady()) {
				const wasm = getWasm();
				// WASM compute_layout can refine line-breaks with glyph-level precision
				// For now, Pretext handles the primary layout; WASM is available for
				// advanced features (collision detection, axis-space pathfinding)
				void wasm;
			}

			layouts.set(id, result);
		}

		const state: RenderState = { axes, layouts };
		for (const fn of this.renderCallbacks) {
			fn(state);
		}
	}
}
