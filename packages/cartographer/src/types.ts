/** Content block classification */
export type BlockType =
	| 'recommendation'
	| 'alternative'
	| 'code'
	| 'explanation'
	| 'caveat'
	| 'pro'
	| 'con'
	| 'step'
	| 'context'
	| 'question';

/** Layout modes supported in v1 */
export type LayoutMode = 'decision' | 'exploration';

/** A single content block extracted from an LLM response */
export interface ContentBlock {
	id: string;
	text: string;
	type: BlockType;
	/** 0–1; higher means bigger/more central */
	importance: number;
	/** Language tag for code blocks, e.g. 'typescript', 'python' */
	language?: string;
	/** Optional grouping id — blocks sharing a groupId cluster */
	groupId?: string;
}

/** Semantic relationship between two blocks */
export interface BlockRelationship {
	from: string;
	to: string;
	type: 'qualifies' | 'supports' | 'contradicts' | 'implements' | 'alternative_to';
}

/** Optional summary for decision-mode responses */
export interface DecisionSummary {
	question: string;
	recommendation: string;
	confidence: 'strong' | 'moderate' | 'weak';
	conditions: string[];
}

/** A named cluster of blocks that share a groupId */
export interface Group {
	id: string;
	label: string;
	summary?: string;
}

/** What the annotator returns */
export interface ResponseStructure {
	blocks: ContentBlock[];
	relationships: BlockRelationship[];
	decision?: DecisionSummary;
	groups?: Group[];
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

/** Positioned block ready for rendering */
export interface PositionedBlock extends MeasuredBlock {
	/** Top-left x of the circle bounding box */
	x: number;
	/** Top-left y of the circle bounding box */
	y: number;
	/** Diameter of the rendered circle (streaming/circle layouts only) */
	diameter?: number;
	opacity: number;
	text: string;
	type: BlockType;
	groupId?: string;
}

/** Final layout output */
export interface LayoutResult {
	positions: PositionedBlock[];
	bounds: { width: number; height: number };
	mode: LayoutMode;
	groups?: Group[];
}

/** What the playground passes in */
export interface MapOptions {
	width: number;
	height: number;
	/** Force a specific mode; otherwise ModeDetector picks */
	mode?: LayoutMode;
}
