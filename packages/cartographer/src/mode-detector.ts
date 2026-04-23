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
