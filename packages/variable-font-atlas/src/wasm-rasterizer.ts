import type { Axes, RasterizeFn, RasterizerResult } from './types.js';

// biome-ignore lint/suspicious/noExplicitAny: dynamic WASM module type
type WasmModule = any;

/**
 * Bind a WASM module's `rasterize_glyph` export to the RasterizeFn shape the
 * atlas expects. The header layout matches lib.rs exactly: width(u16),
 * height(u16), bearingX(i16), bearingY(i16), advance(f32), then R8 pixels.
 */
export function bindWasmRasterizer(wasm: WasmModule): RasterizeFn {
	if (typeof wasm.rasterize_glyph !== 'function') {
		throw new Error('WASM module is missing rasterize_glyph export');
	}
	return (codepoint: number, axes: Axes, sizePx: number): RasterizerResult | null => {
		const glyphId = wasm.glyph_id_for_codepoint(codepoint) >>> 0;
		if (glyphId === 0) return null;
		const buf: Uint8Array = wasm.rasterize_glyph(
			glyphId,
			axes.wght,
			axes.casl,
			axes.slnt,
			axes.mono,
			axes.crsv,
			sizePx,
		);
		if (buf.length < 12) return null;
		const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
		const width = view.getUint16(0, true);
		const height = view.getUint16(2, true);
		const bearingX = view.getInt16(4, true);
		const bearingY = view.getInt16(6, true);
		const advance = view.getFloat32(8, true);
		const pixels = buf.subarray(12);
		return { width, height, bearingX, bearingY, advance, pixels };
	};
}

/**
 * Initialize the WASM font from a fetched array of bytes. Returns true if
 * the rasterizer accepted the font.
 */
export function initWasmFont(wasm: WasmModule, bytes: Uint8Array): boolean {
	if (typeof wasm.init_font !== 'function') return false;
	return wasm.init_font(bytes) === 1;
}
