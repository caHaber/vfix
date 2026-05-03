export type {
	AdaptedData,
	ColumnView,
} from './core/data-adapter.js';
export { adapt, inferSchema } from './core/data-adapter.js';
export { enhance } from './core/enhancer.js';
export { heuristicSpec } from './core/llm/mock.js';
export { compactProfileForPrompt } from './core/profile-builder.js';
export { createChart, SmartChartSession } from './core/session.js';
export { buildProfile } from './core/stats-engine.js';
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
export {
	getDiagnostics as getWasmStatsDiagnostics,
	isLoaded as isWasmStatsLoaded,
	loadWasmStats,
	type WasmBackend,
	type WasmDiagnostics,
} from './core/wasm-bridge.js';
export { default as SmartChart } from './lib/SmartChart.svelte';
export { specToRows } from './render/spec-to-rows.js';
