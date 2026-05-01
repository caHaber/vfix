import { adapt, type AdaptedData } from './data-adapter.js';
import { enhance, type EnhanceOptions } from './enhancer.js';
import { buildProfile } from './stats-engine.js';
import type { EnhancementSpec, LLMConfig, Row, StatisticalProfile } from './types.js';
import { loadWasmStats } from './wasm-bridge.js';

export interface SessionOptions {
	data: Row[];
	llm?: LLMConfig;
	wasm: () => Promise<unknown>; // import('@vfir/wasm-stats') or stub
}

export class SmartChartSession {
	private adapted: AdaptedData;
	private llm?: LLMConfig;
	private loader: () => Promise<unknown>;
	private profileCache: StatisticalProfile | null = null;

	constructor(options: SessionOptions) {
		this.adapted = adapt(options.data);
		this.llm = options.llm;
		this.loader = options.wasm;
	}

	async analyze(): Promise<StatisticalProfile> {
		if (this.profileCache) return this.profileCache;
		await loadWasmStats(this.loader as never);
		this.profileCache = buildProfile(this.adapted);
		return this.profileCache;
	}

	async enhance(options: EnhanceOptions = {}): Promise<EnhancementSpec> {
		const profile = await this.analyze();
		return enhance(profile, { question: options.question, llm: options.llm ?? this.llm });
	}

	get data(): AdaptedData {
		return this.adapted;
	}
}

export function createChart(options: SessionOptions): SmartChartSession {
	return new SmartChartSession(options);
}
