import { type GlyphAtlas, pickBlendBuckets } from '@variable-font/atlas';
import { FLOATS_PER_INSTANCE } from '@variable-font/atlas-webgl';
import type { LayoutWord } from '@variable-font/core';

/**
 * One glyph within a word, after layout-time intra-word positioning.
 * `penX` is relative to `word.x` (the line-relative word origin).
 */
export interface PositionedGlyph {
	codepoint: number;
	penX: number;
}

export interface GlyphLayout {
	/** Per-word arrays of positioned glyphs (CSS px). */
	words: PositionedGlyph[][];
	/** Baseline offset (CSS px) from each line's top. */
	baselineFromLineTop: number;
}

// biome-ignore lint/suspicious/noExplicitAny: dynamic WASM module type
type WasmModule = any;

const NEUTRAL_AXES = { wght: 400, casl: 0, slnt: 0, mono: 0, crsv: 0 };

/**
 * Build per-word, per-glyph layout using the WASM rasterizer's advance values
 * at neutral axes. Pen positions are stable across animation frames — we vary
 * the *bitmap* per frame, not the layout. This matches the plan's decision to
 * keep Pretext as the layout authority and only the intra-word glyph
 * positioning is new (still done at neutral so it doesn't flicker).
 */
export function buildGlyphLayout(
	words: LayoutWord[],
	wasm: WasmModule,
	sizePx: number,
): GlyphLayout {
	const out: PositionedGlyph[][] = new Array(words.length);

	for (let wi = 0; wi < words.length; wi++) {
		const word = words[wi];
		const glyphs: PositionedGlyph[] = [];
		let pen = 0;
		// Iterate code points (handles surrogate pairs natively via for…of).
		for (const ch of word.text) {
			const cp = ch.codePointAt(0) ?? 0;
			glyphs.push({ codepoint: cp, penX: pen });
			pen += wasm.glyph_advance(
				wasm.glyph_id_for_codepoint(cp) >>> 0,
				NEUTRAL_AXES.wght,
				NEUTRAL_AXES.casl,
				NEUTRAL_AXES.slnt,
				NEUTRAL_AXES.mono,
				NEUTRAL_AXES.crsv,
				sizePx,
			);
		}
		out[wi] = glyphs;
	}

	const fm: Float32Array | number[] = wasm.font_metrics(
		NEUTRAL_AXES.wght,
		NEUTRAL_AXES.casl,
		NEUTRAL_AXES.slnt,
		NEUTRAL_AXES.mono,
		NEUTRAL_AXES.crsv,
	);
	const ascent = fm[0];
	const upem = fm[3] || 1000;
	const baselineFromLineTop = (ascent / upem) * sizePx;

	return { words: out, baselineFromLineTop };
}

export interface PackOptions {
	words: LayoutWord[];
	layout: GlyphLayout;
	axesFlat: Float32Array;
	axesPerWord: number;
	atlas: GlyphAtlas;
	instanceCpu: Float32Array;
	color: [number, number, number, number];
	/** Visible CSS-y range. Lines outside are skipped. */
	cullTop: number;
	cullBottom: number;
	lineHeight: number;
	dpr: number;
}

/**
 * Pack visible-glyph instance attributes into the renderer's CPU buffer.
 * Returns the number of instances written. Mirrors the FLOATS_PER_INSTANCE
 * layout in @variable-font/atlas-webgl/types.ts.
 *
 * For Phase 1 we drive `aUvHi == aUvLo` and `aBlendT = 0`, so the shader
 * effectively does a single-bucket sample. Phase 4 swaps in the cross-bucket
 * pair from `pickBlendBuckets`.
 */
export function packInstances(opts: PackOptions): number {
	const {
		words,
		layout,
		axesFlat,
		axesPerWord,
		atlas,
		instanceCpu,
		color,
		cullTop,
		cullBottom,
		lineHeight,
		dpr,
	} = opts;
	const textureSize = atlas.textureSize;
	const baselineOffset = layout.baselineFromLineTop;
	const invDpr = 1 / dpr;

	let cursor = 0;
	for (let wi = 0; wi < words.length; wi++) {
		const word = words[wi];
		if (word.y + lineHeight < cullTop || word.y > cullBottom) continue;
		const base = wi * axesPerWord;
		const axes = {
			wght: axesFlat[base + 0],
			casl: axesFlat[base + 1],
			slnt: axesFlat[base + 2],
			mono: axesFlat[base + 3],
			crsv: axesFlat[base + 4],
		};
		const baselineY = word.y + baselineOffset;
		const glyphs = layout.words[wi];

		// Pick the dominant moving axis once per word — picks a single
		// (lowBucket, highBucket) pair shared across this word's glyphs so the
		// blend stays consistent letter-to-letter.
		const blend = pickBlendBuckets(axes);

		for (let gi = 0; gi < glyphs.length; gi++) {
			const g = glyphs[gi];
			const entryLo = atlas.getEntry(g.codepoint, blend.low);
			if (!entryLo || entryLo.empty) continue;
			// High bucket: use cache-only lookup so blending only activates
			// once both buckets have warmed naturally. Forcing a second
			// rasterize per glyph doubles miss pressure during the bloom and
			// triggers the per-frame budget too aggressively.
			const entryHi = atlas.tryGetEntry(g.codepoint, blend.high);
			const useHi = entryHi !== null && !entryHi.empty;

			// Atlas pixel space → CSS px (use entryLo as ground truth).
			const cssW = entryLo.width * invDpr;
			const cssH = entryLo.height * invDpr;
			const cssBx = entryLo.bearingX * invDpr;
			const cssBy = entryLo.bearingY * invDpr;
			const x = word.x + g.penX + cssBx;
			const y = baselineY - cssBy;

			const uLo = entryLo.atlasX / textureSize;
			const vLo = entryLo.atlasY / textureSize;
			const uwLo = entryLo.width / textureSize;
			const vhLo = entryLo.height / textureSize;

			const uHi = useHi && entryHi ? entryHi.atlasX / textureSize : uLo;
			const vHi = useHi && entryHi ? entryHi.atlasY / textureSize : vLo;
			const uwHi = useHi && entryHi ? entryHi.width / textureSize : uwLo;
			const vhHi = useHi && entryHi ? entryHi.height / textureSize : vhLo;
			const blendT = useHi ? blend.t : 0;

			const off = cursor * FLOATS_PER_INSTANCE;
			// posSize
			instanceCpu[off + 0] = x;
			instanceCpu[off + 1] = y;
			instanceCpu[off + 2] = cssW;
			instanceCpu[off + 3] = cssH;
			// uvLo
			instanceCpu[off + 4] = uLo;
			instanceCpu[off + 5] = vLo;
			instanceCpu[off + 6] = uwLo;
			instanceCpu[off + 7] = vhLo;
			// uvHi
			instanceCpu[off + 8] = uHi;
			instanceCpu[off + 9] = vHi;
			instanceCpu[off + 10] = uwHi;
			instanceCpu[off + 11] = vhHi;
			// blendT
			instanceCpu[off + 12] = blendT;
			// color — per-word alpha ramp: weight controls alpha so the bloom
			// feels like the existing DOM version (KineticText opacity formula).
			instanceCpu[off + 13] = color[0];
			instanceCpu[off + 14] = color[1];
			instanceCpu[off + 15] = color[2];
			const wghtNorm = (axes.wght - 300) / 700;
			instanceCpu[off + 16] = color[3] * (0.18 + Math.max(0, Math.min(1, wghtNorm)) * 0.82);
			cursor++;
		}
	}
	return cursor;
}

export function totalGlyphCount(layout: GlyphLayout): number {
	let n = 0;
	for (const w of layout.words) n += w.length;
	return n;
}
