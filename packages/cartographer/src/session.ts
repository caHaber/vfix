import { loadWasm } from '@variable-font/core';
import { Annotator } from './annotator.js';
import type { AnnotationEvent, AnnotatorOptions } from './annotator.js';
import { detectMode } from './mode-detector.js';
import { Measurer } from './measurer.js';
import { LayoutEngine } from './layout-engine.js';
import { StreamingLayout } from './streaming-layout.js';
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
		return this.layoutStructure(structure, opts);
	}

	/** Re-layout a (possibly edited) structure without re-calling the annotator. */
	layoutStructure(structure: ResponseStructure, opts: MapOptions): Promise<LayoutResult> {
		const mode = opts.mode ?? detectMode(structure);
		const measured = this.measurer.measure(structure.blocks);
		return this.engine.compute({
			structure,
			measured,
			mode,
			bounds: { width: opts.width, height: opts.height },
		});
	}

	/**
	 * Stream annotation events directly from the model. Resolves when the stream
	 * completes. The caller feeds each event into a StreamingLayout (or anywhere).
	 */
	streamAnnotate(
		responseText: string,
		onEvent: (ev: AnnotationEvent) => void,
		signal?: AbortSignal,
	): Promise<void> {
		return this.annotator.stream(responseText, onEvent, signal);
	}

	/**
	 * Build a StreamingLayout backed by the session's measurer. Wasm is
	 * guaranteed loaded (or its vite-aliased stub) by the time this resolves,
	 * so `step()` is safe to call immediately after.
	 */
	async createStreamingLayout(opts: { width: number; height: number }): Promise<StreamingLayout> {
		try {
			await loadWasm();
		} catch {
			// fallback to stub handled via vite alias
		}
		return new StreamingLayout({
			measurer: this.measurer,
			bounds: { width: opts.width, height: opts.height },
		});
	}

	getLastStructure(): ResponseStructure | null {
		return this.lastStructure;
	}
}
