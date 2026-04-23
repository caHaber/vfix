// Type stub for @vfir/wasm — replaced when the package is built
declare module '@vfir/wasm' {
	export function compute_layout(
		advances: Float32Array,
		available_width: number,
		break_points: Uint32Array,
	): Uint32Array;
	export function interpolate_axes(
		from: Float32Array,
		to: Float32Array,
		t: number,
		curve_type: number,
	): Float32Array;
	export function cubic_bezier_interpolate(
		x1: number,
		y1: number,
		x2: number,
		y2: number,
		t: number,
	): number;
	// Cartographer layout primitives
	export function force_step(
		x: Float32Array,
		y: Float32Array,
		w: Float32Array,
		h: Float32Array,
		importance: Float32Array,
		vx: Float32Array,
		vy: Float32Array,
		center_x: number,
		center_y: number,
		repulsion: number,
		centering: number,
		damping: number,
		dt: number,
	): Float32Array;
	export function clamp_to_bounds(
		x: Float32Array,
		y: Float32Array,
		w: Float32Array,
		h: Float32Array,
		bounds_w: number,
		bounds_h: number,
	): Float32Array;
	export default function init(): Promise<void>;
}
