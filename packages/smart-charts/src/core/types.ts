export type Row = Record<string, unknown>;

export type ColumnType = 'numeric' | 'categorical' | 'temporal' | 'boolean' | 'text';

export interface Schema {
	columns: { name: string; type: ColumnType }[];
}

export interface Dataset {
	rows: Row[];
	schema: Schema;
	rowCount: number;
}

export interface ColumnSummary {
	count?: number;
	mean?: number;
	median?: number;
	std?: number;
	min?: number;
	max?: number;
	q1?: number;
	q3?: number;
	mode?: string;
}

export interface ColumnProfile {
	type: ColumnType;
	cardinality: number;
	summary: ColumnSummary;
	distribution?: 'normal' | 'skewed' | 'bimodal' | 'uniform';
	histogramBins?: { edges: number[]; counts: number[] };
	text?: { avgTokens: number; uniqueTokens: number; sampleSize: number };
}

export interface Correlation {
	a: string;
	b: string;
	r: number;
}

export interface TimeseriesInsights {
	column: string;
	temporalColumn?: string;
	trend: { slope: number; direction: 'up' | 'down' | 'flat'; strength: number };
	seasonality?: { period: number; strength: number };
	changePoints: { index: number; confidence: number; before_mean: number; after_mean: number }[];
}

export interface Anomaly {
	column: string;
	indices: number[];
	method: 'zscore' | 'iqr';
}

export interface ClusterInsight {
	columns: string[];
	k: number;
	labels: number[];
	inertia: number;
}

export interface AggregateInsight {
	groupColumn: string;
	valueColumn: string;
	op: 'sum' | 'mean' | 'count';
	rows: { group: string; value: number }[];
}

export interface TextInsights {
	column: string;
	topKeywords: { term: string; score: number; count: number }[];
	topBigrams?: { term: string; score: number; count: number }[];
	sentiment: {
		mean: number;
		positiveRatio: number;
		negativeRatio: number;
		neutralRatio: number;
		distribution: { bins: number[]; counts: number[] };
	};
	byGroup?: {
		groupColumn: string;
		rows: { group: string; sentiment: number; topKeyword: string }[];
	};
}

export interface StatisticalProfile {
	shape: { rows: number; columns: number };
	columns: Record<string, ColumnProfile>;
	correlations: Correlation[];
	timeseries?: TimeseriesInsights;
	anomalies: Anomaly[];
	clusters?: ClusterInsight;
	aggregates?: AggregateInsight[];
	text?: Record<string, TextInsights>;
}

export type ChartType =
	| 'line'
	| 'bar'
	| 'scatter'
	| 'area'
	| 'histogram'
	| 'heatmap'
	| 'wordCloud'
	| 'sentimentBar';

export type Annotation =
	| { type: 'callout'; targetIndex: number; text: string }
	| { type: 'trendline'; method: 'linear' | 'polynomial'; label: string }
	| { type: 'region'; from: number; to: number; label: string }
	| { type: 'threshold'; value: number; label: string };

export interface EnhancementSpec {
	chartType: ChartType;
	encoding: { x: string; y: string; color?: string; size?: string };
	scales: { yScale?: 'linear' | 'log'; yDomain?: [number, number] };
	annotations: Annotation[];
	emphasis: { rows: number[]; reason: string };
	caption: string;
	followUpQuestions: string[];
}

export interface LLMConfig {
	provider: 'openai' | 'anthropic' | 'mock';
	model: string;
	apiKey?: string;
	endpoint?: string;
}
