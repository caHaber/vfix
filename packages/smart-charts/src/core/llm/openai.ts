import type { LLMConfig } from '../types.js';

export async function callOpenAI(config: LLMConfig, system: string, user: string): Promise<string> {
	const endpoint = config.endpoint ?? 'https://api.openai.com/v1/chat/completions';
	const res = await fetch(endpoint, {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			authorization: `Bearer ${config.apiKey ?? ''}`,
		},
		body: JSON.stringify({
			model: config.model,
			messages: [
				{ role: 'system', content: system },
				{ role: 'user', content: user },
			],
			response_format: { type: 'json_object' },
			temperature: 0.2,
		}),
	});
	if (!res.ok) {
		throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
	}
	const json = await res.json();
	return json.choices?.[0]?.message?.content ?? '';
}
