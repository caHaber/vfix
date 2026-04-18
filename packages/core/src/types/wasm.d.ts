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
	export default function init(): Promise<void>;
}
