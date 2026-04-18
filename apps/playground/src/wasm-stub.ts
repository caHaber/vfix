// Stub for @vfir/wasm — used in dev when wasm-pack hasn't been run yet.
// Replace with the real package once `pnpm build:wasm` has been executed.

export function compute_layout(
	_advances: Float32Array,
	_available_width: number,
	_break_points: Uint32Array,
): Uint32Array {
	return new Uint32Array(0);
}

export function interpolate_axes(
	from: Float32Array,
	_to: Float32Array,
	_t: number,
	_curve_type: number,
): Float32Array {
	return from;
}

export function cubic_bezier_interpolate(
	_x1: number,
	_y1: number,
	_x2: number,
	_y2: number,
	t: number,
): number {
	return t;
}

export default async function init(): Promise<void> {
	// no-op stub
}
