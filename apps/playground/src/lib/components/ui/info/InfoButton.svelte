<script lang="ts">
import Info from '@lucide/svelte/icons/info';

interface Props {
	onclick: () => void;
	label?: string;
	title?: string;
}

const { onclick, label = 'About this view', title = 'What is this?' }: Props = $props();
</script>

<button type="button" class="info-btn" {onclick} aria-label={label} {title}>
	<Info class="size-4" />
</button>

<style>
	.info-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.85rem;
		height: 1.85rem;
		padding: 0;
		border-radius: 999px;
		border: 1px solid var(--color-border, #e5e7eb);
		background: var(--color-card, #fff);
		color: var(--color-muted-foreground, #6b7280);
		cursor: pointer;
		flex-shrink: 0;
		transition: background 120ms ease, color 120ms ease, border-color 120ms ease, transform 120ms ease;
	}
	.info-btn:hover {
		background: var(--color-accent, rgba(0, 0, 0, 0.04));
		color: var(--color-foreground);
		border-color: color-mix(in srgb, var(--color-foreground) 25%, var(--color-border));
	}
	.info-btn:active {
		transform: translateY(1px);
	}
</style>
