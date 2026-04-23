import { Annotator } from './annotator.js';
import type { AnnotatorOptions } from './annotator.js';
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
