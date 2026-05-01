<script lang="ts">
	import { getContext } from 'svelte';
	import type { Readable } from 'svelte/store';

	type Datum = { x0: number; x1: number; count: number };
	type Ctx = {
		data: Readable<Datum[]>;
		xScale: Readable<(v: number) => number>;
		yScale: Readable<(v: number) => number>;
		height: Readable<number>;
	};

	let { fill = '#3b82f6', gap = 1 }: { fill?: string; gap?: number } = $props();

	const { data, xScale, yScale, height } = getContext<Ctx>('LayerCake');
</script>

<g>
	{#each $data as d, i (i)}
		{@const x0 = ($xScale as (v: number) => number)(d.x0)}
		{@const x1 = ($xScale as (v: number) => number)(d.x1)}
		{@const y = ($yScale as (v: number) => number)(d.count)}
		{#if Number.isFinite(x0) && Number.isFinite(x1) && Number.isFinite(y)}
			<rect x={Math.min(x0, x1) + gap / 2} y={y} width={Math.max(0, Math.abs(x1 - x0) - gap)} height={$height - y} {fill} />
		{/if}
	{/each}
</g>
