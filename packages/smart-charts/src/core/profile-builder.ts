import type { StatisticalProfile } from './types.js';

/**
 * Compact a StatisticalProfile into a JSON string suitable for an LLM prompt.
 * Drops fields that don't aid reasoning (raw row indices, full bin arrays beyond a sample).
 */
export function compactProfileForPrompt(profile: StatisticalProfile): string {
	const compact = {
		shape: profile.shape,
		columns: Object.fromEntries(
			Object.entries(profile.columns).map(([name, col]) => [
				name,
				{
					type: col.type,
					cardinality: col.cardinality,
					summary: col.summary,
					distribution: col.distribution,
					text: col.text,
				},
			]),
		),
		correlations: profile.correlations.filter((c) => Math.abs(c.r) > 0.2),
		timeseries: profile.timeseries
			? {
				column: profile.timeseries.column,
				temporalColumn: profile.timeseries.temporalColumn,
				trend: profile.timeseries.trend,
				seasonality: profile.timeseries.seasonality,
				changePointCount: profile.timeseries.changePoints.length,
			}
			: undefined,
		anomalies: profile.anomalies.map((a) => ({ column: a.column, count: a.indices.length, method: a.method })),
		clusters: profile.clusters
			? { columns: profile.clusters.columns, k: profile.clusters.k, inertia: profile.clusters.inertia }
			: undefined,
		aggregates: profile.aggregates,
		text: profile.text
			? Object.fromEntries(
				Object.entries(profile.text).map(([name, t]) => [
					name,
					{
						topKeywords: t.topKeywords.slice(0, 10),
						topBigrams: t.topBigrams?.slice(0, 5),
						sentiment: {
							mean: t.sentiment.mean,
							positiveRatio: t.sentiment.positiveRatio,
							negativeRatio: t.sentiment.negativeRatio,
							neutralRatio: t.sentiment.neutralRatio,
						},
						byGroup: t.byGroup,
					},
				]),
			)
			: undefined,
	};
	return JSON.stringify(compact);
}
