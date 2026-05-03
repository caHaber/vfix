import type {
	BlockRelationship,
	ContentBlock,
	DecisionSummary,
	Group,
	ResponseStructure,
} from './types.js';

export interface AnnotatorOptions {
	apiKey: string;
	model?: string;
}

const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';

const SYSTEM_PROMPT = `You decompose an LLM response into spatial blocks.

Output ONE JSON object per line, separated by newlines. No wrapping array. No prose. No code fences. No commas between lines. No trailing closing brackets or braces around the whole stream.

Line shapes (emit only the applicable ones):
{"kind":"block","id":"rec-1","text":"<verbatim>","type":"recommendation","importance":0.9,"groupId":"g-recommendation","language":"typescript"}
{"kind":"group","id":"g-recommendation","label":"Recommendation","summary":"..."}
{"kind":"relationship","from":"rec-1","to":"alt-1","type":"alternative_to"}
{"kind":"decision","question":"...","recommendation":"...","confidence":"strong","conditions":["..."]}

Block type: recommendation | alternative | code | explanation | caveat | pro | con | step | context | question
Relationship type: qualifies | supports | contradicts | implements | alternative_to
Confidence: strong | moderate | weak

Ordering: emit blocks first in source order, then groups, then relationships, then decision if applicable.

Rules:
- block.text MUST be verbatim from the source — do NOT paraphrase.
- block.id is a short stable slug like "rec-1", "alt-a", "pro-1", "code-1".
- block.importance is 0-1. Main recommendation ~0.9. Caveats ~0.3. Pros/cons ~0.6.
- EVERY block MUST have a groupId. Cluster related content into named sections.
  - Tradeoffs of one option: one group. Steps of a procedure: one group. Recommendation + caveats: one group.
  - groupIds are semantic slugs like "g-tradeoffs", "g-migration-steps". Not "group-1".
  - Standalone blocks get their own unique groupId.
- EVERY distinct groupId MUST have a matching {"kind":"group"} line with a 2-4 word Title Case label.
- Code blocks: type="code" and include "language".
- Keep lines compact; no pretty-printing whitespace inside values.`;

export type AnnotationEvent =
	| { kind: 'block'; block: ContentBlock }
	| { kind: 'group'; group: Group }
	| { kind: 'relationship'; relationship: BlockRelationship }
	| { kind: 'decision'; decision: DecisionSummary };

export class Annotator {
	constructor(private options: AnnotatorOptions) {}

	/** Stream newline-delimited JSON events from the model. Resolves when the stream closes. */
	async stream(
		text: string,
		onEvent: (ev: AnnotationEvent) => void,
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
			throw new Error(`Annotator HTTP ${res.status}: ${body}`);
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
					let parsed: {
						type?: string;
						delta?: { type?: string; text?: string };
					};
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

	/** Convenience wrapper: accumulate all streamed events into a ResponseStructure. */
	async annotate(text: string, signal?: AbortSignal): Promise<ResponseStructure> {
		const blocks: ContentBlock[] = [];
		const groups: Group[] = [];
		const relationships: BlockRelationship[] = [];
		let decision: DecisionSummary | undefined;

		await this.stream(
			text,
			(ev) => {
				switch (ev.kind) {
					case 'block':
						blocks.push(ev.block);
						break;
					case 'group':
						groups.push(ev.group);
						break;
					case 'relationship':
						relationships.push(ev.relationship);
						break;
					case 'decision':
						decision = ev.decision;
						break;
				}
			},
			signal,
		);

		const structure: ResponseStructure = { blocks, groups, relationships, decision };
		normalizeGroups(structure);
		return structure;
	}
}

function dispatchLine(raw: string, onEvent: (ev: AnnotationEvent) => void): void {
	let line = raw.trim();
	if (!line) return;
	// Strip a trailing comma Haiku sometimes emits between objects.
	if (line.endsWith(',')) line = line.slice(0, -1).trimEnd();
	// Skip stray closing/opening brackets or fences.
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
		const block: ContentBlock = {
			id: obj.id,
			text: obj.text,
			type: obj.type as ContentBlock['type'],
			importance: typeof obj.importance === 'number' ? obj.importance : 0.5,
			language: typeof obj.language === 'string' ? obj.language : undefined,
			groupId: typeof obj.groupId === 'string' ? obj.groupId : undefined,
		};
		onEvent({ kind: 'block', block });
	} else if (kind === 'group') {
		if (typeof obj.id !== 'string' || typeof obj.label !== 'string') return;
		const group: Group = {
			id: obj.id,
			label: obj.label,
			summary: typeof obj.summary === 'string' ? obj.summary : undefined,
		};
		onEvent({ kind: 'group', group });
	} else if (kind === 'relationship') {
		if (typeof obj.from !== 'string' || typeof obj.to !== 'string' || typeof obj.type !== 'string')
			return;
		onEvent({
			kind: 'relationship',
			relationship: {
				from: obj.from,
				to: obj.to,
				type: obj.type as BlockRelationship['type'],
			},
		});
	} else if (kind === 'decision') {
		if (typeof obj.recommendation !== 'string') return;
		onEvent({
			kind: 'decision',
			decision: {
				question: typeof obj.question === 'string' ? obj.question : '',
				recommendation: obj.recommendation,
				confidence: (obj.confidence as DecisionSummary['confidence']) ?? 'moderate',
				conditions: Array.isArray(obj.conditions) ? (obj.conditions as string[]) : [],
			},
		});
	}
}

/** Ensure every block has a groupId and every referenced groupId has a Group entry. */
export function normalizeGroups(structure: ResponseStructure): void {
	const groups = Array.isArray(structure.groups) ? [...structure.groups] : [];
	const byId = new Map(groups.map((g) => [g.id, g]));

	for (const b of structure.blocks) {
		if (!b.groupId) {
			b.groupId = `g-${b.id}`;
		}
		if (!byId.has(b.groupId)) {
			const fallback = { id: b.groupId, label: humanizeGroupId(b.groupId) };
			byId.set(b.groupId, fallback);
			groups.push(fallback);
		}
	}

	structure.groups = groups;
}

function humanizeGroupId(id: string): string {
	const stripped = id.replace(/^g-/, '').replace(/[-_]+/g, ' ').trim();
	if (!stripped) return 'Group';
	return stripped.charAt(0).toUpperCase() + stripped.slice(1);
}

/** Back-compat: parse the old single-object JSON format. */
export function parseJsonResponse(raw: string): ResponseStructure {
	const stripped = raw
		.replace(/^```(?:json)?\s*/i, '')
		.replace(/\s*```$/i, '')
		.trim();
	const start = stripped.indexOf('{');
	const end = stripped.lastIndexOf('}');
	if (start < 0 || end < 0) throw new Error('No JSON object in annotator output');
	const json = stripped.slice(start, end + 1);
	const parsed = JSON.parse(json) as ResponseStructure;
	if (!Array.isArray(parsed.blocks)) throw new Error('Missing blocks array');
	if (!Array.isArray(parsed.relationships)) parsed.relationships = [];
	normalizeGroups(parsed);
	return parsed;
}
