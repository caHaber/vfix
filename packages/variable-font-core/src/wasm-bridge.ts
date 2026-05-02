// biome-ignore lint/suspicious/noExplicitAny: dynamic WASM module type
type WasmModule = any;

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

let wasmModule: WasmModule | null = null;
let wasmLoading: Promise<WasmModule> | null = null;
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

function detectBackend(mod: WasmModule): WasmBackend {
	const m = mod as Record<string, unknown>;
	// wasm-pack `--target web` glue exposes these helpers; the JS stub does not.
	if (typeof m.__wbg_set_wasm === 'function' || typeof m.initSync === 'function') {
		return 'wasm';
	}
	return 'js-stub';
}

function readWasmMemoryBytes(mod: WasmModule): number | null {
	const m = mod as Record<string, unknown>;
	const memory = (m.memory ?? (m.__wasm as { memory?: WebAssembly.Memory } | undefined)?.memory) as
		| WebAssembly.Memory
		| undefined;
	if (memory && memory.buffer) return memory.buffer.byteLength;
	return null;
}

function now(): number {
	return typeof performance !== 'undefined' && typeof performance.now === 'function'
		? performance.now()
		: Date.now();
}

/** Lazy-load the WASM module. Safe to call multiple times — deduplicates. */
export async function loadWasm(): Promise<WasmModule> {
	if (wasmModule) return wasmModule;
	if (wasmLoading) return wasmLoading;

	diagnostics = { ...diagnostics, loading: true };
	wasmLoading = (async () => {
		const start = now();
		const mod = await import('@vfir/wasm');
		let initCalled = false;
		let initError: string | null = null;
		if ('default' in mod && typeof mod.default === 'function') {
			initCalled = true;
			try {
				await mod.default();
			} catch (err) {
				initError = err instanceof Error ? err.message : String(err);
			}
		}
		const end = now();
		wasmModule = mod;
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
		wasmLoading = null;
		throw err;
	});

	return wasmLoading;
}

/** Check if WASM is ready (non-blocking) */
export function isWasmReady(): boolean {
	return wasmModule !== null;
}

/** Get WASM module synchronously. Throws if not yet loaded. */
export function getWasm(): WasmModule {
	if (!wasmModule) throw new Error('WASM not loaded — call loadWasm() first');
	return wasmModule;
}

/** Snapshot of the current WASM diagnostics. Refreshes memory bytes on read. */
export function getWasmDiagnostics(): WasmDiagnostics {
	if (wasmModule) {
		const bytes = readWasmMemoryBytes(wasmModule);
		if (bytes !== null) diagnostics = { ...diagnostics, wasmMemoryBytes: bytes };
	}
	return diagnostics;
}
