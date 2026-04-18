import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';

const wasmPkgEntry = resolve(__dirname, '../../packages/wasm/pkg/vfir_wasm.js');
const wasmResolved = existsSync(wasmPkgEntry)
	? wasmPkgEntry
	: resolve(__dirname, './src/wasm-stub.ts');

export default defineConfig({
	plugins: [svelte()],
	resolve: {
		alias: {
			// Use the real WASM package if built, otherwise fall back to the stub
			'@vfir/wasm': wasmResolved,
		},
	},
});
