import { getWasm } from '@variable-font/core';
import type { Measurer } from './measurer.js';
import type { BlockType, ContentBlock, Group, MeasuredBlock } from './types.js';

// ----- Tunables ---------------------------------------------------------

const REPULSION = 1600;
const DAMPING = 0.78;
const DT = 1;
const VELOCITY_SNAP = 0.05;
const FREEZE_VEL_THRESHOLD = 0.06;
const SMOOTH_ALPHA = 0.18;
const FADE_IN_MS = 360;

// Block (child) sizing: padding around the measured text. Matches the
// renderer's actual padding (28px top + 14px bottom to clear the corner
// importance pill, 18px left/right) so the sim's bbox lines up with what
// the user sees. Mismatched padding here → visible overlap.
const BLOCK_PAD_X = 18;
const BLOCK_PAD_TOP = 28;
const BLOCK_PAD_BOTTOM = 16;
const BLOCK_MIN_W = 120;
const BLOCK_MIN_H = 66;

// Group sizing: header strip + content area, with a minimum that grows to
// fit the largest child. No hard ceiling — groups grow to actually fit
// their kids, and the renderer's auto-fit camera handles overall framing.
const GROUP_HEADER_H = 56;
const GROUP_PAD = 14;
const GROUP_MIN_W = 240;
const GROUP_MIN_H = 180;
const GROUP_CONTENT_SLACK = 1.45;
const GROUP_ASPECT = 1.4;

// ----- Public output shapes --------------------------------------------

export interface BlockRect {
	id: string;
	/** Top-left in canvas coords. */
	x: number;
	y: number;
	w: number;
	h: number;
	text: string;
	type: BlockType;
	importance: number;
	scale: number;
	opacity: number;
	pinned: boolean;
	groupId: string;
	source?: 'annotated' | 'refined' | 'manual';
	measured: MeasuredBlock;
}

export interface GroupRectOut {
	id: string;
	/** Top-left in canvas coords. */
	x: number;
	y: number;
	w: number;
	h: number;
	label: string;
	summary?: string;
	importance: number;
	childCount: number;
	/** Mini outline for the overview preview — child rects in group-local coords. */
	childPreview: { id: string; x: number; y: number; w: number; h: number }[];
	opacity: number;
}

export interface RectLayoutSnapshot {
	groups: GroupRectOut[];
	blocks: BlockRect[];
	mode: RectLayoutMode;
	drilledGroupId: string | null;
}

export type RectLayoutMode = 'overview' | 'drill';

export interface RectLayoutOptions {
	measurer: Measurer;
	bounds: { width: number; height: number };
}

// ----- Internal slots --------------------------------------------------

interface ChildSlot {
	id: string;
	/** Center in group-local coords (origin = group top-left). */
	x: number;
	y: number;
	w: number;
	h: number;
	vx: number;
	vy: number;
	rx: number;
	ry: number;
	scale: number;
	pinned: boolean;
	measured: MeasuredBlock;
	block: ContentBlock;
	spawnTime: number;
}

interface GroupSlot {
	id: string;
	group: Group;
	/** Center in canvas coords. */
	x: number;
	y: number;
	w: number;
	h: number;
	vx: number;
	vy: number;
	rx: number;
	ry: number;
	pinned: boolean;
	children: ChildSlot[];
	spawnTime: number;
	overviewSettled: boolean;
	drillSettled: boolean;
}

type WasmApi = {
	rect_step(
		x: Float32Array,
		y: Float32Array,
		w: Float32Array,
		h: Float32Array,
		vx: Float32Array,
		vy: Float32Array,
		bounds_x: number,
		bounds_y: number,
		bounds_w: number,
		bounds_h: number,
		repulsion: number,
		damping: number,
		dt: number,
	): Float32Array;
};

// ----- The layout ------------------------------------------------------

export class RectLayout {
	private measurer: Measurer;
	private bounds: { width: number; height: number };
	private mode: RectLayoutMode = 'overview';
	private drilledGroupId: string | null = null;
	private groups = new Map<string, GroupSlot>();
	private blockToGroup = new Map<string, string>();
	private fallbackGroupId = 'g-unsorted';

	constructor(opts: RectLayoutOptions) {
		this.measurer = opts.measurer;
		this.bounds = opts.bounds;
	}

	// ----- Mutators -----

	addGroup(group: Group): void {
		const existing = this.groups.get(group.id);
		if (existing) {
			existing.group = { ...existing.group, ...group };
			return;
		}
		const { x, y } = this.spawnGroupPosition(this.groups.size);
		const slot: GroupSlot = {
			id: group.id,
			group,
			x,
			y,
			w: GROUP_MIN_W,
			h: GROUP_MIN_H,
			vx: 0,
			vy: 0,
			rx: x,
			ry: y,
			pinned: false,
			children: [],
			spawnTime: now(),
			overviewSettled: false,
			drillSettled: false,
		};
		this.groups.set(group.id, slot);
		// New arrival means existing groups need to make room.
		for (const g of this.groups.values()) g.overviewSettled = false;
	}

	addBlock(block: ContentBlock): void {
		const groupId = block.groupId ?? this.fallbackGroupId;
		if (!this.groups.has(groupId)) {
			this.addGroup({ id: groupId, label: humanizeId(groupId) });
		}
		const groupSlot = this.groups.get(groupId)!;
		if (groupSlot.children.find((c) => c.id === block.id)) return;

		const measured = this.measurer.measureOne(block, 320);
		if (!measured) return;
		const w = Math.max(BLOCK_MIN_W, measured.width + BLOCK_PAD_X * 2);
		const h = Math.max(BLOCK_MIN_H, measured.height + BLOCK_PAD_TOP + BLOCK_PAD_BOTTOM);

		const cached = groupSlot.group.childPositions?.[block.id];
		const childIdx = groupSlot.children.length;
		const spawn = cached ?? this.spawnChildPosition(groupSlot, childIdx);
		const cx = spawn.x;
		const cy = spawn.y;
		const child: ChildSlot = {
			id: block.id,
			x: cx,
			y: cy,
			w,
			h,
			vx: 0,
			vy: 0,
			rx: cx,
			ry: cy,
			scale: block.scale ?? 1,
			pinned: block.pinned ?? false,
			measured,
			block,
			spawnTime: now(),
		};
		groupSlot.children.push(child);
		this.blockToGroup.set(block.id, groupId);
		this.recomputeGroupSize(groupSlot);
		groupSlot.overviewSettled = false;
		groupSlot.drillSettled = false;
	}

	updateBlockText(id: string, text: string): void {
		const groupId = this.blockToGroup.get(id);
		if (!groupId) return;
		const slot = this.groups.get(groupId);
		const child = slot?.children.find((c) => c.id === id);
		if (!slot || !child) return;
		child.block = { ...child.block, text };
		const measured = this.measurer.measureOne(child.block, 320);
		if (measured) {
			child.measured = measured;
			child.w = Math.max(BLOCK_MIN_W, measured.width + BLOCK_PAD_X * 2) * child.scale;
			child.h =
				Math.max(BLOCK_MIN_H, measured.height + BLOCK_PAD_TOP + BLOCK_PAD_BOTTOM) * child.scale;
		}
		this.recomputeGroupSize(slot);
		slot.drillSettled = false;
		slot.overviewSettled = false;
	}

	scaleBlock(id: string, factor: number): void {
		const groupId = this.blockToGroup.get(id);
		if (!groupId) return;
		const slot = this.groups.get(groupId);
		const child = slot?.children.find((c) => c.id === id);
		if (!slot || !child) return;
		const next = Math.max(0.4, Math.min(4, child.scale * factor));
		if (next === child.scale) return;
		const ratio = next / child.scale;
		child.scale = next;
		child.w *= ratio;
		child.h *= ratio;
		this.recomputeGroupSize(slot);
		slot.drillSettled = false;
	}

	setBlockPinned(id: string, pinned: boolean): void {
		const groupId = this.blockToGroup.get(id);
		if (!groupId) return;
		const slot = this.groups.get(groupId);
		const child = slot?.children.find((c) => c.id === id);
		if (!slot || !child) return;
		child.pinned = pinned;
		child.block = { ...child.block, pinned };
		if (!pinned) {
			slot.drillSettled = false;
			slot.overviewSettled = false;
		}
	}

	setBlockImportance(id: string, importance: number): void {
		const groupId = this.blockToGroup.get(id);
		if (!groupId) return;
		const slot = this.groups.get(groupId);
		const child = slot?.children.find((c) => c.id === id);
		if (!slot || !child) return;
		const next = Math.max(0, Math.min(1, importance));
		if (next === child.block.importance) return;
		child.block = { ...child.block, importance: next };
	}

	setBlockType(id: string, type: ContentBlock['type']): void {
		const groupId = this.blockToGroup.get(id);
		if (!groupId) return;
		const slot = this.groups.get(groupId);
		const child = slot?.children.find((c) => c.id === id);
		if (!slot || !child) return;
		if (child.block.type === type) return;
		child.block = { ...child.block, type };
	}

	setGroupLabel(id: string, label: string): void {
		const slot = this.groups.get(id);
		if (!slot) return;
		slot.group = { ...slot.group, label };
	}

	setGroupSummary(id: string, summary: string | undefined): void {
		const slot = this.groups.get(id);
		if (!slot) return;
		slot.group = { ...slot.group, summary };
	}

	setGroupImportance(id: string, importance: number): void {
		const slot = this.groups.get(id);
		if (!slot) return;
		const next = Math.max(0, Math.min(1, importance));
		slot.group = { ...slot.group, importance: next };
	}

	/**
	 * Add a blank user-authored block to a group. Returns the generated id.
	 * Used by `+ Block` toolbar action.
	 */
	addBlankBlock(groupId: string, type: ContentBlock['type'] = 'task'): string | null {
		if (!this.groups.has(groupId)) return null;
		const id = `manual-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
		this.addBlock({
			id,
			text: '',
			type,
			importance: 0.5,
			groupId,
			source: 'manual',
		});
		return id;
	}

	/**
	 * Add a blank user-authored group. Returns the generated id. Used by
	 * `+ Group` toolbar action.
	 */
	addBlankGroup(label = 'New phase'): string {
		const id = `g-manual-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
		this.addGroup({ id, label, importance: 0.5 });
		return id;
	}

	/**
	 * Duplicate a block in the same group. Returns the new id, or null if
	 * the source can't be found.
	 */
	duplicateBlock(id: string): string | null {
		const groupId = this.blockToGroup.get(id);
		if (!groupId) return null;
		const slot = this.groups.get(groupId);
		const child = slot?.children.find((c) => c.id === id);
		if (!slot || !child) return null;
		const newId = `${id}-copy-${Date.now().toString(36)}`;
		this.addBlock({
			...child.block,
			id: newId,
			source: 'manual',
			refinedFrom: [id],
		});
		return newId;
	}

	removeBlock(id: string): void {
		const groupId = this.blockToGroup.get(id);
		if (!groupId) return;
		const slot = this.groups.get(groupId);
		if (!slot) return;
		slot.children = slot.children.filter((c) => c.id !== id);
		this.blockToGroup.delete(id);
		this.recomputeGroupSize(slot);
		slot.drillSettled = false;
		slot.overviewSettled = false;
	}

	removeGroup(id: string): void {
		const slot = this.groups.get(id);
		if (!slot) return;
		for (const child of slot.children) this.blockToGroup.delete(child.id);
		this.groups.delete(id);
		if (this.drilledGroupId === id) {
			this.drilledGroupId = null;
			this.mode = 'overview';
		}
	}

	moveBlock(id: string, toGroupId: string): void {
		const fromId = this.blockToGroup.get(id);
		if (!fromId || fromId === toGroupId) return;
		const from = this.groups.get(fromId);
		if (!from) return;
		const child = from.children.find((c) => c.id === id);
		if (!child) return;
		from.children = from.children.filter((c) => c.id !== id);
		this.recomputeGroupSize(from);
		// Clear cached position on the source group so its drill resettles.
		if (from.group.childPositions) delete from.group.childPositions[id];
		from.drillSettled = false;
		from.overviewSettled = false;

		if (!this.groups.has(toGroupId)) {
			this.addGroup({ id: toGroupId, label: humanizeId(toGroupId) });
		}
		const to = this.groups.get(toGroupId)!;
		const spawn = this.spawnChildPosition(to, to.children.length);
		child.x = spawn.x;
		child.y = spawn.y;
		child.rx = child.x;
		child.ry = child.y;
		child.vx = 0;
		child.vy = 0;
		child.block = { ...child.block, groupId: toGroupId };
		to.children.push(child);
		this.blockToGroup.set(id, toGroupId);
		this.recomputeGroupSize(to);
		to.drillSettled = false;
		to.overviewSettled = false;
	}

	// ----- Mode + bounds -----

	setBounds(bounds: { width: number; height: number }): void {
		this.bounds = bounds;
		// Wake overview so groups re-clamp into the new bounds.
		for (const g of this.groups.values()) g.overviewSettled = false;
	}

	getMode(): RectLayoutMode {
		return this.mode;
	}

	getDrilledGroupId(): string | null {
		return this.drilledGroupId;
	}

	drillInto(groupId: string): void {
		if (!this.groups.has(groupId)) return;
		// Persist current child positions on the previously-drilled group.
		this.persistDrillState();
		this.mode = 'drill';
		this.drilledGroupId = groupId;
		const slot = this.groups.get(groupId);
		if (slot) slot.drillSettled = false;
	}

	exitDrill(): void {
		this.persistDrillState();
		this.mode = 'overview';
		this.drilledGroupId = null;
		// Wake overview so groups react to potentially-resized parent.
		for (const g of this.groups.values()) g.overviewSettled = false;
	}

	private persistDrillState(): void {
		if (!this.drilledGroupId) return;
		const slot = this.groups.get(this.drilledGroupId);
		if (!slot) return;
		const positions: Record<string, { x: number; y: number }> = {};
		for (const child of slot.children) positions[child.id] = { x: child.x, y: child.y };
		slot.group.childPositions = positions;
	}

	// ----- Step + render -----

	step(): RectLayoutSnapshot {
		const wasm = getWasm() as unknown as WasmApi;
		// Overview always steps so groups separate. Drill steps the focused
		// group; in overview mode we still step EVERY group's drill sim so the
		// child preview rectangles are accurate (otherwise children stay
		// stacked at their spawn position and the preview reads as overlap).
		if (this.mode === 'overview') {
			this.stepOverview(wasm);
			for (const g of this.groups.values()) {
				if (g.children.length > 1) this.stepGroupChildren(wasm, g);
			}
		} else {
			this.stepDrill(wasm);
		}

		// Smoothing — render positions lerp toward physics targets each frame.
		for (const g of this.groups.values()) {
			g.rx += (g.x - g.rx) * SMOOTH_ALPHA;
			g.ry += (g.y - g.ry) * SMOOTH_ALPHA;
			for (const c of g.children) {
				c.rx += (c.x - c.rx) * SMOOTH_ALPHA;
				c.ry += (c.y - c.ry) * SMOOTH_ALPHA;
			}
		}
		return this.snapshot();
	}

	private stepGroupChildren(wasm: WasmApi, group: GroupSlot): void {
		if (group.drillSettled) return;
		// Pinned children: skip from the sim entirely so they hold position.
		const children = group.children.filter((c) => !c.pinned);
		if (children.length === 0) {
			group.drillSettled = true;
			return;
		}
		const contentX = GROUP_PAD;
		const contentY = GROUP_HEADER_H;
		const contentW = Math.max(BLOCK_MIN_W, group.w - GROUP_PAD * 2);
		const contentH = Math.max(BLOCK_MIN_H, group.h - GROUP_HEADER_H - GROUP_PAD);
		const n = children.length;
		const x = new Float32Array(n);
		const y = new Float32Array(n);
		const w = new Float32Array(n);
		const h = new Float32Array(n);
		const vx = new Float32Array(n);
		const vy = new Float32Array(n);
		for (let i = 0; i < n; i++) {
			x[i] = children[i].x;
			y[i] = children[i].y;
			w[i] = children[i].w;
			h[i] = children[i].h;
			vx[i] = children[i].vx;
			vy[i] = children[i].vy;
		}
		const next = wasm.rect_step(
			x,
			y,
			w,
			h,
			vx,
			vy,
			contentX,
			contentY,
			contentW,
			contentH,
			REPULSION,
			DAMPING,
			DT,
		);
		let velSum = 0;
		for (let i = 0; i < n; i++) {
			const c = children[i];
			c.x = next[i * 4];
			c.y = next[i * 4 + 1];
			c.vx = next[i * 4 + 2];
			c.vy = next[i * 4 + 3];
			if (Math.abs(c.vx) < VELOCITY_SNAP) c.vx = 0;
			if (Math.abs(c.vy) < VELOCITY_SNAP) c.vy = 0;
			velSum += c.vx * c.vx + c.vy * c.vy;
		}
		if (Math.sqrt(velSum / n) < FREEZE_VEL_THRESHOLD) {
			for (const c of children) {
				c.vx = 0;
				c.vy = 0;
			}
			group.drillSettled = true;
		}
	}

	private stepOverview(wasm: WasmApi): void {
		const slots = Array.from(this.groups.values());
		if (slots.length === 0) return;
		const allSettled = slots.every((s) => s.overviewSettled);
		if (allSettled) return;

		// World bounds: large enough to fit all groups with breathing room.
		// Independent of the viewport — the camera (auto-fit) handles
		// showing the resulting layout. Without this, N groups whose summed
		// extent exceeds the viewport are physically forced to overlap.
		const world = this.computeWorldBounds(slots);

		const n = slots.length;
		const x = new Float32Array(n);
		const y = new Float32Array(n);
		const w = new Float32Array(n);
		const h = new Float32Array(n);
		const vx = new Float32Array(n);
		const vy = new Float32Array(n);
		for (let i = 0; i < n; i++) {
			x[i] = slots[i].x;
			y[i] = slots[i].y;
			w[i] = slots[i].w;
			h[i] = slots[i].h;
			vx[i] = slots[i].vx;
			vy[i] = slots[i].vy;
		}
		const next = wasm.rect_step(
			x,
			y,
			w,
			h,
			vx,
			vy,
			world.x,
			world.y,
			world.w,
			world.h,
			REPULSION,
			DAMPING,
			DT,
		);
		let velSum = 0;
		for (let i = 0; i < n; i++) {
			const slot = slots[i];
			if (!slot.pinned) {
				slot.x = next[i * 4];
				slot.y = next[i * 4 + 1];
				slot.vx = next[i * 4 + 2];
				slot.vy = next[i * 4 + 3];
				if (Math.abs(slot.vx) < VELOCITY_SNAP) slot.vx = 0;
				if (Math.abs(slot.vy) < VELOCITY_SNAP) slot.vy = 0;
			} else {
				slot.vx = 0;
				slot.vy = 0;
			}
			velSum += slot.vx * slot.vx + slot.vy * slot.vy;
		}
		if (Math.sqrt(velSum / n) < FREEZE_VEL_THRESHOLD) {
			for (const slot of slots) {
				slot.vx = 0;
				slot.vy = 0;
				slot.overviewSettled = true;
			}
		}
	}

	/**
	 * Bounds for the overview sim. Sized to the summed area of all groups
	 * with packing slack, so they can spread freely. The renderer's camera
	 * fits this world into the viewport — this is NOT the visible canvas.
	 */
	private computeWorldBounds(slots: GroupSlot[]): {
		x: number;
		y: number;
		w: number;
		h: number;
	} {
		let totalArea = 0;
		let maxW = 0;
		let maxH = 0;
		for (const s of slots) {
			totalArea += s.w * s.h;
			if (s.w > maxW) maxW = s.w;
			if (s.h > maxH) maxH = s.h;
		}
		// 1.6× slack so the sim has elbow room to settle without forced overlap.
		const target = totalArea * 1.6;
		const aspect = Math.max(1, this.bounds.width / Math.max(1, this.bounds.height));
		const w = Math.max(this.bounds.width, maxW * 2.4, Math.sqrt(target * aspect));
		const h = Math.max(this.bounds.height, maxH * 2.4, target / w);
		// Centered on the same anchor groups spawn around (canvas center).
		const cx = this.bounds.width / 2;
		const cy = this.bounds.height / 2;
		return { x: cx - w / 2, y: cy - h / 2, w, h };
	}

	private stepDrill(wasm: WasmApi): void {
		if (!this.drilledGroupId) return;
		const group = this.groups.get(this.drilledGroupId);
		if (!group) return;
		this.stepGroupChildren(wasm, group);
	}

	// ----- Snapshot for renderer -----

	snapshot(): RectLayoutSnapshot {
		const t = now();
		const groups: GroupRectOut[] = [];
		const blocks: BlockRect[] = [];
		for (const slot of this.groups.values()) {
			const groupX = slot.rx - slot.w / 2;
			const groupY = slot.ry - slot.h / 2;
			const fadeIn = ageFadeIn(t, slot.spawnTime);
			const childPreview = slot.children.map((c) => ({
				id: c.id,
				x: c.x - c.w / 2,
				y: c.y - c.h / 2,
				w: c.w,
				h: c.h,
			}));
			groups.push({
				id: slot.id,
				x: groupX,
				y: groupY,
				w: slot.w,
				h: slot.h,
				label: slot.group.label,
				summary: slot.group.summary,
				importance: this.groupImportance(slot),
				childCount: slot.children.length,
				childPreview,
				opacity: fadeIn,
			});
			for (const c of slot.children) {
				blocks.push({
					id: c.id,
					x: groupX + (c.rx - c.w / 2),
					y: groupY + (c.ry - c.h / 2),
					w: c.w,
					h: c.h,
					text: c.block.text,
					type: c.block.type,
					importance: c.block.importance,
					scale: c.scale,
					opacity: ageFadeIn(t, c.spawnTime),
					pinned: c.pinned,
					groupId: slot.id,
					source: c.block.source,
					measured: c.measured,
				});
			}
		}
		return {
			groups,
			blocks,
			mode: this.mode,
			drilledGroupId: this.drilledGroupId,
		};
	}

	getGroupRectById(id: string): GroupRectOut | null {
		const snap = this.snapshot();
		return snap.groups.find((g) => g.id === id) ?? null;
	}

	energy(): number {
		let max = 0;
		for (const slot of this.groups.values()) {
			const dx = slot.x - slot.rx;
			const dy = slot.y - slot.ry;
			max = Math.max(max, Math.abs(dx) + Math.abs(dy));
			for (const c of slot.children) {
				max = Math.max(max, Math.abs(c.x - c.rx) + Math.abs(c.y - c.ry));
				max = Math.max(max, Math.abs(c.vx) + Math.abs(c.vy));
			}
		}
		return max;
	}

	getStructure(): { blocks: ContentBlock[]; groups: Group[] } {
		const blocks: ContentBlock[] = [];
		const groups: Group[] = [];
		for (const slot of this.groups.values()) {
			groups.push(slot.group);
			for (const c of slot.children) blocks.push({ ...c.block, scale: c.scale, pinned: c.pinned });
		}
		return { blocks, groups };
	}

	/**
	 * Serialize the layout's full editable state. Caches every child's
	 * current position onto its parent group (via `childPositions`) so
	 * `restore()` can replay them exactly.
	 */
	serialize(): { blocks: ContentBlock[]; groups: Group[] } {
		for (const slot of this.groups.values()) {
			const positions: Record<string, { x: number; y: number }> = {};
			for (const c of slot.children) positions[c.id] = { x: c.x, y: c.y };
			slot.group = { ...slot.group, childPositions: positions };
		}
		return this.getStructure();
	}

	/** Replace the layout with a previously-serialized structure. */
	restore(blocks: ContentBlock[], groups: Group[]): void {
		this.groups.clear();
		this.blockToGroup.clear();
		this.drilledGroupId = null;
		this.mode = 'overview';
		for (const g of groups) this.addGroup(g);
		for (const b of blocks) this.addBlock(b);
		for (const slot of this.groups.values()) {
			slot.overviewSettled = false;
			slot.drillSettled = false;
		}
	}

	// ----- Helpers -----

	/**
	 * Spawn each new group on a ring around canvas center, stepping by a
	 * golden-angle so any number of groups end up roughly evenly spaced
	 * without needing to know N up front. Far better starting state for the
	 * sim than spawning everyone at the center.
	 */
	private spawnGroupPosition(idx: number): { x: number; y: number } {
		const cx = this.bounds.width / 2;
		const cy = this.bounds.height / 2;
		if (idx === 0) return { x: cx, y: cy };
		const radius = Math.min(this.bounds.width, this.bounds.height) * 0.32;
		// Golden angle gives good spread for any N.
		const angle = idx * 2.39996;
		return {
			x: cx + Math.cos(angle) * radius,
			y: cy + Math.sin(angle) * radius,
		};
	}

	/**
	 * Spawn each new child in a different quadrant of the parent's content
	 * area on a golden-angle ring, so the drill sim doesn't have to first
	 * separate a stack of children all at the parent's center.
	 */
	private spawnChildPosition(group: GroupSlot, idx: number): { x: number; y: number } {
		const cx = group.w / 2;
		const cy = (GROUP_HEADER_H + group.h) / 2;
		if (idx === 0) return { x: cx, y: cy };
		const ringX = (group.w - GROUP_PAD * 2) * 0.28;
		const ringY = (group.h - GROUP_HEADER_H - GROUP_PAD) * 0.28;
		const angle = idx * 2.39996;
		return {
			x: cx + Math.cos(angle) * ringX,
			y: cy + Math.sin(angle) * ringY,
		};
	}

	private recomputeGroupSize(slot: GroupSlot): void {
		const n = slot.children.length;
		if (n === 0) {
			slot.w = GROUP_MIN_W;
			slot.h = GROUP_MIN_H;
			return;
		}
		let totalArea = 0;
		let maxChildW = 0;
		let maxChildH = 0;
		for (const c of slot.children) {
			totalArea += c.w * c.h;
			if (c.w > maxChildW) maxChildW = c.w;
			if (c.h > maxChildH) maxChildH = c.h;
		}

		// Tile-grid minimum: pretend we're packing N rectangles of the worst-
		// case child size into rows and columns with a gap. The sim's MTV
		// separation can't *create* room — if the content area is too narrow
		// to fit even 2 children side-by-side when all blocks are wide, they
		// physically have to overlap. Pick (cols, rows) that fit and target
		// the group's preferred aspect ratio.
		const gap = 16;
		const cellW = maxChildW + gap;
		const cellH = maxChildH + gap;
		// cols × rows ≥ N, optimize cols ≈ sqrt(N · cellH · aspect / cellW)
		const idealCols = Math.max(
			1,
			Math.round(Math.sqrt((n * cellH * GROUP_ASPECT) / cellW)),
		);
		const cols = Math.max(1, Math.min(idealCols, n));
		const rows = Math.ceil(n / cols);
		const tileContentW = cols * cellW + gap;
		const tileContentH = rows * cellH + gap;

		// Area-based estimate (covers the case where children vary a lot in
		// size — small ones tile tightly while big ones eat their share).
		const target = totalArea * GROUP_CONTENT_SLACK;
		const areaW = Math.sqrt(target * GROUP_ASPECT);
		const areaH = target / Math.max(1, areaW);

		const contentW = Math.max(tileContentW, areaW);
		const contentH = Math.max(tileContentH, areaH);
		slot.w = Math.max(GROUP_MIN_W, Math.ceil(contentW + GROUP_PAD * 2));
		slot.h = Math.max(GROUP_MIN_H, Math.ceil(contentH + GROUP_HEADER_H + GROUP_PAD));
	}

	private groupImportance(slot: GroupSlot): number {
		if (slot.group.importance != null) return slot.group.importance;
		let max = 0;
		for (const c of slot.children) {
			const v = c.block.importance * c.scale;
			if (v > max) max = v;
		}
		return max;
	}
}

function ageFadeIn(t: number, spawn: number): number {
	const age = t - spawn;
	return Math.min(1, Math.max(0, age / FADE_IN_MS));
}

function humanizeId(id: string): string {
	return id
		.replace(/^g-/, '')
		.replace(/[-_]+/g, ' ')
		.replace(/\b\w/g, (c) => c.toUpperCase());
}

function now(): number {
	return typeof performance !== 'undefined' ? performance.now() : Date.now();
}
