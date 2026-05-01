import type { LLMConfig } from '../types.js';

export async function callAnthropic(config: LLMConfig, system: string, user: string): Promise<string> {
	const endpoint = config.endpoint ?? 'https://api.anthropic.com/v1/messages';
	const res = await fetch(endpoint, {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			'x-api-key': config.apiKey ?? '',
			'anthropic-version': '2023-06-01',
			'anthropic-dangerous-direct-browser-access': 'true',
		},
		body: JSON.stringify({
			model: config.model,
			max_tokens: 1024,
			system,
			messages: [{ role: 'user', content: user }],
		}),
	});
	if (!res.ok) {
		throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
	}
	const json = await res.json();
	const block = Array.isArray(json.content) ? json.content.find((b: { type: string }) => b.type === 'text') : null;
	return block?.text ?? '';
}
