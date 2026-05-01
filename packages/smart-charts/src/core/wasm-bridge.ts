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

export type WasmBackend = 'wasm' | 'js-stub' | 'unknown';

export interface WasmDiagnostics {
	loaded: boolean;
	loading: boolean;
	backend: WasmBackend;
	initCalled: boolean;
	initDurationMs: number | null;
	initError: string | null;
	exportCount: number;
	exportNames: string[];
	wasmMemoryBytes: number | null;
	loadedAt: number | null;
}

let cached: WasmStats | null = null;
let pending: Promise<WasmStats> | null = null;
let diagnostics: WasmDiagnostics = {
	loaded: false,
	loading: false,
	backend: 'unknown',
	initCalled: false,
	initDurationMs: null,
	initError: null,
	exportCount: 0,
	exportNames: [],
	wasmMemoryBytes: null,
	loadedAt: null,
};

function detectBackend(mod: WasmStats): WasmBackend {
	const m = mod as Record<string, unknown>;
	// wasm-pack's `web` target glue exposes these helpers; the JS stub does not.
	if (typeof m.__wbg_set_wasm === 'function' || typeof m.initSync === 'function') {
		return 'wasm';
	}
	return 'js-stub';
}

function readWasmMemoryBytes(mod: WasmStats): number | null {
	const m = mod as Record<string, unknown>;
	const memory = (m.memory ?? (m.__wasm as { memory?: WebAssembly.Memory } | undefined)?.memory) as
		| WebAssembly.Memory
		| undefined;
	if (memory && memory.buffer) return memory.buffer.byteLength;
	return null;
}

export async function loadWasmStats(loader: () => Promise<WasmStats>): Promise<WasmStats> {
	if (cached) return cached;
	if (!pending) {
		diagnostics = { ...diagnostics, loading: true };
		pending = (async () => {
			const start =
				typeof performance !== 'undefined' && typeof performance.now === 'function'
					? performance.now()
					: Date.now();
			const mod = await loader();
			let initCalled = false;
			let initError: string | null = null;
			if (typeof mod.default === 'function') {
				initCalled = true;
				try {
					await mod.default();
				} catch (err) {
					// stubs may not need init; for real wasm an error here is meaningful
					initError = err instanceof Error ? err.message : String(err);
				}
			}
			const end =
				typeof performance !== 'undefined' && typeof performance.now === 'function'
					? performance.now()
					: Date.now();
			cached = mod;
			const exportNames = Object.keys(mod as object).sort();
			diagnostics = {
				loaded: true,
				loading: false,
				backend: detectBackend(mod),
				initCalled,
				initDurationMs: Math.round((end - start) * 100) / 100,
				initError,
				exportCount: exportNames.length,
				exportNames,
				wasmMemoryBytes: readWasmMemoryBytes(mod),
				loadedAt: Date.now(),
			};
			return mod;
		})().catch((err) => {
			diagnostics = {
				...diagnostics,
				loading: false,
				initError: err instanceof Error ? err.message : String(err),
			};
			pending = null;
			throw err;
		});
	}
	return pending;
}

export function isLoaded(): boolean {
	return cached !== null;
}

export function getCached(): WasmStats | null {
	return cached;
}

export function getDiagnostics(): WasmDiagnostics {
	// Refresh memory size on read in case it grew after init.
	if (cached) {
		const bytes = readWasmMemoryBytes(cached);
		if (bytes !== null) diagnostics = { ...diagnostics, wasmMemoryBytes: bytes };
	}
	return diagnostics;
}
