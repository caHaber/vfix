import { callAnthropic } from './llm/anthropic.js';
import { heuristicSpec } from './llm/mock.js';
import { callOpenAI } from './llm/openai.js';
import { compactProfileForPrompt } from './profile-builder.js';
import type { EnhancementSpec, LLMConfig, StatisticalProfile } from './types.js';

const SYSTEM_PROMPT = `You are a data visualization expert. Given a compact statistical profile of a dataset and an optional user question, produce an EnhancementSpec as a single JSON object with these fields:

- chartType: one of "line", "bar", "scatter", "area", "histogram", "heatmap", "wordCloud", "sentimentBar"
- encoding: { x: string, y: string, color?: string, size?: string } — column names from the profile
- scales: { yScale?: "linear"|"log", yDomain?: [number, number] }
- annotations: array of { type: "callout"|"trendline"|"region"|"threshold", ...fields }
- emphasis: { rows: number[], reason: string }
- caption: string — one sentence explaining what the chart shows
- followUpQuestions: string[] (max 3)

Pick chart types informed by column types and the question. Use "wordCloud" or "sentimentBar" only when text columns are present. Respond with the JSON object only — no prose.`;

export interface EnhanceOptions {
	question?: string;
	llm?: LLMConfig;
}

export async function enhance(
	profile: StatisticalProfile,
	options: EnhanceOptions = {},
): Promise<EnhancementSpec> {
	const fallback = heuristicSpec(profile, options.question);
	if (!options.llm || options.llm.provider === 'mock') {
		return fallback;
	}
	const user = JSON.stringify({
		question: options.question ?? null,
		profile: JSON.parse(compactProfileForPrompt(profile)),
	});
	try {
		const raw =
			options.llm.provider === 'anthropic'
				? await callAnthropic(options.llm, SYSTEM_PROMPT, user)
				: await callOpenAI(options.llm, SYSTEM_PROMPT, user);
		const parsed = parseSpec(raw);
		return parsed ?? fallback;
	} catch (err) {
		console.warn('[smart-charts] LLM enhance failed, using heuristic:', err);
		return fallback;
	}
}

function parseSpec(raw: string): EnhancementSpec | null {
	const text = raw.trim();
	const start = text.indexOf('{');
	const end = text.lastIndexOf('}');
	if (start < 0 || end < 0) return null;
	let parsed: unknown;
	try {
		parsed = JSON.parse(text.slice(start, end + 1));
	} catch {
		return null;
	}
	if (!isSpec(parsed)) return null;
	return parsed;
}

function isSpec(value: unknown): value is EnhancementSpec {
	if (!value || typeof value !== 'object') return false;
	const v = value as Record<string, unknown>;
	if (typeof v.chartType !== 'string') return false;
	const allowed = [
		'line',
		'bar',
		'scatter',
		'area',
		'histogram',
		'heatmap',
		'wordCloud',
		'sentimentBar',
	];
	if (!allowed.includes(v.chartType)) return false;
	if (!v.encoding || typeof v.encoding !== 'object') return false;
	const enc = v.encoding as Record<string, unknown>;
	if (typeof enc.x !== 'string' || typeof enc.y !== 'string') return false;
	return true;
}
