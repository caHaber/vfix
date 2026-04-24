import { getWasm } from '@vfir/core';
import type { Measurer } from './measurer.js';
import type {
	ContentBlock,
	Group,
	MeasuredBlock,
	PositionedBlock,
	ResponseStructure,
} from './types.js';

// Physics: soft-collision cloud. The sim should come to rest with circles
// touching rather than maintaining a gap — so repulsion is kept light and
// damping high so residual forces die out quickly.
const REPULSION = 500;
// Global centering: very weak, just a gravitational tether. Group forces do
// the actual clustering so each group pulls toward its own centroid.
const CENTERING = 0.004;
const DAMPING = 0.92;
const DT = 0.8;

// Pull each block toward its own group's centroid. Strong enough to make
// same-group members cluster tightly; weak enough to not fight repulsion.
const GROUP_PULL = 0.03;

// Push group centroids apart so groups occupy visibly distinct regions.
// Applied as an inverse-square point force accumulated per-group, then added
// uniformly to every member. Scaled so ~200px between small groups is stable.
const INTER_GROUP_REPULSION = 60000;
// Prevents blow-up when two centroids are coincident.
const INTER_GROUP_EPS = 900;

// Below this per-component velocity, snap that block's velocity to zero. Keeps
// individual blocks from twitching indefinitely with sub-pixel drift.
const VELOCITY_SNAP = 0.1;

// Render smoothing: separate lerp from physics to target so motion stays smooth
// even while the sim is still solving. SMOOTH_ALPHA ≈ 0.14 → ~7-frame time
// constant (~115ms at 60fps). Lower = silkier but slower to catch up.
const SMOOTH_ALPHA = 0.14;
const FADE_IN_MS = 500;

// Once the sim's RMS velocity drops below this, we freeze: zero out velocities
// and stop calling force_step entirely. Frozen is cleared when a block is added,
// removed, or scaled.
const FREEZE_VEL_THRESHOLD = 0.15;

// Block sizing: diameter = hypot(inkW, inkH) + DIAM_PADDING_PX. We enclose the
// *ink* rectangle (fontSize-based, not lineHeight-padded) so there's no wasted
// vertical slack, then add a small absolute breathing margin.
const DIAM_PADDING_PX = 10;

type WasmApi = {
	force_step(
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
	clamp_to_bounds(
		x: Float32Array,
		y: Float32Array,
		w: Float32Array,
		h: Float32Array,
		bounds_w: number,
		bounds_h: number,
	): Float32Array;
};

export interface StreamingLayoutOptions {
	measurer: Measurer;
	bounds: { width: number; height: number };
	/** Radius around center where new blocks spawn. */
	spawnRadius?: number;
}

/**
 * Mutable force-directed layout that grows as blocks arrive. Backed by
 * the same wasm `force_step` / `clamp_to_bounds` primitives the batch
 * exploration layout uses — one iteration per `step()` call.
 */
export class StreamingLayout {
	private measurer: Measurer;
	private bounds: { width: number; height: number };
	private spawnRadius: number;

	private capacity = 0;
	private n = 0;
	// Physics state (target positions — circle centers)
	private x: Float32Array = new Float32Array(0);
	private y: Float32Array = new Float32Array(0);
	// w/h are the AABB fed to wasm — for circles, both equal diameter * scale.
	private w: Float32Array = new Float32Array(0);
	private h: Float32Array = new Float32Array(0);
	private imp: Float32Array = new Float32Array(0);
	private vx: Float32Array = new Float32Array(0);
	private vy: Float32Array = new Float32Array(0);
	// Sizing: baseDiam is the intrinsic circle size from the text measurement;
	// scale is a per-block user-facing multiplier. Effective diameter = both.
	private baseDiam: Float32Array = new Float32Array(0);
	private scale: Float32Array = new Float32Array(0);
	// Rendered state (lerps toward physics state)
	private rx: Float32Array = new Float32Array(0);
	private ry: Float32Array = new Float32Array(0);
	private lastRenderMotion = 0;
	private frozen = false;
	private blockIds: string[] = [];
	private measured = new Map<string, MeasuredBlock>();
	private blocks = new Map<string, ContentBlock>();
	private spawnTime = new Map<string, number>();
	private groupsById = new Map<string, Group>();

	constructor(opts: StreamingLayoutOptions) {
		this.measurer = opts.measurer;
		this.bounds = opts.bounds;
		this.spawnRadius = opts.spawnRadius ?? 100;
	}

	addBlock(block: ContentBlock): MeasuredBlock | null {
		if (this.blocks.has(block.id)) return this.measured.get(block.id) ?? null;
		// Squareish measurement: re-wrap wide text to produce circle-friendly
		// shapes — the measurer (preText) handles line breaks so wasm only sees
		// a clean AABB per block.
		const measured = this.measurer.measureSquareish(block);
		if (!measured) return null;

		this.ensureCapacity(this.n + 1);
		const cx = this.bounds.width / 2;
		const cy = this.bounds.height / 2;
		const angle = Math.random() * Math.PI * 2;
		const r = this.spawnRadius * (0.4 + Math.random() * 0.8);
		const i = this.n;
		const sx = cx + Math.cos(angle) * r;
		const sy = cy + Math.sin(angle) * r;
		// Tight ink height: cap-to-baseline for the first line, lineHeight for
		// each subsequent line. Skips the ~35% lineHeight padding on the last
		// line that otherwise leaves the circle feeling empty at top/bottom.
		const inkH =
			measured.fontSize * 1.1 + Math.max(0, measured.lineCount - 1) * measured.lineHeight;
		const inkW = measured.width;
		const diam = Math.ceil(Math.sqrt(inkW * inkW + inkH * inkH) + DIAM_PADDING_PX);
		this.x[i] = sx;
		this.y[i] = sy;
		// Rendered starts at spawn point too, so fade-in glides rather than snaps.
		this.rx[i] = sx;
		this.ry[i] = sy;
		this.baseDiam[i] = diam;
		this.scale[i] = 1;
		this.w[i] = diam;
		this.h[i] = diam;
		this.imp[i] = block.importance;
		this.vx[i] = 0;
		this.vy[i] = 0;

		this.blockIds.push(block.id);
		this.measured.set(block.id, measured);
		this.blocks.set(block.id, block);
		this.spawnTime.set(block.id, now());
		this.n += 1;
		// New arrival: physics has work to do again.
		this.frozen = false;
		return measured;
	}

	/** Multiply a block's scale (and wake the sim so it re-settles). */
	scaleBlock(id: string, factor: number): void {
		const i = this.blockIds.indexOf(id);
		if (i < 0) return;
		const next = Math.max(0.4, Math.min(4, this.scale[i] * factor));
		if (next === this.scale[i]) return;
		this.scale[i] = next;
		const d = this.baseDiam[i] * next;
		this.w[i] = d;
		this.h[i] = d;
		this.frozen = false;
	}

	addGroup(group: Group): void {
		this.groupsById.set(group.id, group);
	}

	removeBlock(id: string): void {
		const idx = this.blockIds.indexOf(id);
		if (idx < 0) return;
		const last = this.n - 1;
		if (idx !== last) {
			this.x[idx] = this.x[last];
			this.y[idx] = this.y[last];
			this.w[idx] = this.w[last];
			this.h[idx] = this.h[last];
			this.imp[idx] = this.imp[last];
			this.vx[idx] = this.vx[last];
			this.vy[idx] = this.vy[last];
			this.rx[idx] = this.rx[last];
			this.ry[idx] = this.ry[last];
			this.baseDiam[idx] = this.baseDiam[last];
			this.scale[idx] = this.scale[last];
			this.blockIds[idx] = this.blockIds[last];
		}
		this.blockIds.pop();
		this.n -= 1;
		this.measured.delete(id);
		this.blocks.delete(id);
		this.spawnTime.delete(id);
		// Removal shifts the force balance — let the sim re-settle.
		this.frozen = false;
	}

	setBounds(bounds: { width: number; height: number }): void {
		this.bounds = bounds;
	}

	/** Run one wasm iteration; returns current positioned blocks. */
	step(): PositionedBlock[] {
		if (this.n === 0) return [];

		if (!this.frozen) {
			const api = getWasm() as unknown as WasmApi;
			const cx = this.bounds.width / 2;
			const cy = this.bounds.height / 2;
			const x = this.x.subarray(0, this.n);
			const y = this.y.subarray(0, this.n);
			const w = this.w.subarray(0, this.n);
			const h = this.h.subarray(0, this.n);
			const imp = this.imp.subarray(0, this.n);
			const vx = this.vx.subarray(0, this.n);
			const vy = this.vy.subarray(0, this.n);

			const next = api.force_step(x, y, w, h, imp, vx, vy, cx, cy, REPULSION, CENTERING, DAMPING, DT);
			for (let i = 0; i < this.n; i++) {
				this.x[i] = next[i * 4 + 0];
				this.y[i] = next[i * 4 + 1];
				this.vx[i] = next[i * 4 + 2];
				this.vy[i] = next[i * 4 + 3];
			}
			// Infinite canvas: no clamp. Centering force keeps the cloud bounded
			// gravitationally, and the viewport handles pan/zoom at render time.

			// Group forces: pull toward own centroid, push away from other groups.
			// The push is accumulated per-group from all other group centroids as
			// an inverse-square point force, then applied uniformly to every
			// member — groups end up in visibly distinct regions.
			const centroids = this.groupCentroids();
			const groupPush = new Map<string, { fx: number; fy: number }>();
			const centArr = Array.from(centroids.entries());
			for (let a = 0; a < centArr.length; a++) {
				const [gidA, cA] = centArr[a];
				let fx = 0;
				let fy = 0;
				for (let b = 0; b < centArr.length; b++) {
					if (a === b) continue;
					const cB = centArr[b][1];
					const dx = cA.x - cB.x;
					const dy = cA.y - cB.y;
					const dist2 = dx * dx + dy * dy + INTER_GROUP_EPS;
					const invDist = 1 / Math.sqrt(dist2);
					const mag = INTER_GROUP_REPULSION / dist2;
					fx += dx * invDist * mag;
					fy += dy * invDist * mag;
				}
				groupPush.set(gidA, { fx, fy });
			}

			let velSum = 0;
			for (let i = 0; i < this.n; i++) {
				const id = this.blockIds[i];
				const gid = this.blocks.get(id)?.groupId;
				if (gid) {
					const c = centroids.get(gid);
					if (c && c.n > 1) {
						this.vx[i] += (c.x - this.x[i]) * GROUP_PULL;
						this.vy[i] += (c.y - this.y[i]) * GROUP_PULL;
					}
					const push = groupPush.get(gid);
					if (push) {
						this.vx[i] += push.fx;
						this.vy[i] += push.fy;
					}
				}
				// Per-block velocity snap: sub-pixel twitches collapse to zero.
				if (Math.abs(this.vx[i]) < VELOCITY_SNAP) this.vx[i] = 0;
				if (Math.abs(this.vy[i]) < VELOCITY_SNAP) this.vy[i] = 0;
				velSum += this.vx[i] * this.vx[i] + this.vy[i] * this.vy[i];
			}

			// Freeze once the whole cloud is basically quiet. Otherwise the wasm
			// solver keeps emitting sub-pixel target drift and render never rests.
			if (Math.sqrt(velSum / this.n) < FREEZE_VEL_THRESHOLD) {
				for (let i = 0; i < this.n; i++) {
					this.vx[i] = 0;
					this.vy[i] = 0;
				}
				this.frozen = true;
			}
		}

		// Lerp rendered position toward physics target. Keeps motion smooth while
		// the sim is solving, and after freeze lets render glide to its final rest.
		let motion = 0;
		for (let i = 0; i < this.n; i++) {
			const dx = this.x[i] - this.rx[i];
			const dy = this.y[i] - this.ry[i];
			this.rx[i] += dx * SMOOTH_ALPHA;
			this.ry[i] += dy * SMOOTH_ALPHA;
			motion += dx * dx + dy * dy;
		}
		this.lastRenderMotion = Math.sqrt(motion / Math.max(1, this.n));
		return this.positions();
	}

	private groupCentroids(): Map<string, { x: number; y: number; n: number }> {
		const out = new Map<string, { x: number; y: number; n: number }>();
		for (let i = 0; i < this.n; i++) {
			const id = this.blockIds[i];
			const gid = this.blocks.get(id)?.groupId;
			if (!gid) continue;
			let agg = out.get(gid);
			if (!agg) {
				agg = { x: 0, y: 0, n: 0 };
				out.set(gid, agg);
			}
			agg.x += this.x[i];
			agg.y += this.y[i];
			agg.n += 1;
		}
		for (const c of out.values()) {
			c.x /= c.n;
			c.y /= c.n;
		}
		return out;
	}

	positions(): PositionedBlock[] {
		const t = now();
		const out: PositionedBlock[] = [];
		for (let i = 0; i < this.n; i++) {
			const id = this.blockIds[i];
			const b = this.blocks.get(id)!;
			const m = this.measured.get(id)!;
			const spawn = this.spawnTime.get(id) ?? t;
			const age = t - spawn;
			const fadeIn = Math.min(1, Math.max(0, age / FADE_IN_MS));
			const baseOpacity = 0.4 + 0.6 * b.importance;
			const diam = this.baseDiam[i] * this.scale[i];
			out.push({
				...m,
				x: this.rx[i] - diam / 2,
				y: this.ry[i] - diam / 2,
				diameter: diam,
				opacity: baseOpacity * fadeIn,
				text: b.text,
				type: b.type,
				groupId: b.groupId,
			});
		}
		return out;
	}

	getGroups(): Group[] {
		return Array.from(this.groupsById.values());
	}

	getStructure(): ResponseStructure {
		return {
			blocks: this.blockIds.map((id) => this.blocks.get(id)!),
			groups: this.getGroups(),
			relationships: [],
		};
	}

	size(): number {
		return this.n;
	}

	/** RMS rendered-frame motion — settle detection is visual, not physical. */
	energy(): number {
		if (this.n === 0) return 0;
		return this.lastRenderMotion;
	}

	private ensureCapacity(size: number): void {
		if (size <= this.capacity) return;
		const newCap = Math.max(size, Math.ceil((this.capacity || 8) * 1.5));
		this.x = grow(this.x, newCap);
		this.y = grow(this.y, newCap);
		this.w = grow(this.w, newCap);
		this.h = grow(this.h, newCap);
		this.imp = grow(this.imp, newCap);
		this.vx = grow(this.vx, newCap);
		this.vy = grow(this.vy, newCap);
		this.rx = grow(this.rx, newCap);
		this.ry = grow(this.ry, newCap);
		this.baseDiam = grow(this.baseDiam, newCap);
		this.scale = grow(this.scale, newCap);
		this.capacity = newCap;
	}
}

function grow(arr: Float32Array, cap: number): Float32Array {
	const next = new Float32Array(cap);
	next.set(arr);
	return next;
}

function now(): number {
	return typeof performance !== 'undefined' ? performance.now() : Date.now();
}
