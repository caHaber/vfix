import { loadWasm, getWasm } from '@vfir/core';
import type {
	LayoutMode,
	LayoutResult,
	MeasuredBlock,
	PositionedBlock,
	ResponseStructure,
} from './types.js';

const FORCE_ITERATIONS = 120;
const REPULSION = 4000;
const CENTERING = 0.02;
const DAMPING = 0.85;
const DT = 1.0;

export interface LayoutInput {
	structure: ResponseStructure;
	measured: MeasuredBlock[];
	mode: LayoutMode;
	bounds: { width: number; height: number };
}

type WasmApi = {
	force_step(
		x: Float32Array, y: Float32Array, w: Float32Array, h: Float32Array,
		importance: Float32Array, vx: Float32Array, vy: Float32Array,
		center_x: number, center_y: number,
		repulsion: number, centering: number, damping: number, dt: number,
	): Float32Array;
	clamp_to_bounds(
		x: Float32Array, y: Float32Array, w: Float32Array, h: Float32Array,
		bounds_w: number, bounds_h: number,
	): Float32Array;
};

export class LayoutEngine {
	async compute(input: LayoutInput): Promise<LayoutResult> {
		try {
			await loadWasm();
		} catch {
			// fallback to stub is handled via Vite alias
		}
		if (input.mode === 'decision') {
			return Promise.resolve(this.layoutDecision(input));
		}
		return this.layoutExploration(input);
	}

	/** Decision mode: recommendation large + centered, alternatives flanking, caveats/context below. */
	private layoutDecision(input: LayoutInput): LayoutResult {
		const { structure, measured, bounds } = input;
		const mById = new Map(measured.map((m) => [m.id, m]));
		const bById = new Map(structure.blocks.map((b) => [b.id, b]));

		const rec = structure.blocks.find((b) => b.type === 'recommendation');
		const alts = structure.blocks.filter((b) => b.type === 'alternative');
		const pros = structure.blocks.filter((b) => b.type === 'pro');
		const cons = structure.blocks.filter((b) => b.type === 'con');
		const caveats = structure.blocks.filter((b) => b.type === 'caveat');
		const rest = structure.blocks.filter(
			(b) => !['recommendation', 'alternative', 'pro', 'con', 'caveat'].includes(b.type),
		);

		const positions: PositionedBlock[] = [];
		const cx = bounds.width / 2;
		const GAP = 24;
		let cursorY = 40;

		if (rec) {
			const m = mById.get(rec.id);
			if (m) {
				positions.push({ ...m, x: cx - m.width / 2, y: cursorY, opacity: 1, text: rec.text, type: rec.type });
				cursorY += m.height + GAP * 2;
			}
		}

		// Alternatives row
		if (alts.length > 0) {
			const altMeasured = alts.map((b) => mById.get(b.id)).filter((m): m is MeasuredBlock => m !== undefined);
			const rowWidth = altMeasured.reduce((s, m) => s + m.width, 0) + GAP * (altMeasured.length - 1);
			let x = cx - rowWidth / 2;
			let rowH = 0;
			for (let i = 0; i < altMeasured.length; i++) {
				const m = altMeasured[i];
				const b = alts[i];
				positions.push({ ...m, x, y: cursorY, opacity: 0.95, text: b.text, type: b.type });
				x += m.width + GAP;
				rowH = Math.max(rowH, m.height);
			}
			cursorY += rowH + GAP * 2;
		}

		// Pros left, cons right
		let prosY = cursorY;
		let consY = cursorY;
		for (const b of pros) {
			const m = mById.get(b.id);
			if (!m) continue;
			positions.push({ ...m, x: GAP, y: prosY, opacity: 0.85, text: b.text, type: b.type });
			prosY += m.height + GAP;
		}
		for (const b of cons) {
			const m = mById.get(b.id);
			if (!m) continue;
			positions.push({ ...m, x: bounds.width - m.width - GAP, y: consY, opacity: 0.85, text: b.text, type: b.type });
			consY += m.height + GAP;
		}
		cursorY = Math.max(prosY, consY) + GAP;

		// Caveats centered
		for (const b of caveats) {
			const m = mById.get(b.id);
			if (!m) continue;
			positions.push({ ...m, x: cx - m.width / 2, y: cursorY, opacity: 0.65, text: b.text, type: b.type });
			cursorY += m.height + GAP;
		}

		// Context / explanations
		for (const b of rest) {
			const m = mById.get(b.id);
			if (!m) continue;
			positions.push({
				...m,
				x: cx - m.width / 2,
				y: cursorY,
				opacity: b.type === 'context' ? 0.45 : 0.8,
				text: b.text,
				type: b.type,
			});
			cursorY += m.height + GAP;
		}

		void bById;
		return {
			positions,
			bounds: { width: bounds.width, height: Math.max(cursorY + 40, bounds.height) },
			mode: 'decision',
		};
	}

	/** Exploration mode: force-directed with importance-weighted centering. */
	private async layoutExploration(input: LayoutInput): Promise<LayoutResult> {
		const { structure, measured, bounds } = input;
		const mById = new Map(measured.map((m) => [m.id, m]));
		const n = structure.blocks.length;

		const x = new Float32Array(n);
		const y = new Float32Array(n);
		const w = new Float32Array(n);
		const h = new Float32Array(n);
		const imp = new Float32Array(n);
		const vx = new Float32Array(n);
		const vy = new Float32Array(n);

		const cx = bounds.width / 2;
		const cy = bounds.height / 2;
		const radius = Math.min(bounds.width, bounds.height) * 0.35;

		for (let i = 0; i < n; i++) {
			const b = structure.blocks[i];
			const m = mById.get(b.id);
			if (!m) continue;
			const angle = (i / n) * Math.PI * 2;
			const r = radius * (1 - 0.6 * b.importance);
			x[i] = cx + Math.cos(angle) * r;
			y[i] = cy + Math.sin(angle) * r;
			w[i] = m.width;
			h[i] = m.height;
			imp[i] = b.importance;
		}

		// After loadWasm() in compute(), getWasm() always returns the module —
		// whether real WASM or the Vite-aliased stub (stub init() is a no-op that still sets wasmModule).
		const api = getWasm() as unknown as WasmApi;

		for (let iter = 0; iter < FORCE_ITERATIONS; iter++) {
			const next = api.force_step(x, y, w, h, imp, vx, vy, cx, cy, REPULSION, CENTERING, DAMPING, DT);
			for (let i = 0; i < n; i++) {
				x[i] = next[i * 4 + 0];
				y[i] = next[i * 4 + 1];
				vx[i] = next[i * 4 + 2];
				vy[i] = next[i * 4 + 3];
			}
			const clamped = api.clamp_to_bounds(x, y, w, h, bounds.width, bounds.height);
			for (let i = 0; i < n; i++) {
				x[i] = clamped[i * 2 + 0];
				y[i] = clamped[i * 2 + 1];
			}
		}

		const positions: PositionedBlock[] = structure.blocks.map((b, i) => {
			const m = mById.get(b.id) ?? { id: b.id, width: 200, height: 40, fontSize: 16, fontWeight: 400 };
			return {
				...m,
				x: x[i] - m.width / 2,
				y: y[i] - m.height / 2,
				opacity: 0.4 + 0.6 * b.importance,
				text: b.text,
				type: b.type,
			};
		});

		return { positions, bounds, mode: 'exploration' };
	}
}

