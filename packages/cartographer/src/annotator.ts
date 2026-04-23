import type { ResponseStructure } from './types.js';

export interface AnnotatorOptions {
	apiKey: string;
	model?: string;
}

const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';

const SYSTEM_PROMPT = `You are a parser that decomposes an LLM response into spatial blocks.

Return ONLY a JSON object matching this TypeScript shape (no prose, no code fences):

{
  "blocks": Array<{
    "id": string,
    "text": string,
    "type": "recommendation" | "alternative" | "code" | "explanation" | "caveat" | "pro" | "con" | "step" | "context" | "question",
    "importance": number,
    "language"?: string,
    "groupId"?: string
  }>,
  "relationships": Array<{
    "from": string,
    "to": string,
    "type": "qualifies" | "supports" | "contradicts" | "implements" | "alternative_to"
  }>,
  "decision"?: {
    "question": string,
    "recommendation": string,
    "confidence": "strong" | "moderate" | "weak",
    "conditions": string[]
  }
}

Rules:
- ids are stable slugs like "rec-1", "alt-a", "code-1"
- importance is 0-1; the recommendation gets ~0.9, caveats ~0.3
- If the response is a question with a clear answer, populate decision{}
- Code blocks: set type="code" and include language
- Keep text verbatim from the source — do NOT paraphrase`;

export class Annotator {
	constructor(private options: AnnotatorOptions) {}

	async annotate(responseText: string): Promise<ResponseStructure> {
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
				system: SYSTEM_PROMPT,
				messages: [{ role: 'user', content: responseText }],
			}),
		});

		if (!res.ok) {
			const body = await res.text();
			throw new Error(`Annotator HTTP ${res.status}: ${body}`);
		}

		const data = (await res.json()) as { content: Array<{ type: string; text?: string }> };
		const textPart = data.content.find((p) => p.type === 'text' && p.text);
		if (!textPart?.text) throw new Error('Annotator returned no text block');

		return parseJsonResponse(textPart.text);
	}
}

/** Tolerant JSON parser — strips ``` fences, extracts first {...} block */
export function parseJsonResponse(raw: string): ResponseStructure {
	const stripped = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
	const start = stripped.indexOf('{');
	const end = stripped.lastIndexOf('}');
	if (start < 0 || end < 0) throw new Error('No JSON object in annotator output');
	const json = stripped.slice(start, end + 1);
	const parsed = JSON.parse(json) as ResponseStructure;

	if (!Array.isArray(parsed.blocks)) throw new Error('Missing blocks array');
	if (!Array.isArray(parsed.relationships)) parsed.relationships = [];
	return parsed;
}
