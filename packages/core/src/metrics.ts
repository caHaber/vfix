import { prepareWithSegments, layoutWithLines } from '@chenglou/pretext';
import type { AxisSnapshot, LayoutResult, LayoutWord } from './types.js';

export interface MetricsProviderOptions {
	fontFamily: string;
	fontSize: number;
	lineHeight: number;
}

/**
 * Wraps Pretext for text measurement and layout.
 *
 * Uses `prepareWithSegments` for the one-time measurement pass,
 * then `layoutWithLines` for the cheap arithmetic layout.
 * Caches the prepared state so re-layout on resize is fast.
 */
export class MetricsProvider {
	private fontFamily: string;
	private fontSize: number;
	private lineHeight: number;

	/** Canvas for per-word width measurement (used to compute x offsets within lines) */
	private canvas: OffscreenCanvas | HTMLCanvasElement;
	private ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

	constructor(options: MetricsProviderOptions) {
		this.fontFamily = options.fontFamily;
		this.fontSize = options.fontSize;
		this.lineHeight = options.lineHeight;

		if (typeof OffscreenCanvas !== 'undefined') {
			this.canvas = new OffscreenCanvas(1, 1);
			this.ctx = this.canvas.getContext('2d') as OffscreenCanvasRenderingContext2D;
		} else {
			this.canvas = document.createElement('canvas');
			this.ctx = this.canvas.getContext('2d') as CanvasRenderingContext2D;
		}
	}

	/** Build a CSS font string for Pretext and canvas measurement */
	buildFontString(axes?: AxisSnapshot): string {
		// Pretext uses the same format as canvas ctx.font
		// Weight can be embedded in the font shorthand
		const weight = axes?.wght ?? 400;
		const slant = axes?.slnt;
		const style = slant && slant < 0 ? `oblique ${slant}deg ` : '';
		return `${style}${weight} ${this.fontSize}px ${this.fontFamily}`;
	}

	/**
	 * Lay out text into positioned words using Pretext.
	 *
	 * 1. `prepareWithSegments` does the one-time measurement pass
	 * 2. `layoutWithLines` computes line breaks (pure arithmetic)
	 * 3. Per-word x-offsets computed via canvas measureText
	 */
	layout(text: string, maxWidth: number, axes?: AxisSnapshot): LayoutResult {
		const fontString = this.buildFontString(axes);
		const prepared = prepareWithSegments(text, fontString);
		const result = layoutWithLines(prepared, maxWidth, this.lineHeight);

		// Set canvas font to match for per-word measurement
		this.ctx.font = fontString;

		const words: LayoutWord[] = [];
		const lineWidths: number[] = [];

		for (let li = 0; li < result.lines.length; li++) {
			const line = result.lines[li];
			lineWidths.push(line.width);
			const tokens = line.text.split(/(\s+)/);
			let x = 0;
			const y = li * this.lineHeight;

			for (const token of tokens) {
				if (!token) continue;
				const tokenWidth = this.ctx.measureText(token).width;
				if (/^\s+$/.test(token)) {
					x += tokenWidth;
					continue;
				}
				words.push({ text: token, x, y, width: tokenWidth, lineIndex: li });
				x += tokenWidth;
			}
		}

		return {
			words,
			lineCount: result.lineCount,
			totalHeight: result.lineCount * this.lineHeight,
			lineWidths,
		};
	}

	/**
	 * Re-layout with a new width but same prepared text.
	 * Cheaper than a full layout() since Pretext caches internally.
	 */
	relayout(text: string, maxWidth: number, axes?: AxisSnapshot): LayoutResult {
		return this.layout(text, maxWidth, axes);
	}
}
