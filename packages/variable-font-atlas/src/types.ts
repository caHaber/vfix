/**
 * Five-axis tuple matching the rest of vfir. Order is fixed: same indices as
 * the BatchedInterpolator output and the WASM rasterizer signature.
 */
export interface Axes {
	wght: number;
	casl: number;
	slnt: number;
	mono: number;
	crsv: number;
}

export const AXIS_COUNT = 5;
export const AXIS_INDEX = {
	wght: 0,
	casl: 1,
	slnt: 2,
	mono: 3,
	crsv: 4,
} as const;

/** Quantized bucket key — string form, used as Map key. */
export type BucketKey = string;

export interface AtlasEntry {
	/** Position in the atlas texture, in atlas pixels. */
	atlasX: number;
	atlasY: number;
	width: number;
	height: number;
	/** Distance from pen origin to the bitmap's left edge. May be negative. */
	bearingX: number;
	/** Distance from baseline up to the bitmap's top edge. */
	bearingY: number;
	advance: number;
	/** True if this bucket has empty pixels (whitespace). Skip GPU draw. */
	empty: boolean;
	bucketKey: BucketKey;
	codepoint: number;
	lastUsedFrame: number;
}

export interface RasterizerResult {
	width: number;
	height: number;
	bearingX: number;
	bearingY: number;
	advance: number;
	pixels: Uint8Array;
}

export type RasterizeFn = (
	codepoint: number,
	axes: Axes,
	sizePx: number,
) => RasterizerResult | null;
