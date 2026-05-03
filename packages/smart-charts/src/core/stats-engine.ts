import type { AdaptedData, ColumnView } from './data-adapter.js';
import type {
	AggregateInsight,
	Anomaly,
	ClusterInsight,
	Correlation,
	StatisticalProfile,
	TextInsights,
	TimeseriesInsights,
} from './types.js';
import { getCached } from './wasm-bridge.js';

interface RustSummary {
	count: number;
	mean: number;
	median: number;
	std: number;
	min: number;
	max: number;
	q1: number;
	q3: number;
}

interface RustHistogram {
	edges: number[];
	counts: number[];
}

interface RustTrend {
	slope: number;
	direction: 'up' | 'down' | 'flat';
	strength: number;
}

interface RustSeasonality {
	period: number;
	strength: number;
}

interface RustChangePoint {
	index: number;
	confidence: number;
	before_mean: number;
	after_mean: number;
}

interface RustClusterResult {
	labels: number[];
	centroids: number[][];
	inertia: number;
	iterations: number;
}

interface RustTermScore {
	term: string;
	score: number;
	count: number;
}

interface RustSentimentSummary {
	mean: number;
	positive_ratio: number;
	negative_ratio: number;
	neutral_ratio: number;
	bins: number[];
	counts: number[];
}

export function buildProfile(adapted: AdaptedData): StatisticalProfile {
	const wasm = getCached();
	if (!wasm) {
		throw new Error('wasm-stats not initialized — call loadWasmStats() first');
	}

	const profile: StatisticalProfile = {
		shape: { rows: adapted.dataset.rowCount, columns: Object.keys(adapted.columns).length },
		columns: {},
		correlations: [],
		anomalies: [],
	};

	const numericNames: string[] = [];
	for (const [name, col] of Object.entries(adapted.columns)) {
		profile.columns[name] = profileColumn(col, wasm);
		if (col.type === 'numeric') numericNames.push(name);
	}

	// Correlations among numeric columns (cap to top 6 by |r|)
	if (numericNames.length >= 2) {
		const cols: Correlation[] = [];
		for (let i = 0; i < numericNames.length; i++) {
			for (let j = i + 1; j < numericNames.length; j++) {
				const a = adapted.columns[numericNames[i]].numeric!;
				const b = adapted.columns[numericNames[j]].numeric!;
				const r = wasm.correlation_pearson(a, b);
				cols.push({ a: numericNames[i], b: numericNames[j], r });
			}
		}
		cols.sort((x, y) => Math.abs(y.r) - Math.abs(x.r));
		profile.correlations = cols.slice(0, 6);
	}

	// Anomalies: zscore on each numeric column
	for (const name of numericNames) {
		const arr = adapted.columns[name].numeric!;
		const idx = wasm.outliers_zscore(arr, 3) as Uint32Array;
		if (idx.length > 0) {
			profile.anomalies.push({
				column: name,
				indices: Array.from(idx).slice(0, 25),
				method: 'zscore',
			});
		}
	}

	// Time series — pick first temporal column + first numeric
	const temporalName = Object.entries(adapted.columns).find(([, c]) => c.type === 'temporal')?.[0];
	if (temporalName && numericNames.length > 0) {
		const yName = numericNames[0];
		profile.timeseries = profileTimeseries(adapted, temporalName, yName, wasm);
	}

	// Clustering: when ≥ 2 numeric columns and rows > 20
	if (numericNames.length >= 2 && adapted.dataset.rowCount >= 20) {
		const data: number[][] = numericNames.map((n) => Array.from(adapted.columns[n].numeric!));
		const result = wasm.kmeans(
			data,
			Math.min(4, Math.floor(adapted.dataset.rowCount / 5)),
			50,
		) as RustClusterResult;
		profile.clusters = {
			columns: numericNames,
			k: result.centroids.length,
			labels: result.labels,
			inertia: result.inertia,
		};
	}

	// Aggregates: each categorical × first numeric (mean)
	const categoricalNames = Object.entries(adapted.columns)
		.filter(([, c]) => c.type === 'categorical' && (c.categories?.length ?? 0) <= 20)
		.map(([n]) => n);
	if (categoricalNames.length > 0 && numericNames.length > 0) {
		profile.aggregates = [];
		for (const gName of categoricalNames) {
			const g = adapted.columns[gName];
			const valName = numericNames[0];
			const v = adapted.columns[valName].numeric!;
			const means = wasm.group_by_mean(g.groupKeys!, v, g.categories!.length) as Float64Array;
			profile.aggregates.push({
				groupColumn: gName,
				valueColumn: valName,
				op: 'mean',
				rows: g.categories!.map((group, i) => ({ group, value: means[i] })),
			});
		}
	}

	// Text columns: keywords + sentiment
	const textNames = Object.entries(adapted.columns)
		.filter(([, c]) => c.type === 'text')
		.map(([n]) => n);
	if (textNames.length > 0) {
		profile.text = {};
		for (const name of textNames) {
			profile.text[name] = profileText(adapted, name, wasm);
		}
	}

	return profile;
}

function profileColumn(col: ColumnView, wasm: NonNullable<ReturnType<typeof getCached>>) {
	if (col.type === 'numeric' || col.type === 'temporal' || col.type === 'boolean') {
		const arr = col.numeric!;
		const summary = wasm.summary(arr) as RustSummary;
		const hist = wasm.histogram(arr, 12) as RustHistogram;
		const cardinality = uniqueCount(arr);
		return {
			type: col.type,
			cardinality,
			summary: {
				count: summary.count,
				mean: summary.mean,
				median: summary.median,
				std: summary.std,
				min: summary.min,
				max: summary.max,
				q1: summary.q1,
				q3: summary.q3,
			},
			histogramBins: { edges: hist.edges, counts: hist.counts },
			distribution: classifyDistribution(summary, hist),
		};
	}
	if (col.type === 'categorical') {
		const counts = wasm.group_by_count(col.groupKeys!, col.categories!.length) as Uint32Array;
		let modeIdx = 0;
		for (let i = 1; i < counts.length; i++) {
			if (counts[i] > counts[modeIdx]) modeIdx = i;
		}
		return {
			type: col.type,
			cardinality: col.categories!.length,
			summary: { mode: col.categories![modeIdx] },
		};
	}
	// text
	const sample = col.text!.slice(0, Math.min(200, col.text!.length));
	let totalTokens = 0;
	const seen = new Set<string>();
	for (const doc of sample) {
		const toks = wasm.tokenize(doc);
		totalTokens += toks.length;
		for (const t of toks) seen.add(t);
	}
	return {
		type: col.type,
		cardinality: new Set(col.text!).size,
		summary: {},
		text: {
			avgTokens: sample.length ? totalTokens / sample.length : 0,
			uniqueTokens: seen.size,
			sampleSize: sample.length,
		},
	};
}

function uniqueCount(arr: Float64Array): number {
	const set = new Set<number>();
	for (let i = 0; i < arr.length; i++) {
		if (Number.isFinite(arr[i])) set.add(arr[i]);
		if (set.size > 256) return arr.length;
	}
	return set.size;
}

function classifyDistribution(
	s: RustSummary,
	h: RustHistogram,
): 'normal' | 'skewed' | 'bimodal' | 'uniform' | undefined {
	if (!h.counts.length || s.std === 0) return undefined;
	const skew = (s.mean - s.median) / Math.max(1e-9, s.std);
	if (Math.abs(skew) > 0.5) return 'skewed';
	const peaks = countPeaks(h.counts);
	if (peaks >= 2) return 'bimodal';
	const mean = h.counts.reduce((a, b) => a + b, 0) / h.counts.length;
	const variance = h.counts.reduce((a, b) => a + (b - mean) ** 2, 0) / h.counts.length;
	if (variance < (mean * 0.25) ** 2) return 'uniform';
	return 'normal';
}

function countPeaks(counts: number[]): number {
	let peaks = 0;
	for (let i = 1; i < counts.length - 1; i++) {
		if (counts[i] > counts[i - 1] && counts[i] > counts[i + 1] && counts[i] > 1) peaks++;
	}
	return peaks;
}

function profileTimeseries(
	adapted: AdaptedData,
	temporalName: string,
	yName: string,
	wasm: NonNullable<ReturnType<typeof getCached>>,
): TimeseriesInsights {
	const t = adapted.columns[temporalName].temporal!;
	const yRaw = adapted.columns[yName].numeric!;
	const order = Array.from(t.keys()).sort((a, b) => t[a] - t[b]);
	const sorted = new Float64Array(order.length);
	for (let i = 0; i < order.length; i++) sorted[i] = yRaw[order[i]];
	const trend = wasm.detect_trend(sorted) as RustTrend;
	const seasonality = wasm.detect_seasonality(
		sorted,
		Math.min(20, Math.floor(sorted.length / 2)),
	) as RustSeasonality;
	const changes = wasm.change_points(sorted, 0.05) as RustChangePoint[];
	return {
		column: yName,
		temporalColumn: temporalName,
		trend,
		seasonality: seasonality && seasonality.period > 0 ? seasonality : undefined,
		changePoints: changes.slice(0, 5),
	};
}

function profileText(
	adapted: AdaptedData,
	name: string,
	wasm: NonNullable<ReturnType<typeof getCached>>,
): TextInsights {
	const docs = adapted.columns[name].text!;
	const top = wasm.tf_idf(docs, 20) as RustTermScore[];
	const phrases = wasm.rake_keywords(docs, 10) as RustTermScore[];
	const scores = wasm.sentiment_batch(docs) as Float64Array;
	const summary = wasm.sentiment_summary(scores, 10) as RustSentimentSummary;

	const out: TextInsights = {
		column: name,
		topKeywords: top,
		topBigrams: phrases,
		sentiment: {
			mean: summary.mean,
			positiveRatio: summary.positive_ratio,
			negativeRatio: summary.negative_ratio,
			neutralRatio: summary.neutral_ratio,
			distribution: { bins: summary.bins, counts: summary.counts },
		},
	};

	// Cross with first categorical column if present
	const groupName = Object.entries(adapted.columns).find(
		([n, c]) => c.type === 'categorical' && n !== name && (c.categories?.length ?? 0) <= 20,
	)?.[0];
	if (groupName) {
		const g = adapted.columns[groupName];
		const groupCount = g.categories!.length;
		const sums = new Float64Array(groupCount);
		const counts = new Uint32Array(groupCount);
		const groupDocs: string[][] = Array.from({ length: groupCount }, () => []);
		const keys = g.groupKeys!;
		for (let i = 0; i < scores.length; i++) {
			const k = keys[i];
			sums[k] += scores[i];
			counts[k] += 1;
			groupDocs[k].push(docs[i]);
		}
		const rows = g.categories!.map((group, i) => {
			const sentiment = counts[i] > 0 ? sums[i] / counts[i] : 0;
			const groupKeywords = wasm.tf_idf(groupDocs[i], 1) as RustTermScore[];
			const topKeyword = groupKeywords[0]?.term ?? '';
			return { group, sentiment, topKeyword };
		});
		out.byGroup = { groupColumn: groupName, rows };
	}

	return out;
}
