// Lazy bridge to @vfir/wasm-stats. The wasm-pack pkg/ exports an `init()` default
// that takes a URL or fetch promise; consumers may also alias to a JS stub at build
// time (the playground does this) — both shapes are supported.

type WasmStats = {
	default?: (input?: unknown) => Promise<unknown>;
	summary: (column: Float64Array) => unknown;
	histogram: (column: Float64Array, binCount: number) => unknown;
	linear_regression: (x: Float64Array, y: Float64Array) => unknown;
	polynomial_regression: (x: Float64Array, y: Float64Array, degree: number) => unknown;
	outliers_zscore: (column: Float64Array, threshold: number) => Uint32Array;
	outliers_iqr: (column: Float64Array, factor: number) => Uint32Array;
	detect_trend: (values: Float64Array) => unknown;
	detect_seasonality: (values: Float64Array, maxPeriod: number) => unknown;
	change_points: (values: Float64Array, minConfidence: number) => unknown;
	correlation_pearson: (a: Float64Array, b: Float64Array) => number;
	correlation_matrix: (columns: number[][]) => unknown;
	kmeans: (data: number[][], k: number, maxIter: number) => unknown;
	group_by_sum: (groupKeys: Uint32Array, values: Float64Array, groupCount: number) => Float64Array;
	group_by_mean: (groupKeys: Uint32Array, values: Float64Array, groupCount: number) => Float64Array;
	group_by_count: (groupKeys: Uint32Array, groupCount: number) => Uint32Array;
	tokenize: (input: string) => string[];
	term_frequency: (docs: string[], topN: number) => unknown;
	tf_idf: (docs: string[], topN: number) => unknown;
	rake_keywords: (docs: string[], topN: number) => unknown;
	sentiment_score: (input: string) => number;
	sentiment_batch: (docs: string[]) => Float64Array;
	sentiment_summary: (scores: Float64Array, binCount: number) => unknown;
};

let cached: WasmStats | null = null;
let pending: Promise<WasmStats> | null = null;

export async function loadWasmStats(loader: () => Promise<WasmStats>): Promise<WasmStats> {
	if (cached) return cached;
	if (!pending) {
		pending = (async () => {
			const mod = await loader();
			if (typeof mod.default === 'function') {
				try {
					await mod.default();
				} catch {
					// stubs may not need init
				}
			}
			cached = mod;
			return mod;
		})();
	}
	return pending;
}

export function isLoaded(): boolean {
	return cached !== null;
}

export function getCached(): WasmStats | null {
	return cached;
}
