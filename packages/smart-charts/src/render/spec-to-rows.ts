import type { AdaptedData } from '../core/data-adapter.js';
import type { EnhancementSpec, StatisticalProfile, TextInsights } from '../core/types.js';

export interface RenderRows {
	rows: Array<Record<string, unknown>>;
	xKey: string;
	yKey: string;
	xType: 'numeric' | 'temporal' | 'categorical';
}

/**
 * Translate (data, profile, spec) into a flat array of rows that the chart
 * components can read directly via Layercake's accessors.
 */
export function specToRows(
	spec: EnhancementSpec,
	adapted: AdaptedData,
	profile: StatisticalProfile,
): RenderRows {
	if (spec.chartType === 'wordCloud') {
		const textName = profile.text ? Object.keys(profile.text)[0] : null;
		const ti = textName ? profile.text![textName] : null;
		const rows = (ti?.topKeywords ?? []).map((k) => ({
			term: k.term,
			score: k.score,
			count: k.count,
		}));
		return { rows, xKey: 'term', yKey: 'score', xType: 'categorical' };
	}

	if (spec.chartType === 'sentimentBar') {
		const textName = profile.text ? Object.keys(profile.text)[0] : null;
		const ti = textName ? profile.text![textName] : null;
		const rows = ti?.byGroup
			? ti.byGroup.rows.map((r) => ({
					group: r.group,
					sentiment: r.sentiment,
					topKeyword: r.topKeyword,
				}))
			: ti
				? sentimentBucketFromInsights(ti)
				: [];
		return { rows, xKey: 'group', yKey: 'sentiment', xType: 'categorical' };
	}

	if (spec.chartType === 'histogram') {
		const col = adapted.columns[spec.encoding.x];
		const bins = profile.columns[spec.encoding.x]?.histogramBins;
		if (!col || !bins) return { rows: [], xKey: 'x', yKey: 'count', xType: 'numeric' };
		const rows = bins.counts.map((count, i) => ({
			x: (bins.edges[i] + bins.edges[i + 1]) / 2,
			x0: bins.edges[i],
			x1: bins.edges[i + 1],
			count,
		}));
		return { rows, xKey: 'x', yKey: 'count', xType: 'numeric' };
	}

	if (spec.chartType === 'bar' && profile.aggregates) {
		const agg = profile.aggregates.find(
			(a) => a.groupColumn === spec.encoding.x && a.valueColumn === spec.encoding.y,
		);
		if (agg) {
			return {
				rows: agg.rows.map((r) => ({ [spec.encoding.x]: r.group, [spec.encoding.y]: r.value })),
				xKey: spec.encoding.x,
				yKey: spec.encoding.y,
				xType: 'categorical',
			};
		}
	}

	const xCol = adapted.columns[spec.encoding.x];
	const yCol = adapted.columns[spec.encoding.y];
	const n = adapted.dataset.rowCount;
	const rows: Array<Record<string, unknown>> = [];
	const xType: RenderRows['xType'] =
		xCol?.type === 'temporal'
			? 'temporal'
			: xCol?.type === 'categorical'
				? 'categorical'
				: 'numeric';

	for (let i = 0; i < n; i++) {
		let xv: unknown;
		if (xCol?.type === 'temporal') xv = new Date(xCol.temporal![i]);
		else if (xCol?.type === 'categorical') xv = xCol.categories![xCol.groupKeys![i]];
		else xv = xCol?.numeric?.[i];
		const yv = yCol?.numeric?.[i];
		rows.push({ [spec.encoding.x]: xv, [spec.encoding.y]: yv, __i: i });
	}

	if (xType === 'temporal' || xType === 'numeric') {
		rows.sort((a, b) => {
			const ax = a[spec.encoding.x] as number | Date;
			const bx = b[spec.encoding.x] as number | Date;
			return +ax - +bx;
		});
	}

	return { rows, xKey: spec.encoding.x, yKey: spec.encoding.y, xType };
}

function sentimentBucketFromInsights(ti: TextInsights) {
	return [
		{ group: 'positive', sentiment: ti.sentiment.positiveRatio, topKeyword: '' },
		{ group: 'neutral', sentiment: ti.sentiment.neutralRatio, topKeyword: '' },
		{ group: 'negative', sentiment: ti.sentiment.negativeRatio, topKeyword: '' },
	];
}
