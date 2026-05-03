import type { Unsubscribe } from './types.js';
import { getWasm, isWasmReady } from './wasm-bridge.js';

export interface BatchedInterpolatorOptions {
	/** Number of independent groups (e.g. words). */
	groups: number;
	/** Number of axes per group (e.g. 5 for {wght, CASL, slnt, MONO, CRSV}). */
	axesPerGroup: number;
	/** Initial values, length groups * axesPerGroup. Copied into internal storage. */
	initial: ArrayLike<number>;
	/** Per-group stiffness (length = groups). Defaults to 0.08 for each. */
	stiffness?: ArrayLike<number>;
	/** Snap-to-target threshold per axis component. */
	epsilon?: number;
	/** Curve type forwarded to WASM (0 = linear, 1 = ease-out-cubic, 2 = spring). */
	curveType?: number;
}

export type BatchedSubscriber = (current: Float32Array) => void;

/**
 * One spring-eased interpolator that animates N independent groups of K axes
 * in a single batched call per frame.
 *
 * For kinetic typography this collapses what was N RAF loops + N WASM
 * round-trips per frame into one. The WASM path uses `interpolate_batch`
 * (per-group stiffness, returns a trailing `any_moving` flag) so the JS side
 * doesn't need to scan the result.
 */
export class BatchedInterpolator {
	readonly groups: number;
	readonly axesPerGroup: number;
	readonly length: number;

	private current: Float32Array;
	private target: Float32Array;
	private stiffness: Float32Array;
	private epsilon: number;
	private curveType: number;

	private rafId: number | null = null;
	private dirty = false;
	private subscribers: Set<BatchedSubscriber> = new Set();

	constructor(opts: BatchedInterpolatorOptions) {
		this.groups = opts.groups;
		this.axesPerGroup = opts.axesPerGroup;
		this.length = this.groups * this.axesPerGroup;
		this.epsilon = opts.epsilon ?? 0.01;
		this.curveType = opts.curveType ?? 2;

		this.current = new Float32Array(this.length);
		this.target = new Float32Array(this.length);
		this.stiffness = new Float32Array(this.groups);

		this.copyInto(this.current, opts.initial, this.length);
		this.target.set(this.current);

		if (opts.stiffness) {
			this.copyInto(this.stiffness, opts.stiffness, this.groups);
		} else {
			this.stiffness.fill(0.08);
		}
	}

	/** Replace per-group stiffness in place. */
	setStiffness(values: ArrayLike<number>): void {
		this.copyInto(this.stiffness, values, this.groups);
	}

	/** Set the K target values for a single group. */
	setTargetGroup(groupIndex: number, values: ArrayLike<number>): void {
		if (groupIndex < 0 || groupIndex >= this.groups) return;
		const base = groupIndex * this.axesPerGroup;
		const k = Math.min(this.axesPerGroup, values.length);
		for (let i = 0; i < k; i++) this.target[base + i] = values[i];
		this.scheduleTick();
	}

	/** Set all targets at once (length == groups * axesPerGroup). */
	setTargets(values: ArrayLike<number>): void {
		this.copyInto(this.target, values, this.length);
		this.scheduleTick();
	}

	/** Jump to targets without animation. */
	jumpTo(values: ArrayLike<number>): void {
		this.copyInto(this.target, values, this.length);
		this.current.set(this.target);
		this.notify();
	}

	subscribe(fn: BatchedSubscriber): Unsubscribe {
		this.subscribers.add(fn);
		fn(this.current);
		return () => this.subscribers.delete(fn);
	}

	getCurrent(): Float32Array {
		return this.current;
	}

	destroy(): void {
		if (this.rafId !== null) {
			cancelAnimationFrame(this.rafId);
			this.rafId = null;
		}
		this.subscribers.clear();
	}

	private scheduleTick(): void {
		this.dirty = true;
		if (this.rafId === null) {
			this.rafId = requestAnimationFrame(() => this.tick());
		}
	}

	private tick(): void {
		this.rafId = null;
		if (!this.dirty) return;

		let anyMoving = false;

		if (isWasmReady()) {
			const wasm = getWasm();
			const result = wasm.interpolate_batch(
				this.current,
				this.target,
				this.stiffness,
				this.epsilon,
				this.axesPerGroup,
				this.curveType,
			) as Float32Array;
			// Last element is a moving flag; the rest are the new component values.
			for (let i = 0; i < this.length; i++) this.current[i] = result[i];
			anyMoving = result[this.length] > 0.5;
		} else {
			for (let g = 0; g < this.groups; g++) {
				const s = this.stiffness[g];
				const sEased = this.easeT(s);
				const base = g * this.axesPerGroup;
				for (let kk = 0; kk < this.axesPerGroup; kk++) {
					const i = base + kk;
					const a = this.current[i];
					const b = this.target[i];
					const delta = b - a;
					if (Math.abs(delta) < this.epsilon) {
						this.current[i] = b;
					} else {
						this.current[i] = a + delta * sEased;
						anyMoving = true;
					}
				}
			}
		}

		this.notify();

		if (anyMoving) {
			this.rafId = requestAnimationFrame(() => this.tick());
		} else {
			this.dirty = false;
		}
	}

	private easeT(t: number): number {
		switch (this.curveType) {
			case 1: {
				const t1 = t - 1;
				return t1 * t1 * t1 + 1;
			}
			case 2: {
				const decay = Math.exp(-5 * t);
				return 1 - decay * (1 - t);
			}
			default:
				return t;
		}
	}

	private notify(): void {
		for (const fn of this.subscribers) fn(this.current);
	}

	private copyInto(dst: Float32Array, src: ArrayLike<number>, max: number): void {
		const n = Math.min(max, src.length);
		if (src instanceof Float32Array && src.length === dst.length) {
			dst.set(src);
			return;
		}
		for (let i = 0; i < n; i++) dst[i] = src[i];
	}
}
