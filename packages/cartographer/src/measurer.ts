import { MetricsProvider } from '@vfir/core';
import type { ContentBlock, MeasuredBlock } from './types.js';

/** Font-size mapping per block type, scaled by importance */
function styleForBlock(block: ContentBlock): { fontSize: number; fontWeight: number } {
	switch (block.type) {
		case 'recommendation':
			return { fontSize: Math.round(28 + block.importance * 8), fontWeight: 700 };
		case 'alternative':
			return { fontSize: Math.round(20 + block.importance * 4), fontWeight: 600 };
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
