import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';

const wasmPkgEntry = resolve(__dirname, '../../packages/wasm/pkg/vfir_wasm.js');
const wasmResolved = existsSync(wasmPkgEntry)
	? wasmPkgEntry
	: resolve(__dirname, './src/wasm-stub.ts');

export default defineConfig({
	plugins: [tailwindcss(), svelte()],
	resolve: {
		alias: {
			// Use the real WASM package if built, otherwise fall back to the stub
			'@vfir/wasm': wasmResolved,
			'$lib': resolve(__dirname, './src/lib'),
		},
	},
});
