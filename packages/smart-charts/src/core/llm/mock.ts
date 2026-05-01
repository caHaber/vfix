import type { EnhancementSpec, StatisticalProfile } from '../types.js';

/**
 * Heuristic spec generator. Used as a fallback when no LLM is configured
 * and as a deterministic baseline for tests.
 */
export function heuristicSpec(profile: StatisticalProfile, question?: string): EnhancementSpec {
	const cols = Object.entries(profile.columns);
	const numeric = cols.filter(([, c]) => c.type === 'numeric');
	const temporal = cols.filter(([, c]) => c.type === 'temporal');
	const categorical = cols.filter(([, c]) => c.type === 'categorical');
	const text = profile.text ? Object.keys(profile.text) : [];
	const q = (question ?? '').toLowerCase();

	// Text-leaning questions
	if (text.length > 0 && /(complain|review|sentiment|word|topic|negative|positive|theme)/.test(q)) {
		const tname = text[0];
		const ti = profile.text![tname];
		if (ti.byGroup && /(which|by|per|product|category)/.test(q)) {
			return {
				chartType: 'sentimentBar',
				encoding: { x: ti.byGroup.groupColumn, y: '__sentiment__' },
				scales: { yScale: 'linear', yDomain: [-1, 1] },
				annotations: [{ type: 'threshold', value: 0, label: 'neutral' }],
				emphasis: { rows: [], reason: 'sentiment by group' },
				caption: `Average sentiment of ${tname} by ${ti.byGroup.groupColumn}.`,
				followUpQuestions: [
					`What words drive negative ${tname}?`,
					`Show ${tname} sentiment over time`,
				],
			};
		}
		return {
			chartType: 'wordCloud',
			encoding: { x: '__term__', y: '__score__' },
			scales: {},
			annotations: [],
			emphasis: { rows: [], reason: 'top keywords' },
			caption: `Top keywords across ${profile.shape.rows} ${tname} entries.`,
			followUpQuestions: [
				`Which entries are most negative?`,
				`Are there themes by category?`,
			],
		};
	}

	// Time series
	if (temporal.length > 0 && numeric.length > 0) {
		const x = temporal[0][0];
		const y = numeric[0][0];
		const annotations: EnhancementSpec['annotations'] = [];
		if (profile.timeseries?.trend.strength && profile.timeseries.trend.strength > 0.2) {
			annotations.push({ type: 'trendline', method: 'linear', label: profile.timeseries.trend.direction });
		}
		for (const cp of profile.timeseries?.changePoints.slice(0, 2) ?? []) {
			annotations.push({ type: 'callout', targetIndex: cp.index, text: `change (${cp.confidence.toFixed(2)})` });
		}
		return {
			chartType: 'line',
			encoding: { x, y },
			scales: { yScale: 'linear' },
			annotations,
			emphasis: { rows: [], reason: 'time series' },
			caption: `${y} over ${x}.`,
			followUpQuestions: [`Where are the anomalies?`, `Is there seasonality?`],
		};
	}

	// Categorical × numeric → bar
	if (categorical.length > 0 && numeric.length > 0) {
		return {
			chartType: 'bar',
			encoding: { x: categorical[0][0], y: numeric[0][0] },
			scales: {},
			annotations: [],
			emphasis: { rows: [], reason: 'group comparison' },
			caption: `${numeric[0][0]} by ${categorical[0][0]}.`,
			followUpQuestions: [`Which ${categorical[0][0]} is highest?`],
		};
	}

	// Two numerics → scatter
	if (numeric.length >= 2) {
		return {
			chartType: 'scatter',
			encoding: { x: numeric[0][0], y: numeric[1][0] },
			scales: {},
			annotations: [],
			emphasis: { rows: [], reason: 'pairwise relationship' },
			caption: `Relationship between ${numeric[0][0]} and ${numeric[1][0]}.`,
			followUpQuestions: [`Are there clusters?`],
		};
	}

	// Single numeric → histogram
	if (numeric.length === 1) {
		return {
			chartType: 'histogram',
			encoding: { x: numeric[0][0], y: '__count__' },
			scales: {},
			annotations: [],
			emphasis: { rows: [], reason: 'distribution' },
			caption: `Distribution of ${numeric[0][0]}.`,
			followUpQuestions: [],
		};
	}

	// Last resort
	return {
		chartType: 'bar',
		encoding: { x: cols[0]?.[0] ?? '', y: cols[1]?.[0] ?? '' },
		scales: {},
		annotations: [],
		emphasis: { rows: [], reason: 'default' },
		caption: '',
		followUpQuestions: [],
	};
}
