// Stub for @vfir/wasm — used in dev when wasm-pack hasn't been run yet.
// Replace with the real package once `pnpm build:wasm` has been executed.

export function compute_layout(
	_advances: Float32Array,
	_available_width: number,
	_break_points: Uint32Array,
): Uint32Array {
	return new Uint32Array(0);
}

function easeT(t: number, curveType: number): number {
	if (curveType === 1) {
		const t1 = t - 1;
		return t1 * t1 * t1 + 1;
	}
	if (curveType === 2) {
		const decay = Math.exp(-5 * t);
		return 1 - decay * (1 - t);
	}
	return t;
}

export function interpolate_axes(
	from: Float32Array,
	to: Float32Array,
	t: number,
	curve_type: number,
): Float32Array {
	const eased = easeT(t, curve_type);
	const out = new Float32Array(from.length);
	for (let i = 0; i < from.length; i++) {
		out[i] = from[i] + (to[i] - from[i]) * eased;
	}
	return out;
}

export function interpolate_batch(
	from: Float32Array,
	to: Float32Array,
	stiffness: Float32Array,
	epsilon: number,
	axes_per_group: number,
	curve_type: number,
): Float32Array {
	const n = from.length;
	const k = axes_per_group | 0;
	const groups = k === 0 ? 0 : (n / k) | 0;
	const out = new Float32Array(n + 1);
	let anyMoving = 0;
	for (let g = 0; g < groups; g++) {
		const s = stiffness[g] ?? 0.08;
		const sEased = easeT(s, curve_type);
		const base = g * k;
		for (let kk = 0; kk < k; kk++) {
			const i = base + kk;
			const a = from[i];
			const b = to[i];
			const delta = b - a;
			if (Math.abs(delta) < epsilon) {
				out[i] = b;
			} else {
				out[i] = a + delta * sEased;
				anyMoving = 1;
			}
		}
	}
	out[n] = anyMoving;
	return out;
}

export function compute_radial_targets(
	cx: Float32Array,
	cy: Float32Array,
	mouse_x: number,
	mouse_y: number,
	radius: number,
	wght_min: number,
	wght_range: number,
	slnt_range: number,
): Float32Array {
	const n = cx.length;
	const out = new Float32Array(n * 5);
	const invR = radius > 0 ? 1 / radius : 0;
	for (let i = 0; i < n; i++) {
		const dx = mouse_x - cx[i];
		const dy = mouse_y - cy[i];
		const dist = Math.sqrt(dx * dx + dy * dy);
		const raw = Math.max(0, 1 - dist * invR);
		const p = raw * raw * (3 - 2 * raw);
		const o = i * 5;
		out[o + 0] = wght_min + p * wght_range;
		out[o + 1] = raw * raw;
		out[o + 2] = -p * slnt_range;
		out[o + 3] = Math.max(0, raw - 0.5) * 2;
		out[o + 4] = p;
	}
	return out;
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
