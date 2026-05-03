<script lang="ts">
import { getContext } from 'svelte';
import type { Readable } from 'svelte/store';

type Datum = Record<string, unknown>;
type Ctx = {
	data: Readable<Datum[]>;
	xGet: Readable<(d: Datum) => number>;
	yGet: Readable<(d: Datum) => number>;
	xScale: Readable<{ bandwidth?: () => number }>;
	height: Readable<number>;
};

let { fill = '#3b82f6' }: { fill?: string } = $props();

const { data, xGet, yGet, xScale, height } = getContext<Ctx>('LayerCake');
</script>

<g>
	{#each $data as d, i (i)}
		{@const x = $xGet(d)}
		{@const y = $yGet(d)}
		{@const bw = ($xScale as { bandwidth?: () => number }).bandwidth?.() ?? 12}
		{#if Number.isFinite(x) && Number.isFinite(y)}
			<rect x={x - bw / 2} y={Math.min(y, $height)} width={bw} height={Math.abs($height - y)} {fill} />
		{/if}
	{/each}
</g>
