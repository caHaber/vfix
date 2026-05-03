<script lang="ts">
import { getContext } from 'svelte';
import type { Readable } from 'svelte/store';

type Datum = Record<string, unknown>;
type Ctx = {
	data: Readable<Datum[]>;
	xGet: Readable<(d: Datum) => number>;
	yGet: Readable<(d: Datum) => number>;
	yScale: Readable<(v: number) => number>;
};

let { fill = '#3b82f6', fillOpacity = 0.25 }: { fill?: string; fillOpacity?: number } = $props();

const { data, xGet, yGet, yScale } = getContext<Ctx>('LayerCake');

const path = $derived.by(() => {
	const rows = $data;
	const fx = $xGet;
	const fy = $yGet;
	const yZero = ($yScale as (v: number) => number)(0);
	if (!rows?.length) return '';
	let top = '';
	for (let i = 0; i < rows.length; i++) {
		const x = fx(rows[i]);
		const y = fy(rows[i]);
		if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
		top += top ? `L${x},${y}` : `M${x},${y}`;
	}
	const last = rows[rows.length - 1];
	const first = rows[0];
	return top + `L${fx(last)},${yZero}L${fx(first)},${yZero}Z`;
});
</script>

<path d={path} {fill} fill-opacity={fillOpacity} />
