import type { BlockType, ContentBlock, Group } from './types.js';

export interface PlanSerializeOptions {
	/** Block IDs to omit from the output (e.g. user-hidden). */
	hiddenIds?: ReadonlySet<string> | Set<string>;
	/** Optional plan title rendered as the H1. */
	title?: string;
	/**
	 * Per-block scale overrides (defaults to `block.scale ?? 1`). Importance
	 * × scale is the effective weight used for ordering, tiering, and the
	 * priority-marker assignment.
	 */
	scales?: Record<string, number>;
	/**
	 * If true, omit the `[P0]/[P1]/[P2]` inline markers + priority preamble
	 * (use only the tier headings). Default false — markers stay because
	 * they survive downstream LLM rewrites better than ordering alone.
	 */
	noPriorityMarkers?: boolean;
}

const TIER_MUST = 0.75;
const TIER_SHOULD = 0.4;
const LEAD_BOLD = 0.85;
const STAR_PHASE = 0.85;
const NOTE_THRESHOLD = 0.2;
const CRIT_PATH_MIN = 0.65;
const CRIT_PATH_MAX = 3;

/**
 * Serialize a plan map to actionable, priority-annotated markdown built for
 * downstream LLM execution.
 *
 * Importance is communicated four ways simultaneously, because LLMs read
 * order weakly but read explicit markers, headings, and bold reliably:
 *
 *   1. A "Critical path" callout at the top names the 1–3 highest-weight
 *      tasks across all phases.
 *   2. Inside each phase, tasks split into `### Must do` (≥0.75) /
 *      `### Should do` (0.4–0.74) / `### Nice to have` (<0.4) sub-headings.
 *   3. Every task gets an inline `[P0]/[P1]/[P2]` priority prefix that
 *      survives reformatting.
 *   4. Lead items (importance ≥0.85) render in **bold**; critical phases
 *      get a ⭐ prefix on their heading.
 *
 * The result reads as a prioritized brief, not a flat list — so the LLM
 * (and a human) can tell at a glance what's load-bearing.
 */
export function serializeToPlan(
	blocks: ContentBlock[],
	groups: Group[],
	opts: PlanSerializeOptions = {},
): string {
	const hidden = opts.hiddenIds ?? new Set<string>();
	const scales = opts.scales ?? {};
	const noMarkers = opts.noPriorityMarkers === true;
	const visible = blocks.filter((b) => !hidden.has(b.id));

	const byGroup = new Map<string, ContentBlock[]>();
	for (const b of visible) {
		const gid = b.groupId ?? '__loose';
		const arr = byGroup.get(gid) ?? [];
		arr.push(b);
		byGroup.set(gid, arr);
	}

	const orderedGroups = orderGroupsByImportance(groups, byGroup, scales);

	const out: string[] = [];
	if (opts.title) out.push(`# ${opts.title.trim()}`, '');

	if (!noMarkers) {
		out.push(
			'> **Priority markers:** `[P0]` = critical / must do, `[P1]` = should do, `[P2]` = nice to have. ⭐ on a phase = critical phase. **Bold** = lead item.',
			'',
		);
	}

	// Critical-path callout: top tasks across the whole plan, regardless of phase.
	const allTasks = rankByEffective(
		visible.filter((b) => b.type === 'task'),
		scales,
	);
	const critical = allTasks
		.slice(0, CRIT_PATH_MAX)
		.filter((t) => effective(t, scales) >= CRIT_PATH_MIN);
	if (critical.length > 0) {
		out.push('## ⭐ Critical path', '');
		out.push(
			critical.length === 1
				? 'The single highest-priority item across the plan:'
				: `If you only do these ${critical.length} items:`,
		);
		for (const t of critical) {
			const phase = groups.find((g) => g.id === t.groupId)?.label;
			out.push(`- **${t.text}**${phase ? ` _(${phase})_` : ''}`);
		}
		out.push('');
	}

	// Per-phase sections.
	for (const group of orderedGroups) {
		const members = byGroup.get(group.id) ?? [];
		if (members.length === 0) continue;

		const groupEff = groupEffective(group, members, scales);
		const star = groupEff >= STAR_PHASE ? '⭐ ' : '';
		out.push(`## ${star}${group.label}`);
		if (group.summary) out.push('', group.summary);
		out.push('');

		const ranked = rankByEffective(members, scales);
		const tasks = ranked.filter((b) => b.type === 'task');
		const mustTasks = tasks.filter((t) => effective(t, scales) >= TIER_MUST);
		const shouldTasks = tasks.filter((t) => {
			const e = effective(t, scales);
			return e < TIER_MUST && e >= TIER_SHOULD;
		});
		const noteTasks = tasks.filter((t) => effective(t, scales) < TIER_SHOULD);

		if (mustTasks.length > 0) {
			out.push('### Must do');
			for (const t of mustTasks) {
				out.push(formatTask(t, scales, 'P0', noMarkers));
			}
			out.push('');
		}
		if (shouldTasks.length > 0) {
			out.push('### Should do');
			for (const t of shouldTasks) {
				out.push(formatTask(t, scales, 'P1', noMarkers));
			}
			out.push('');
		}
		if (noteTasks.length > 0) {
			out.push('### Nice to have');
			for (const t of noteTasks) {
				const marker = noMarkers ? '' : '[P2] ';
				out.push(`- *${marker}${t.text}*`);
			}
			out.push('');
		}

		const constraints = ranked.filter((b) => b.type === 'constraint');
		if (constraints.length > 0) {
			out.push('**Constraints:**');
			for (const c of constraints) out.push(`- ${c.text}`);
			out.push('');
		}

		const rationales = ranked.filter((b) => b.type === 'rationale');
		if (rationales.length > 0) {
			out.push('> **Why:**');
			for (const r of rationales) out.push(`> ${r.text}`);
			out.push('');
		}

		const risks = ranked.filter((b) => b.type === 'risk');
		if (risks.length > 0) {
			out.push('> **Risks:**');
			for (const r of risks) {
				const e = effective(r, scales);
				const tag = e >= TIER_MUST ? '**[high risk]** ' : e >= TIER_SHOULD ? '[risk] ' : '';
				out.push(`> - ${tag}${r.text}`);
			}
			out.push('');
		}

		const criteria = ranked.filter((b) => b.type === 'success-criterion');
		if (criteria.length > 0) {
			out.push('**Done when:**');
			for (const c of criteria) out.push(`- ${c.text}`);
			out.push('');
		}

		const refs = ranked.filter((b) => b.type === 'reference');
		if (refs.length > 0) {
			out.push('**References:**');
			for (const r of refs) out.push(`- ${r.text}`);
			out.push('');
		}
	}

	// Tail sections aggregating cross-phase items, with priority preserved.
	const allOpenQs = rankByEffective(
		visible.filter((b) => b.type === 'open-question'),
		scales,
	);
	if (allOpenQs.length > 0) {
		out.push('## Open questions', '');
		for (const q of allOpenQs) {
			const phase = groups.find((g) => g.id === q.groupId)?.label;
			const e = effective(q, scales);
			const tag = e >= TIER_MUST ? '**[blocker]** ' : '';
			out.push(`- ${tag}${q.text}${phase ? ` _(${phase})_` : ''}`);
		}
		out.push('');
	}

	const allDeps = rankByEffective(
		visible.filter((b) => b.type === 'dependency'),
		scales,
	);
	if (allDeps.length > 0) {
		out.push('## Dependencies', '');
		for (const d of allDeps) {
			const phase = groups.find((g) => g.id === d.groupId)?.label;
			out.push(`- ${d.text}${phase ? ` _(${phase})_` : ''}`);
		}
		out.push('');
	}

	return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

function formatTask(
	t: ContentBlock,
	scales: Record<string, number>,
	marker: 'P0' | 'P1',
	noMarkers: boolean,
): string {
	const e = effective(t, scales);
	const text = e >= LEAD_BOLD ? `**${t.text}**` : t.text;
	if (noMarkers) {
		return e < NOTE_THRESHOLD ? `- *${text}*` : `- [ ] ${text}`;
	}
	return `- [ ] [${marker}] ${text}`;
}

function effective(b: ContentBlock, scales: Record<string, number>): number {
	const s = scales[b.id] ?? b.scale ?? 1;
	return b.importance * s;
}

function groupEffective(
	group: Group,
	members: ContentBlock[],
	scales: Record<string, number>,
): number {
	if (group.importance != null) return group.importance;
	let max = 0;
	for (const m of members) {
		const v = effective(m, scales);
		if (v > max) max = v;
	}
	return max;
}

function rankByEffective(blocks: ContentBlock[], scales: Record<string, number>): ContentBlock[] {
	return [...blocks].sort((a, b) => effective(b, scales) - effective(a, scales));
}

function orderGroupsByImportance(
	groups: Group[],
	byGroup: Map<string, ContentBlock[]>,
	scales: Record<string, number>,
): Group[] {
	return [...groups].sort(
		(a, b) =>
			groupEffective(b, byGroup.get(b.id) ?? [], scales) -
			groupEffective(a, byGroup.get(a.id) ?? [], scales),
	);
}

/** Type alias re-export so callers don't need to import from types.ts. */
export type PlanBlockType = Extract<
	BlockType,
	| 'phase'
	| 'task'
	| 'rationale'
	| 'risk'
	| 'open-question'
	| 'dependency'
	| 'success-criterion'
	| 'constraint'
	| 'reference'
>;
