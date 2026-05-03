import type { EasingFn } from './types.js';

export const linear: EasingFn = (t) => t;

export const easeInQuad: EasingFn = (t) => t * t;

export const easeOutQuad: EasingFn = (t) => t * (2 - t);

export const easeInOutQuad: EasingFn = (t) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t);

export const easeOutCubic: EasingFn = (t) => --t * t * t + 1;

export const easeInOutCubic: EasingFn = (t) =>
	t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1;

/** Spring-like easing with overshoot */
export const easeOutBack: EasingFn = (t) => {
	const c1 = 1.70158;
	const c3 = c1 + 1;
	return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
};

/** Create a cubic bezier easing function */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): EasingFn {
	return (t: number): number => {
		if (t === 0 || t === 1) return t;

		let start = 0;
		let end = 1;
		let mid = 0;

		for (let i = 0; i < 20; i++) {
			mid = (start + end) / 2;
			const xMid = bezierPoint(mid, x1, x2);
			if (Math.abs(xMid - t) < 0.0001) break;
			if (xMid < t) start = mid;
			else end = mid;
		}

		return bezierPoint(mid, y1, y2);
	};
}

function bezierPoint(t: number, p1: number, p2: number): number {
	return 3 * (1 - t) * (1 - t) * t * p1 + 3 * (1 - t) * t * t * p2 + t * t * t;
}
