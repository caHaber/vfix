import { layoutWithLines, prepareWithSegments } from '@chenglou/pretext';
import type { AxisSnapshot, LayoutResult, LayoutWord } from './types.js';

export interface MetricsProviderOptions {
	fontFamily: string;
	fontSize: number;
	lineHeight: number;
}

/**
 * Wraps Pretext for text measurement and layout.
 *
 * Pretext does the heavy lifting (segmentation, BiDi, line-breaking) under
 * `prepareWithSegments` + `layoutWithLines`. Per-word x offsets within each
 * line are still measured via canvas measureText — Pretext exposes per-segment
 * widths internally but its segment cursors don't always align cleanly with
 * "words" once whitespace and end-of-line breaks are involved, so a focused
 * canvas pass per line is the simpler and reliably-correct approach.
 *
 * The frame-rate win comes from the Renderer cache: most animated frames
 * reuse the previous layout because slnt and the per-word axes (CASL/CRSV/MONO)
 * don't appear in the canvas font shorthand at all.
 */
export class MetricsProvider {
	private fontFamily: string;
	private fontSize: number;
	private lineHeight: number;

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

	/**
	 * Build a CSS font string for Pretext's canvas measurement.
	 *
	 * We deliberately omit slnt: it doesn't change advance widths in a way that
	 * matters here, and including it at full float precision would make every
	 * animated frame produce a fresh entry in Pretext's internal prepared-text
	 * cache. CASL/CRSV/MONO aren't part of canvas font shorthand at all and so
	 * never affect Pretext layout.
	 */
	buildFontString(axes?: AxisSnapshot): string {
		const weight = axes?.wght ?? 400;
		return `${weight} ${this.fontSize}px ${this.fontFamily}`;
	}

	layout(text: string, maxWidth: number, axes?: AxisSnapshot): LayoutResult {
		const fontString = this.buildFontString(axes);
		const prepared = prepareWithSegments(text, fontString);
		const result = layoutWithLines(prepared, maxWidth, this.lineHeight);

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

	relayout(text: string, maxWidth: number, axes?: AxisSnapshot): LayoutResult {
		return this.layout(text, maxWidth, axes);
	}
}
