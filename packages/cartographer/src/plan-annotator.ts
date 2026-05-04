import type { BlockType, ContentBlock, Group } from './types.js';

export interface PlanAnnotatorOptions {
	apiKey: string;
	model?: string;
}

const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';

/**
 * The plan-mode SYSTEM_PROMPT. Generative — the model normalizes input into
 * atomic, evenly-grained blocks of the plan ontology. Verbatim is NOT
 * preserved (the response-mode annotator preserved verbatim; plan mode
 * rewrites for clarity and atomicity).
 *
 * One phase = one group. Cross-phase items (open questions, dependencies)
 * still belong to the most relevant phase, but the serializer surfaces them
 * in their own tail sections.
 */
const SYSTEM_PROMPT = `You decompose a project plan into editable spatial blocks.

Output ONE JSON object per line, separated by newlines. No wrapping array. No prose. No code fences. No commas between lines. No trailing closing brackets or braces around the whole stream.

Line shapes (emit only the applicable ones):
{"kind":"group","id":"g-phase-1","label":"Phase 1: Discovery","summary":"...","importance":0.9}
{"kind":"block","id":"task-1","text":"...","type":"task","importance":0.8,"groupId":"g-phase-1"}

Block types (use exactly these, no others):
  phase              — top-level section header. Almost always its own group.
  task               — a concrete action item. Verb + outcome.
  rationale          — WHY a decision or task is what it is.
  risk               — what could go wrong.
  open-question      — needs a decision before proceeding.
  dependency         — depends on something external or another phase.
  success-criterion  — how you know a phase is done.
  constraint         — a fixed boundary the plan must respect.
  reference          — a link, document, or person to consult.

Rules:
- One PHASE per group. The group label is the phase name (e.g. "Phase 1: Discovery"). The group's importance is the aggregate weight of that phase.
- Each block belongs to exactly one group via groupId. Group ids are slugs like "g-phase-1", "g-implementation", "g-launch".
- Atomicity: each block is ONE clear idea — one task, one risk, one rationale. Break apart compound sentences. Don't restate the same idea in two blocks.
- Generative — DO NOT preserve verbatim. Rewrite for clarity, brevity, and concrete action. Drop hedges, filler, and repetition. Keep specific numbers, names, and technical terms exactly.
- Importance is 0.0–1.0 and MUST use the full range. Critical-path tasks 0.85+, supporting tasks 0.55–0.7, background notes 0.2–0.4. Don't paint everything 0.5.
- Tasks should start with a verb (Implement, Verify, Decide, Document, etc.) and name a concrete outcome.
- Rationales attach to the phase they justify. Risks and open-questions attach to the phase they affect.
- If the input is one short line ("ship the GDPR endpoint"), expand it into a real plan: 2–4 phases, each with 3–6 blocks of varied types.
- Block ids: short stable slugs like "task-postgres-cascade", "risk-vendor-sla". Unique across the whole plan.

Ordering (emit in this order):
1. All groups (one per phase) first, in plan order.
2. Then all blocks, ordered by phase, then within a phase by importance descending.

Be concise. Keep block.text under ~140 chars when possible.`;

export type PlanAnnotationEvent =
	| { kind: 'block'; block: ContentBlock }
	| { kind: 'group'; group: Group };

export class PlanAnnotator {
	constructor(private options: PlanAnnotatorOptions) {}

	/** Stream newline-delimited JSON events from the model. Resolves when the stream closes. */
	async stream(
		text: string,
		onEvent: (ev: PlanAnnotationEvent) => void,
		signal?: AbortSignal,
	): Promise<void> {
		const res = await fetch('https://api.anthropic.com/v1/messages', {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				'x-api-key': this.options.apiKey,
				'anthropic-version': '2023-06-01',
				'anthropic-dangerous-direct-browser-access': 'true',
			},
			body: JSON.stringify({
				model: this.options.model ?? DEFAULT_MODEL,
				max_tokens: 4096,
				stream: true,
				system: SYSTEM_PROMPT,
				messages: [{ role: 'user', content: text }],
			}),
			signal,
		});

		if (!res.ok || !res.body) {
			const body = await res.text().catch(() => '');
			throw new Error(`PlanAnnotator HTTP ${res.status}: ${body}`);
		}

		const reader = res.body.getReader();
		const decoder = new TextDecoder();
		let sseBuf = '';
		let lineBuf = '';

		try {
			while (true) {
				const { value, done } = await reader.read();
				if (done) break;
				sseBuf += decoder.decode(value, { stream: true });

				let sepIdx;
				while ((sepIdx = sseBuf.indexOf('\n\n')) >= 0) {
					const frame = sseBuf.slice(0, sepIdx);
					sseBuf = sseBuf.slice(sepIdx + 2);
					const dataLine = frame.split('\n').find((l) => l.startsWith('data: '));
					if (!dataLine) continue;
					let parsed: { type?: string; delta?: { type?: string; text?: string } };
					try {
						parsed = JSON.parse(dataLine.slice(6));
					} catch {
						continue;
					}
					if (
						parsed.type === 'content_block_delta' &&
						parsed.delta?.type === 'text_delta' &&
						typeof parsed.delta.text === 'string'
					) {
						lineBuf += parsed.delta.text;
						let nlIdx;
						while ((nlIdx = lineBuf.indexOf('\n')) >= 0) {
							const raw = lineBuf.slice(0, nlIdx);
							lineBuf = lineBuf.slice(nlIdx + 1);
							dispatchLine(raw, onEvent);
						}
					}
				}
			}
		} finally {
			try {
				reader.releaseLock();
			} catch {
				// already released
			}
		}

		if (lineBuf.trim()) dispatchLine(lineBuf, onEvent);
	}
}

const ALLOWED_TYPES: ReadonlySet<BlockType> = new Set<BlockType>([
	'phase',
	'task',
	'rationale',
	'risk',
	'open-question',
	'dependency',
	'success-criterion',
	'constraint',
	'reference',
]);

function dispatchLine(raw: string, onEvent: (ev: PlanAnnotationEvent) => void): void {
	let line = raw.trim();
	if (!line) return;
	if (line.endsWith(',')) line = line.slice(0, -1).trimEnd();
	if (!line.startsWith('{') || !line.endsWith('}')) return;

	let obj: Record<string, unknown>;
	try {
		obj = JSON.parse(line) as Record<string, unknown>;
	} catch {
		return;
	}

	const kind = obj.kind;
	if (kind === 'block') {
		if (typeof obj.id !== 'string' || typeof obj.text !== 'string' || typeof obj.type !== 'string')
			return;
		const type = ALLOWED_TYPES.has(obj.type as BlockType) ? (obj.type as BlockType) : 'task';
		const block: ContentBlock = {
			id: obj.id,
			text: obj.text,
			type,
			importance: typeof obj.importance === 'number' ? clamp01(obj.importance) : 0.5,
			groupId: typeof obj.groupId === 'string' ? obj.groupId : undefined,
			source: 'annotated',
		};
		onEvent({ kind: 'block', block });
	} else if (kind === 'group') {
		if (typeof obj.id !== 'string' || typeof obj.label !== 'string') return;
		const group: Group = {
			id: obj.id,
			label: obj.label,
			summary: typeof obj.summary === 'string' ? obj.summary : undefined,
			importance: typeof obj.importance === 'number' ? clamp01(obj.importance) : undefined,
		};
		onEvent({ kind: 'group', group });
	}
}

function clamp01(v: number): number {
	return Math.max(0, Math.min(1, v));
}
