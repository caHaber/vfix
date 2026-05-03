<script lang="ts">
import { getContext } from 'svelte';
import type { Readable } from 'svelte/store';
import type { Annotation } from '../../core/types.js';

type Datum = Record<string, unknown>;
type Ctx = {
	data: Readable<Datum[]>;
	xGet: Readable<(d: Datum) => number>;
	yGet: Readable<(d: Datum) => number>;
	yScale: Readable<(v: number) => number>;
	width: Readable<number>;
	height: Readable<number>;
};

let { annotations = [] as Annotation[] }: { annotations?: Annotation[] } = $props();

const { data, xGet, yGet, yScale, width, height } = getContext<Ctx>('LayerCake');
</script>

<g>
	{#each annotations as a, i (i)}
		{#if a.type === 'threshold'}
			{@const y = ($yScale as (v: number) => number)(a.value)}
			{#if Number.isFinite(y)}
				<line x1="0" x2={$width} y1={y} y2={y} stroke="#ef4444" stroke-dasharray="4 4" />
				<text x={$width - 4} y={y - 4} text-anchor="end" font-size="10" fill="#ef4444">{a.label}</text>
			{/if}
		{:else if a.type === 'callout'}
			{@const datum = $data[a.targetIndex]}
			{#if datum}
				{@const x = $xGet(datum)}
				{@const y = $yGet(datum)}
				{#if Number.isFinite(x) && Number.isFinite(y)}
					<g>
						<circle cx={x} cy={y} r="5" fill="none" stroke="#f59e0b" stroke-width="2" />
						<line x1={x} x2={x} y1={y - 8} y2={Math.max(8, y - 30)} stroke="#f59e0b" />
						<rect x={x - 50} y={Math.max(0, y - 48)} width="100" height="16" rx="2" fill="#f59e0b" />
						<text x={x} y={Math.max(12, y - 36)} text-anchor="middle" font-size="10" fill="white">{a.text}</text>
					</g>
				{/if}
			{/if}
		{:else if a.type === 'trendline'}
			{@const rows = $data}
			{#if rows.length >= 2}
				{@const fx = $xGet}
				{@const fy = $yGet}
				{@const xs = rows.map(fx).filter(Number.isFinite)}
				{@const ys = rows.map(fy).filter(Number.isFinite)}
				{#if xs.length >= 2}
					{@const n = xs.length}
					{@const sumX = xs.reduce((s, v) => s + v, 0)}
					{@const sumY = ys.reduce((s, v) => s + v, 0)}
					{@const meanX = sumX / n}
					{@const meanY = sumY / n}
					{@const sxx = xs.reduce((s, v) => s + (v - meanX) ** 2, 0)}
					{@const sxy = xs.reduce((s, v, i) => s + (v - meanX) * (ys[i] - meanY), 0)}
					{@const slope = sxx > 0 ? sxy / sxx : 0}
					{@const intercept = meanY - slope * meanX}
					{@const x1 = Math.min(...xs)}
					{@const x2 = Math.max(...xs)}
					<line
						x1={x1}
						y1={intercept + slope * x1}
						x2={x2}
						y2={intercept + slope * x2}
						stroke="#a855f7"
						stroke-width="1.5"
						stroke-dasharray="6 3"
					/>
					<text x={x2} y={intercept + slope * x2 - 6} text-anchor="end" font-size="10" fill="#a855f7">{a.label}</text>
				{/if}
			{/if}
		{:else if a.type === 'region'}
			{@const left = ($yScale as { range?: () => unknown }).range ? 0 : 0}
			<rect x={left} y={0} width={$width} height={$height} fill="#3b82f6" fill-opacity="0.05" />
		{/if}
	{/each}
</g>
