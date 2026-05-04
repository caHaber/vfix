/** Content block classification — plan-refinement ontology. */
export type BlockType =
	| 'phase'
	| 'task'
	| 'rationale'
	| 'risk'
	| 'open-question'
	| 'dependency'
	| 'success-criterion'
	| 'constraint'
	| 'reference';

/** A single content block in a plan. */
export interface ContentBlock {
	id: string;
	text: string;
	type: BlockType;
	/** 0–1; higher = larger/leads its phase. */
	importance: number;
	/** Optional grouping id — blocks sharing a groupId belong to one phase. */
	groupId?: string;
	/** User-facing scale multiplier (default 1). */
	scale?: number;
	/** Pinned blocks have their position frozen by the layout sim. */
	pinned?: boolean;
	/** Provenance — annotated by the original pass, refined by Refiner, or manual. */
	source?: 'annotated' | 'refined' | 'manual';
	/** Block IDs that produced this block (for cross-plan refinement traces). */
	refinedFrom?: string[];
}

/** A named phase that clusters blocks. */
export interface Group {
	id: string;
	label: string;
	summary?: string;
	/** Optional aggregate importance; defaults to max child importance. */
	importance?: number;
	/** Cached child positions (group-local coords) restored when re-drilling. */
	childPositions?: Record<string, { x: number; y: number }>;
	/** Overview render flag — when true, drilling is disabled. */
	collapsed?: boolean;
}

/** One block after measurement */
export interface MeasuredBlock {
	id: string;
	/** Widest line width in px (pretext measureLineStats.maxLineWidth) */
	width: number;
	/** Total box height = lineCount × lineHeight */
	height: number;
	/** Font size this block will render at */
	fontSize: number;
	/** Font weight 300–900 */
	fontWeight: number;
	/** Per-line advance height used by pretext */
	lineHeight: number;
	/** Number of lines after wrapping */
	lineCount: number;
}

