/** Configuration for a single font axis */
export interface AxisConfig {
	/** OpenType axis tag, e.g. 'wght', 'wdth', 'slnt', or custom */
	tag: string;
	/** Minimum allowed value */
	min: number;
	/** Maximum allowed value */
	max: number;
	/** Default/initial value */
	default: number;
}

/** Runtime state of a single axis */
export interface AxisState {
	tag: string;
	min: number;
	max: number;
	default: number;
	/** Current interpolated value */
	current: number;
	/** Target value (drives animation) */
	target: number;
	/** Easing function for this axis */
	easing: EasingFn;
}

/** A snapshot of all axis values at a point in time */
export type AxisSnapshot = Record<string, number>;

/** Easing function signature: takes progress 0-1, returns eased 0-1 */
export type EasingFn = (t: number) => number;

/** Unsubscribe function returned by subscribe() */
export type Unsubscribe = () => void;

/** Options for creating an Interpolator */
export interface InterpolatorOptions {
	/** Map of axis tag to config */
	axes: Record<string, AxisConfig>;
	/** Default easing for all axes (can be overridden per-axis) */
	easing?: EasingFn;
	/** Interpolation speed factor (0-1, where 1 = instant) */
	stiffness?: number;
	/** Threshold below which interpolation snaps to target */
	epsilon?: number;
}

/** A positioned word in a laid-out text block */
export interface LayoutWord {
	/** The word text */
	text: string;
	/** X position within the block */
	x: number;
	/** Y position within the block */
	y: number;
	/** Measured width of this word at current axes */
	width: number;
	/** Line index this word belongs to */
	lineIndex: number;
}

/** Result from the layout engine */
export interface LayoutResult {
	/** All positioned words */
	words: LayoutWord[];
	/** Number of lines */
	lineCount: number;
	/** Total block height */
	totalHeight: number;
	/** Per-line widths */
	lineWidths: number[];
}

/** Subscriber callback */
export type SubscriberFn = (snapshot: AxisSnapshot) => void;
