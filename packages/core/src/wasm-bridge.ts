// biome-ignore lint/suspicious/noExplicitAny: dynamic WASM module type
type WasmModule = any;

let wasmModule: WasmModule | null = null;
let wasmLoading: Promise<WasmModule> | null = null;

/** Lazy-load the WASM module. Safe to call multiple times — deduplicates. */
export async function loadWasm(): Promise<WasmModule> {
	if (wasmModule) return wasmModule;
	if (wasmLoading) return wasmLoading;

	wasmLoading = import('@vfir/wasm').then(async (mod) => {
		if ('default' in mod && typeof mod.default === 'function') {
			await mod.default();
		}
		wasmModule = mod;
		return mod;
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
