<script lang="ts">
	type Term = { term: string; score: number; count?: number };

	let { rows = [] as Term[], maxFontSize = 48, minFontSize = 12 }: { rows?: Term[]; maxFontSize?: number; minFontSize?: number } = $props();

	const ranked = $derived.by(() => {
		if (!rows.length) return [] as Array<Term & { fontSize: number }>;
		const max = Math.max(...rows.map((r) => r.score));
		const min = Math.min(...rows.map((r) => r.score));
		const span = Math.max(1e-9, max - min);
		return rows.map((r) => ({
			...r,
			fontSize: minFontSize + ((r.score - min) / span) * (maxFontSize - minFontSize),
		}));
	});
</script>

<div class="word-cloud">
	{#each ranked as r (r.term)}
		<span class="term" style:font-size="{r.fontSize}px" style:color={`hsl(${(r.fontSize * 7) % 360} 60% 45%)`}>
			{r.term}
		</span>
	{/each}
</div>

<style>
	.word-cloud {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem 1rem;
		align-items: center;
		justify-content: center;
		padding: 1rem;
		min-height: 200px;
	}
	.term {
		font-weight: 600;
		line-height: 1;
		letter-spacing: -0.02em;
	}
</style>
