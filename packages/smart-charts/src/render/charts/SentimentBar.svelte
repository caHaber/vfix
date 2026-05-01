<script lang="ts">
	type Row = { group: string; sentiment: number; topKeyword?: string };

	let { rows = [] as Row[] }: { rows?: Row[] } = $props();

	const max = $derived(Math.max(0.1, ...rows.map((r) => Math.abs(r.sentiment))));
</script>

<div class="sentiment-bar">
	{#each rows as r (r.group)}
		{@const pct = (Math.abs(r.sentiment) / max) * 100}
		{@const positive = r.sentiment >= 0}
		<div class="row">
			<div class="label">
				<span class="group">{r.group}</span>
				{#if r.topKeyword}<span class="kw">"{r.topKeyword}"</span>{/if}
			</div>
			<div class="track">
				<div class="zero"></div>
				{#if positive}
					<div class="bar pos" style:width="{pct / 2}%" style:left="50%"></div>
				{:else}
					<div class="bar neg" style:width="{pct / 2}%" style:right="50%"></div>
				{/if}
			</div>
			<div class="value" class:pos={positive} class:neg={!positive}>{r.sentiment.toFixed(2)}</div>
		</div>
	{/each}
</div>

<style>
	.sentiment-bar {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding: 1rem;
	}
	.row {
		display: grid;
		grid-template-columns: 180px 1fr 60px;
		align-items: center;
		gap: 0.75rem;
	}
	.label {
		font-size: 0.85rem;
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
		min-width: 0;
	}
	.group {
		font-weight: 600;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.kw {
		font-style: italic;
		color: var(--color-muted-foreground, #6b7280);
		font-size: 0.75rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.track {
		position: relative;
		height: 16px;
		background: rgba(0, 0, 0, 0.04);
		border-radius: 4px;
	}
	.zero {
		position: absolute;
		left: 50%;
		top: 0;
		bottom: 0;
		width: 1px;
		background: rgba(0, 0, 0, 0.25);
	}
	.bar {
		position: absolute;
		top: 2px;
		bottom: 2px;
		border-radius: 2px;
	}
	.bar.pos {
		background: #16a34a;
	}
	.bar.neg {
		background: #dc2626;
	}
	.value {
		font-variant-numeric: tabular-nums;
		font-size: 0.85rem;
		text-align: right;
	}
	.value.pos {
		color: #16a34a;
	}
	.value.neg {
		color: #dc2626;
	}
</style>
