/**
 * One drawable glyph instance. The renderer copies these into a packed
 * Float32Array each frame, so allocation cost is one Float32Array.set() per
 * frame regardless of glyph count.
 */
export interface GlyphInstance {
	/** Pen origin x in CSS px relative to the canvas origin. */
	x: number;
	y: number;
	/** Glyph bitmap dimensions in CSS px. */
	width: number;
	height: number;
	/** Atlas UVs for the low bucket (normalized 0..1). */
	uLo: number;
	vLo: number;
	uwLo: number;
	vhLo: number;
	/** Atlas UVs for the high bucket (normalized 0..1). */
	uHi: number;
	vHi: number;
	uwHi: number;
	vhHi: number;
	/** [0,1] cross-bucket blend coefficient. */
	blendT: number;
	/** sRGB color (0..1) and alpha. */
	r: number;
	g: number;
	b: number;
	a: number;
}

/** Floats per instance — must match the vertex attribute layout below. */
export const FLOATS_PER_INSTANCE = 4 + 4 + 4 + 1 + 4; // posSize + uvLo + uvHi + blendT + color = 17
