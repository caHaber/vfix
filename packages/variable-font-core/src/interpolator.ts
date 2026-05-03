import { linear } from './easing.js';
import type {
	AxisSnapshot,
	AxisState,
	EasingFn,
	InterpolatorOptions,
	SubscriberFn,
	Unsubscribe,
} from './types.js';
import { getWasm, isWasmReady } from './wasm-bridge.js';

export class Interpolator {
	private axes: Map<string, AxisState> = new Map();
	private subscribers: Set<SubscriberFn> = new Set();
	private rafId: number | null = null;
	private dirty = false;
	private stiffness: number;
	private epsilon: number;

	constructor(options: InterpolatorOptions) {
		this.stiffness = options.stiffness ?? 0.08;
		this.epsilon = options.epsilon ?? 0.01;
		const defaultEasing = options.easing ?? linear;

		for (const [tag, config] of Object.entries(options.axes)) {
			this.axes.set(tag, {
				tag,
				min: config.min,
				max: config.max,
				default: config.default,
				current: config.default,
				target: config.default,
				easing: defaultEasing,
			});
		}
	}

	/** Set a single axis target value */
	set(tag: string, value: number): void {
		const axis = this.axes.get(tag);
		if (!axis) return;
		axis.target = Math.max(axis.min, Math.min(axis.max, value));
		this.scheduleTick();
	}

	/** Set multiple axis target values at once */
	setAll(values: Record<string, number>): void {
		for (const [tag, value] of Object.entries(values)) {
			const axis = this.axes.get(tag);
			if (!axis) continue;
			axis.target = Math.max(axis.min, Math.min(axis.max, value));
		}
		this.scheduleTick();
	}

	/** Instantly jump to target values (no animation) */
	jumpTo(values: Record<string, number>): void {
		for (const [tag, value] of Object.entries(values)) {
			const axis = this.axes.get(tag);
			if (!axis) continue;
			const clamped = Math.max(axis.min, Math.min(axis.max, value));
			axis.target = clamped;
			axis.current = clamped;
		}
		this.notify();
	}

	/** Set easing for a specific axis */
	setEasing(tag: string, easing: EasingFn): void {
		const axis = this.axes.get(tag);
		if (axis) axis.easing = easing;
	}

	/** Get current snapshot of all axis values */
	getSnapshot(): AxisSnapshot {
		const snapshot: AxisSnapshot = {};
		for (const [tag, state] of this.axes) {
			snapshot[tag] = state.current;
		}
		return snapshot;
	}

	/** Get a single axis state */
	getAxis(tag: string): Readonly<AxisState> | undefined {
		return this.axes.get(tag);
	}

	/** Get all axis tags */
	getAxes(): string[] {
		return Array.from(this.axes.keys());
	}

	/** Subscribe to axis value changes. Immediately calls fn with current state. */
	subscribe(fn: SubscriberFn): Unsubscribe {
		this.subscribers.add(fn);
		fn(this.getSnapshot());
		return () => this.subscribers.delete(fn);
	}

	/** Stop the render loop and clean up */
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
			// WASM path: batch all axes into typed arrays for the WASM interpolator
			const wasm = getWasm();
			const axisEntries = Array.from(this.axes.values());
			const from = new Float32Array(axisEntries.map((a) => a.current));
			const to = new Float32Array(axisEntries.map((a) => a.target));
			// Use stiffness as the interpolation t — curve_type 2 = spring
			const result = wasm.interpolate_axes(from, to, this.stiffness, 2);

			for (let i = 0; i < axisEntries.length; i++) {
				const axis = axisEntries[i];
				if (Math.abs(axis.target - result[i]) < this.epsilon) {
					axis.current = axis.target;
				} else {
					axis.current = result[i];
					anyMoving = true;
				}
			}
		} else {
			// JS fallback: simple lerp
			for (const axis of this.axes.values()) {
				if (Math.abs(axis.target - axis.current) < this.epsilon) {
					axis.current = axis.target;
				} else {
					axis.current += (axis.target - axis.current) * this.stiffness;
					anyMoving = true;
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

	private notify(): void {
		const snapshot = this.getSnapshot();
		for (const fn of this.subscribers) {
			fn(snapshot);
		}
	}
}
