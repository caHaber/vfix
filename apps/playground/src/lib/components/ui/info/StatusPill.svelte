<script lang="ts">
type Tone = 'ok' | 'warn' | 'err' | 'pending' | 'idle';

interface Props {
	tone: Tone;
	label: string;
	meta?: string;
	title?: string;
	onclick?: () => void;
}

const { tone, label, meta, title, onclick }: Props = $props();
</script>

<button type="button" class="pill" data-tone={tone} {onclick} {title}>
	<span class="dot" aria-hidden="true"></span>
	<span class="label">{label}</span>
	{#if meta}
		<span class="meta">{meta}</span>
	{/if}
</button>

<style>
	.pill {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.28rem 0.65rem;
		border-radius: 999px;
		border: 1px solid var(--color-border, #e5e7eb);
		background: var(--color-card, #fff);
		font-size: 0.72rem;
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		cursor: pointer;
		flex-shrink: 0;
		white-space: nowrap;
		transition: background 120ms ease, border-color 120ms ease, transform 120ms ease;
	}
	.pill:hover {
		background: var(--color-accent, rgba(0, 0, 0, 0.04));
	}
	.pill:active {
		transform: translateY(1px);
	}
	.dot {
		width: 0.5rem;
		height: 0.5rem;
		border-radius: 50%;
		background: #9ca3af;
		box-shadow: 0 0 0 3px rgba(156, 163, 175, 0.18);
	}
	.pill[data-tone='ok'] .dot { background: #22c55e; box-shadow: 0 0 0 3px rgba(34, 197, 94, 0.18); }
	.pill[data-tone='ok'] { border-color: rgba(34, 197, 94, 0.4); }
	.pill[data-tone='warn'] .dot { background: #f59e0b; box-shadow: 0 0 0 3px rgba(245, 158, 11, 0.18); }
	.pill[data-tone='warn'] { border-color: rgba(245, 158, 11, 0.4); }
	.pill[data-tone='err'] .dot { background: #dc2626; box-shadow: 0 0 0 3px rgba(220, 38, 38, 0.18); }
	.pill[data-tone='err'] { border-color: rgba(220, 38, 38, 0.4); }
	.pill[data-tone='pending'] .dot {
		background: #3b82f6;
		animation: pulse 1.2s ease-in-out infinite;
	}
	.meta {
		color: var(--color-muted-foreground, #6b7280);
	}
	@keyframes pulse {
		0%, 100% { opacity: 1; }
		50% { opacity: 0.4; }
	}
</style>
