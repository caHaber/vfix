<script lang="ts">
	import { getContext } from 'svelte';
	import type { Readable } from 'svelte/store';

	type Datum = Record<string, unknown>;
	type Ctx = {
		data: Readable<Datum[]>;
		xGet: Readable<(d: Datum) => number>;
		yGet: Readable<(d: Datum) => number>;
	};

	let { fill = '#3b82f6', radius = 3 }: { fill?: string; radius?: number } = $props();

	const { data, xGet, yGet } = getContext<Ctx>('LayerCake');
</script>

<g>
	{#each $data as d, i (i)}
		{@const x = $xGet(d)}
		{@const y = $yGet(d)}
		{#if Number.isFinite(x) && Number.isFinite(y)}
			<circle cx={x} cy={y} r={radius} {fill} fill-opacity={0.7} />
		{/if}
	{/each}
</g>
