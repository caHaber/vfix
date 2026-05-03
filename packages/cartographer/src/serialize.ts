import type { ContentBlock, Group, PositionedBlock, ResponseStructure } from './types.js';

export interface SerializeOptions {
	/** Omit blocks whose id is in this set */
	hiddenIds?: ReadonlySet<string>;
	/** If provided, sort blocks by spatial position (y then x) — otherwise by block order in the structure */
	positions?: PositionedBlock[];
}

/**
 * Serialize a structure back into a markdown prompt. Groups become `## Label` headers.
 * Code blocks preserve their language fence. Context blocks render as blockquotes.
 */
export function serializeToPrompt(
	structure: ResponseStructure,
	opts: SerializeOptions = {},
): string {
	const hidden = opts.hiddenIds ?? new Set<string>();
	const positionById = opts.positions ? new Map(opts.positions.map((p) => [p.id, p])) : null;

	const visible = structure.blocks.filter((b) => !hidden.has(b.id));
	if (visible.length === 0) return '';

	// Group blocks by groupId, preserving order of first appearance.
	const groupOrder: string[] = [];
	const byGroup = new Map<string, ContentBlock[]>();
	for (const b of visible) {
		const gid = b.groupId ?? `g-${b.id}`;
		if (!byGroup.has(gid)) {
			byGroup.set(gid, []);
			groupOrder.push(gid);
		}
		byGroup.get(gid)!.push(b);
	}

	// Sort groups by their centroid y (if positions available), else keep insertion order.
	if (positionById) {
		groupOrder.sort((a, b) => {
			return (
				groupCentroidY(byGroup.get(a)!, positionById) -
				groupCentroidY(byGroup.get(b)!, positionById)
			);
		});
		// Within each group, sort by (y, x).
		for (const members of byGroup.values()) {
			members.sort((x, y) => {
				const px = positionById.get(x.id);
				const py = positionById.get(y.id);
				if (!px || !py) return 0;
				return px.y - py.y || px.x - py.x;
			});
		}
	}

	const groupMeta = new Map((structure.groups ?? []).map((g) => [g.id, g]));
	const singletonGroupIds = new Set<string>();
	for (const [gid, members] of byGroup) {
		if (members.length === 1) singletonGroupIds.add(gid);
	}

	const lines: string[] = [];
	for (const gid of groupOrder) {
		const members = byGroup.get(gid)!;
		const meta = groupMeta.get(gid);

		if (!singletonGroupIds.has(gid) && meta?.label) {
			lines.push(`## ${meta.label}`);
			lines.push('');
		}

		for (const b of members) {
			lines.push(renderBlock(b));
			lines.push('');
		}
	}

	return (
		lines
			.join('\n')
			.replace(/\n{3,}/g, '\n\n')
			.trim() + '\n'
	);
}

function groupCentroidY(members: ContentBlock[], positions: Map<string, PositionedBlock>): number {
	let sum = 0;
	let n = 0;
	for (const b of members) {
		const p = positions.get(b.id);
		if (p) {
			sum += p.y;
			n += 1;
		}
	}
	return n > 0 ? sum / n : 0;
}

function renderBlock(b: ContentBlock): string {
	switch (b.type) {
		case 'code': {
			const lang = b.language ?? '';
			return `\`\`\`${lang}\n${b.text.replace(/\n+$/, '')}\n\`\`\``;
		}
		case 'context':
			return b.text
				.split('\n')
				.map((line) => `> ${line}`)
				.join('\n');
		case 'question':
			return `**Question:** ${b.text}`;
		case 'caveat':
			return `> Caveat: ${b.text}`;
		default:
			return b.text;
	}
}

export function groupsFromStructure(structure: ResponseStructure): Group[] {
	return structure.groups ?? [];
}
