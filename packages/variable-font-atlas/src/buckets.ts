import type { Axes, BucketKey } from './types.js';

/**
 * Bucket steps. Started at the plan's defaults
 * (wght 25, CASL 0.125, CRSV 0.25, MONO 0.25, slnt 1°). After Phase 1
 * profiling on the bloom we cut bucket combinations hard:
 *   - MONO collapses to a single bucket (`Infinity` step → always 0).
 *     The bloom barely changes intra-word feel from MONO animation,
 *     and removing it nets a 4× reduction in unique buckets per char.
 *   - CRSV widened to 0.5 (3 buckets) for similar reasons.
 *   - slnt widened to 2° (8 buckets vs 16) — sub-2° slnt diffs are
 *     well below visual threshold at 22 px.
 * The result: ~28 × 8 × 8 × 1 × 3 = ~5300 buckets per char vs ~14K, plus
 * MONO/CRSV both pushed off the cross-bucket blend candidate list so we
 * never blend along a coarse axis (would be visible).
 */
export const BUCKET_STEPS = {
	wght: 25,
	casl: 0.125,
	slnt: 2,
	mono: Number.POSITIVE_INFINITY,
	crsv: 0.5,
} as const;

const MONO_CANONICAL = 0;

function quantize(value: number, step: number): number {
	if (!Number.isFinite(step)) return 0;
	return Math.round(value / step) * step;
}

/** Snap each axis to the nearest bucket center. */
export function bucketize(axes: Axes): Axes {
	return {
		wght: quantize(axes.wght, BUCKET_STEPS.wght),
		casl: quantize(axes.casl, BUCKET_STEPS.casl),
		slnt: quantize(axes.slnt, BUCKET_STEPS.slnt),
		mono: MONO_CANONICAL,
		crsv: quantize(axes.crsv, BUCKET_STEPS.crsv),
	};
}

/** Stringly-typed key for Map lookup. Stable rounding for cache hits. */
export function bucketKey(axes: Axes): BucketKey {
	const b = bucketize(axes);
	// Fixed precision per axis avoids float-equality woes (e.g. 0.125 → 0.125 vs 0.1250000001).
	return `${b.wght.toFixed(0)}|${b.casl.toFixed(3)}|${b.slnt.toFixed(0)}|${b.mono.toFixed(2)}|${b.crsv.toFixed(2)}`;
}

/**
 * For cross-bucket blending: pick the axis with the largest fractional
 * residual relative to its step (i.e. the axis that's "in motion the most").
 * Snap the others to nearest, and return two bucket targets along the picked
 * axis (low and high) plus the [0,1] blend coefficient.
 */
export interface BlendBuckets {
	low: Axes;
	high: Axes;
	t: number;
	axis: keyof Axes;
}

// Only blend along axes whose bucket steps are tight enough that the bitmap
// dimensions across two adjacent buckets are visually compatible. MONO/CRSV
// collapse to coarse buckets (or one bucket) so blending along them would
// produce visible glyph-shape morphs, not a smooth lerp.
const BLEND_CANDIDATES: readonly (keyof Axes)[] = ['wght', 'casl', 'slnt'] as const;

export function pickBlendBuckets(axes: Axes): BlendBuckets {
	let pick: keyof Axes = 'wght';
	let pickResidual = -1;
	for (const k of BLEND_CANDIDATES) {
		const step = BUCKET_STEPS[k];
		if (!Number.isFinite(step)) continue;
		const frac = (axes[k] / step) % 1;
		const distFromBoundary = Math.abs(Math.abs(frac) - 0.5); // 0 ⇒ at halfway
		const residual = 0.5 - distFromBoundary; // bigger = closer to halfway
		if (residual > pickResidual) {
			pickResidual = residual;
			pick = k;
		}
	}
	const snapped = bucketize(axes);
	const low: Axes = { ...snapped };
	const high: Axes = { ...snapped };
	const step: number = BUCKET_STEPS[pick];
	const raw = axes[pick];
	const lowVal = Math.floor(raw / step) * step;
	const highVal = lowVal + step;
	low[pick] = lowVal;
	high[pick] = highVal;
	const t = step === 0 ? 0 : (raw - lowVal) / step;
	return { low, high, t: Math.max(0, Math.min(1, t)), axis: pick };
}
