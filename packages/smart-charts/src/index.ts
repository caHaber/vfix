export { createChart, SmartChartSession } from './core/session.js';
export { adapt, inferSchema } from './core/data-adapter.js';
export { buildProfile } from './core/stats-engine.js';
export { enhance } from './core/enhancer.js';
export { compactProfileForPrompt } from './core/profile-builder.js';
export { heuristicSpec } from './core/llm/mock.js';
export { loadWasmStats, isLoaded as isWasmStatsLoaded } from './core/wasm-bridge.js';
export { specToRows } from './render/spec-to-rows.js';
export { default as SmartChart } from './lib/SmartChart.svelte';
export type {
	AdaptedData,
	ColumnView,
} from './core/data-adapter.js';
export type {
	Annotation,
	ChartType,
	ColumnProfile,
	ColumnSummary,
	ColumnType,
	Correlation,
	Dataset,
	EnhancementSpec,
	LLMConfig,
	Row,
	Schema,
	StatisticalProfile,
	TextInsights,
	TimeseriesInsights,
} from './core/types.js';
