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

/** JS fallback for the WASM force_step. Signature matches the Rust export. */
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
): Float32Array {
	const n = x.length;
	const out = new Float32Array(n * 4);
	for (let i = 0; i < n; i++) {
		let fx = (center_x - x[i]) * centering * importance[i];
		let fy = (center_y - y[i]) * centering * importance[i];
		for (let j = 0; j < n; j++) {
			if (i === j) continue;
			const dx = x[i] - x[j];
			const dy = y[i] - y[j];
			const ox = (w[i] + w[j]) * 0.5 + 8 - Math.abs(dx);
			const oy = (h[i] + h[j]) * 0.5 + 8 - Math.abs(dy);
			if (ox > 0 && oy > 0) {
				const push = Math.min(ox, oy);
				const dist = Math.sqrt(dx * dx + dy * dy + 1);
				fx += (dx / dist) * repulsion * push * 0.001;
				fy += (dy / dist) * repulsion * push * 0.001;
			}
		}
		const nvx = (vx[i] + fx * dt) * damping;
		const nvy = (vy[i] + fy * dt) * damping;
		out[i * 4 + 0] = x[i] + nvx * dt;
		out[i * 4 + 1] = y[i] + nvy * dt;
		out[i * 4 + 2] = nvx;
		out[i * 4 + 3] = nvy;
	}
	return out;
}

export function clamp_to_bounds(
	x: Float32Array,
	y: Float32Array,
	w: Float32Array,
	h: Float32Array,
	bounds_w: number,
	bounds_h: number,
): Float32Array {
	const n = x.length;
	const out = new Float32Array(n * 2);
	for (let i = 0; i < n; i++) {
		const hw = w[i] * 0.5;
		const hh = h[i] * 0.5;
		out[i * 2 + 0] = Math.max(hw, Math.min(bounds_w - hw, x[i]));
		out[i * 2 + 1] = Math.max(hh, Math.min(bounds_h - hh, y[i]));
	}
	return out;
}

export default async function init(): Promise<void> {
	// no-op stub
}
