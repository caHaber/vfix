<script lang="ts">
	import { getContext } from 'svelte';
	import type { Readable } from 'svelte/store';

	type Ctx = {
		xScale: Readable<{ ticks?: (n?: number) => unknown[]; domain?: () => unknown[] }>;
		yScale: Readable<(v: number) => number> & { ticks?: (n?: number) => number[] };
		width: Readable<number>;
		height: Readable<number>;
	};

	let { xLabel = '', yLabel = '' }: { xLabel?: string; yLabel?: string } = $props();

	const { xScale, yScale, width, height } = getContext<Ctx>('LayerCake');

	function labelOf(v: unknown): string {
		if (v instanceof Date) return v.toLocaleDateString();
		if (typeof v === 'number') return formatNumber(v);
		return String(v);
	}

	function formatNumber(n: number): string {
		if (!Number.isFinite(n)) return '';
		const abs = Math.abs(n);
		if (abs >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
		if (abs < 1) return n.toFixed(2);
		return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
	}

	const xTicks = $derived.by<Array<{ value: unknown; pos: number }>>(() => {
		const s = $xScale as unknown as {
			ticks?: (n?: number) => unknown[];
			domain?: () => unknown[];
			(v: unknown): number;
		};
		const fn = s as unknown as (v: unknown) => number;
		const t = typeof s.ticks === 'function' ? s.ticks(6) : s.domain?.() ?? [];
		return (t ?? []).map((value) => ({ value, pos: fn(value as never) }));
	});

	const yTicks = $derived.by<Array<{ value: number; pos: number }>>(() => {
		const s = $yScale as unknown as { ticks?: (n?: number) => number[]; (v: number): number };
		const t = typeof s.ticks === 'function' ? s.ticks(5) : [];
		return (t ?? []).map((value) => ({ value, pos: (s as unknown as (v: number) => number)(value) }));
	});
</script>

<g class="axes">
	<line x1="0" x2={$width} y1={$height} y2={$height} stroke="rgba(0,0,0,0.2)" />
	<line x1="0" x2="0" y1="0" y2={$height} stroke="rgba(0,0,0,0.2)" />

	{#each xTicks as t, i (i)}
		<g transform="translate({t.pos},{$height})">
			<line y1="0" y2="4" stroke="rgba(0,0,0,0.3)" />
			<text y="16" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.7">{labelOf(t.value)}</text>
		</g>
	{/each}

	{#each yTicks as t, i (i)}
		<g transform="translate(0,{t.pos})">
			<line x1="-4" x2="0" stroke="rgba(0,0,0,0.3)" />
			<text x="-8" dy="0.32em" text-anchor="end" font-size="10" fill="currentColor" opacity="0.7">{formatNumber(t.value)}</text>
		</g>
	{/each}

	{#if xLabel}
		<text x={$width / 2} y={$height + 32} text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85">{xLabel}</text>
	{/if}
	{#if yLabel}
		<text transform="translate(-36,{$height / 2}) rotate(-90)" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85">{yLabel}</text>
	{/if}
</g>
