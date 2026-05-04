import { MetricsProvider } from '@variable-font/core';
import type { ContentBlock, MeasuredBlock } from './types.js';

/** Font-size + weight per plan block type, with a small importance bump. */
function styleForBlock(block: ContentBlock): { fontSize: number; fontWeight: number } {
	const bump = Math.round(block.importance * 4);
	switch (block.type) {
		case 'phase':
			return { fontSize: 22 + bump, fontWeight: 700 };
		case 'task':
			return { fontSize: 15 + bump, fontWeight: 500 };
		case 'rationale':
			return { fontSize: 13, fontWeight: 400 };
		case 'risk':
			return { fontSize: 14 + bump, fontWeight: 500 };
		case 'open-question':
			return { fontSize: 14 + bump, fontWeight: 500 };
		case 'dependency':
			return { fontSize: 13, fontWeight: 500 };
		case 'success-criterion':
			return { fontSize: 14, fontWeight: 600 };
		case 'constraint':
			return { fontSize: 13, fontWeight: 600 };
		case 'reference':
			return { fontSize: 12, fontWeight: 400 };
		default:
			return { fontSize: 14, fontWeight: 400 };
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
		return blocks.map((b) => this.measureOne(b, this.options.maxBlockWidth));
	}

	measureOne(block: ContentBlock, maxWidth: number): MeasuredBlock {
		const { fontSize, fontWeight } = styleForBlock(block);
		const lineHeight = Math.round(fontSize * 1.35);
		const provider = new MetricsProvider({
			fontFamily: this.options.fontFamily,
			fontSize,
			lineHeight,
		});
		const layout = provider.layout(block.text, Math.max(60, maxWidth), { wght: fontWeight });
		const width = Math.max(60, Math.max(0, ...layout.lineWidths));
		const lineCount = Math.max(1, layout.lineWidths.length);
		const height = layout.totalHeight || lineHeight * lineCount;
		return {
			id: block.id,
			width,
			height,
			fontSize,
			fontWeight,
			lineHeight,
			lineCount,
		};
	}

	/**
	 * Measure a block, re-wrapping to roughly square aspect if the natural
	 * measurement is very wide. Used to produce circle-friendly shapes.
	 */
	measureSquareish(block: ContentBlock): MeasuredBlock {
		const first = this.measureOne(block, this.options.maxBlockWidth);
		if (first.width <= first.height * 1.4) return first;
		const area = first.width * first.height;
		const target = Math.ceil(Math.sqrt(area));
		return this.measureOne(block, target);
	}
}
