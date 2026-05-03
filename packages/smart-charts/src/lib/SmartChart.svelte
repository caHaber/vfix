<script lang="ts">
import { scaleBand, scaleLinear, scaleTime } from 'd3-scale';
import { LayerCake, Svg } from 'layercake';
import type { AdaptedData } from '../core/data-adapter.js';
import type { EnhancementSpec, StatisticalProfile } from '../core/types.js';
import Annotations from '../render/charts/Annotations.svelte';
import Area from '../render/charts/Area.svelte';
import Axes from '../render/charts/Axes.svelte';
import Bar from '../render/charts/Bar.svelte';
import Histogram from '../render/charts/Histogram.svelte';
import Line from '../render/charts/Line.svelte';
import Scatter from '../render/charts/Scatter.svelte';
import SentimentBar from '../render/charts/SentimentBar.svelte';
import WordCloud from '../render/charts/WordCloud.svelte';
import { specToRows } from '../render/spec-to-rows.js';

type Props = {
	spec: EnhancementSpec;
	profile: StatisticalProfile;
	adapted: AdaptedData;
	height?: number;
};

let { spec, profile, adapted, height = 360 }: Props = $props();

const view = $derived(specToRows(spec, adapted, profile));

const xScaleFn = $derived.by(() => {
	if (view.xType === 'temporal') return scaleTime();
	if (view.xType === 'categorical') return scaleBand().padding(0.2);
	return scaleLinear();
});

const padding = { top: 16, right: 16, bottom: 36, left: 56 };
</script>

<div class="smart-chart" style:height="{height}px">
	{#if spec.chartType === 'wordCloud'}
		<WordCloud rows={view.rows as Array<{ term: string; score: number; count?: number }>} />
	{:else if spec.chartType === 'sentimentBar'}
		<SentimentBar rows={view.rows as Array<{ group: string; sentiment: number; topKeyword?: string }>} />
	{:else if view.rows.length === 0}
		<div class="empty">No data to chart.</div>
	{:else}
		<LayerCake
			data={view.rows}
			x={view.xKey}
			y={view.yKey}
			xScale={xScaleFn}
			{padding}
		>
			<Svg>
				<Axes xLabel={view.xKey} yLabel={view.yKey} />
				<Annotations annotations={spec.annotations} />
				{#if spec.chartType === 'line'}
					<Line />
				{:else if spec.chartType === 'area'}
					<Area />
				{:else if spec.chartType === 'bar'}
					<Bar />
				{:else if spec.chartType === 'scatter'}
					<Scatter />
				{:else if spec.chartType === 'histogram'}
					<Histogram />
				{:else if spec.chartType === 'heatmap'}
					<Scatter radius={6} fill="#3b82f6" />
				{/if}
			</Svg>
		</LayerCake>
	{/if}
</div>

<style>
	.smart-chart {
		width: 100%;
		position: relative;
		color: var(--color-foreground, #111);
	}
	.empty {
		display: flex;
		align-items: center;
		justify-content: center;
		height: 100%;
		color: var(--color-muted-foreground, #6b7280);
		font-size: 0.85rem;
	}
</style>
