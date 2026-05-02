/**
 * Shelf packer: a simple online 2D packer suitable for monotonically growing
 * glyph atlases.
 *
 * The atlas is divided into horizontal "shelves" of varying heights. New
 * glyphs go onto a shelf whose height is ≥ the glyph's height; if no shelf
 * fits, a new shelf is started below the previous one. Glyphs within a shelf
 * are packed left-to-right.
 *
 * Tradeoffs:
 *   - Wasted vertical space per shelf (glyphs shorter than shelf height).
 *   - But: zero per-allocation cost, deterministic, easy to reason about.
 *   - Eviction is impossible without rebuilding (a removed glyph leaves a
 *     hole that we can't reuse). The cache layer handles eviction by
 *     occasionally calling `reset()` and re-rasterizing live entries.
 */
export interface PackedRect {
	x: number;
	y: number;
	width: number;
	height: number;
}

interface Shelf {
	y: number;
	height: number;
	cursorX: number;
}

export class ShelfPacker {
	readonly width: number;
	readonly height: number;
	private shelves: Shelf[] = [];
	private nextShelfY = 0;

	constructor(width: number, height: number) {
		this.width = width;
		this.height = height;
	}

	pack(w: number, h: number): PackedRect | null {
		if (w <= 0 || h <= 0) return { x: 0, y: 0, width: 0, height: 0 };
		if (w > this.width || h > this.height) return null;

		// Try to fit on an existing shelf — pick the shortest one that fits.
		let bestShelf: Shelf | null = null;
		let bestWaste = Infinity;
		for (const s of this.shelves) {
			if (s.height < h) continue;
			if (s.cursorX + w > this.width) continue;
			const waste = s.height - h;
			if (waste < bestWaste) {
				bestWaste = waste;
				bestShelf = s;
			}
		}
		if (bestShelf) {
			const x = bestShelf.cursorX;
			const y = bestShelf.y;
			bestShelf.cursorX += w;
			return { x, y, width: w, height: h };
		}

		// Need a new shelf. Round shelf height up by a small slack so similar
		// glyphs share the shelf instead of fragmenting.
		const shelfHeight = Math.ceil(h * 1.05);
		if (this.nextShelfY + shelfHeight > this.height) return null;
		const shelf: Shelf = { y: this.nextShelfY, height: shelfHeight, cursorX: w };
		this.shelves.push(shelf);
		this.nextShelfY += shelfHeight;
		return { x: 0, y: shelf.y, width: w, height: h };
	}

	reset(): void {
		this.shelves = [];
		this.nextShelfY = 0;
	}

	usedBytes(): number {
		// Bookkeeping for the LRU rebuild trigger. R8 = 1 byte/px.
		let used = 0;
		for (const s of this.shelves) used += s.cursorX * s.height;
		return used;
	}
}
