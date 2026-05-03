<script lang="ts">
import { getContext } from 'svelte';
import type { Readable } from 'svelte/store';

type Datum = Record<string, unknown>;
type Ctx = {
	data: Readable<Datum[]>;
	xGet: Readable<(d: Datum) => number>;
	yGet: Readable<(d: Datum) => number>;
};

let { stroke = '#3b82f6', strokeWidth = 2 }: { stroke?: string; strokeWidth?: number } = $props();

const { data, xGet, yGet } = getContext<Ctx>('LayerCake');

const path = $derived.by(() => {
	const rows = $data;
	const fx = $xGet;
	const fy = $yGet;
	if (!rows?.length) return '';
	let d = '';
	for (let i = 0; i < rows.length; i++) {
		const x = fx(rows[i]);
		const y = fy(rows[i]);
		if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
		d += d ? `L${x},${y}` : `M${x},${y}`;
	}
	return d;
});
</script>

<path d={path} fill="none" {stroke} stroke-width={strokeWidth} stroke-linejoin="round" stroke-linecap="round" />
