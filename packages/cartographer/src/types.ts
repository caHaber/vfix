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

/** What the annotator returns */
export interface ResponseStructure {
	blocks: ContentBlock[];
	relationships: BlockRelationship[];
	decision?: DecisionSummary;
}

/** One block after measurement */
export interface MeasuredBlock {
	id: string;
	/** Rendered width in px at the chosen font size */
	width: number;
	/** Rendered height in px */
	height: number;
	/** Font size this block will render at */
	fontSize: number;
	/** Font weight 300–900 */
	fontWeight: number;
}

/** Positioned block ready for rendering */
export interface PositionedBlock extends MeasuredBlock {
	x: number;
	y: number;
	opacity: number;
	text: string;
	type: BlockType;
}

/** Final layout output */
export interface LayoutResult {
	positions: PositionedBlock[];
	bounds: { width: number; height: number };
	mode: LayoutMode;
}

/** What the playground passes in */
export interface MapOptions {
	width: number;
	height: number;
	/** Force a specific mode; otherwise ModeDetector picks */
	mode?: LayoutMode;
}
