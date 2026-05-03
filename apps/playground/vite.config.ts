import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

const wasmPkgEntry = resolve(__dirname, '../../packages/wasm/pkg/vfir_wasm.js');
const wasmResolved = existsSync(wasmPkgEntry)
	? wasmPkgEntry
	: resolve(__dirname, './src/wasm-stub.ts');

const wasmStatsPkgEntry = resolve(__dirname, '../../packages/wasm-stats/pkg/vfir_wasm_stats.js');
const wasmStatsResolved = existsSync(wasmStatsPkgEntry)
	? wasmStatsPkgEntry
	: resolve(__dirname, './src/wasm-stats-stub.ts');

export default defineConfig({
	plugins: [tailwindcss(), svelte()],
	resolve: {
		alias: {
			// Use the real WASM packages if built, otherwise fall back to stubs
			'@vfir/wasm': wasmResolved,
			'@vfir/wasm-stats': wasmStatsResolved,
			$lib: resolve(__dirname, './src/lib'),
		},
	},
});
