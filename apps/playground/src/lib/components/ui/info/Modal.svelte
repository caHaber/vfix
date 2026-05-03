<script lang="ts">
import X from '@lucide/svelte/icons/x';
import type { Snippet } from 'svelte';
import { Badge } from '$lib/components/ui/badge';

type Tone = 'ok' | 'warn' | 'err' | 'pending' | 'idle';

interface Props {
	open: boolean;
	title: string;
	ariaLabel?: string;
	width?: 'default' | 'wide';
	headTone?: Tone | null;
	badge?: string;
	onClose: () => void;
	icon?: Snippet;
	children?: Snippet;
	foot?: Snippet;
}

const {
	open,
	title,
	ariaLabel,
	width = 'default',
	headTone = null,
	badge,
	onClose,
	icon,
	children,
	foot,
}: Props = $props();
</script>

{#if open}
	<div
		class="backdrop"
		role="presentation"
		onclick={onClose}
		onkeydown={(e: KeyboardEvent) => {
			if (e.key === 'Escape') onClose();
		}}
	>
		<div
			class="modal"
			class:wide={width === 'wide'}
			role="dialog"
			aria-modal="true"
			aria-label={ariaLabel ?? title}
			tabindex="-1"
			onclick={(e: MouseEvent) => e.stopPropagation()}
			onkeydown={(e: KeyboardEvent) => e.stopPropagation()}
		>
			<div class="head">
				<div class="title">
					{#if headTone}
						<span class="dot" data-tone={headTone} aria-hidden="true"></span>
					{/if}
					{#if icon}{@render icon()}{/if}
					<h2>{title}</h2>
					{#if badge}
						<Badge variant="outline" class="font-mono">{badge}</Badge>
					{/if}
				</div>
				<button type="button" class="close" onclick={onClose} aria-label="Close">
					<X class="size-4" />
				</button>
			</div>

			{#if children}{@render children()}{/if}

			{#if foot}
				<div class="foot">{@render foot()}</div>
			{/if}
		</div>
	</div>
{/if}

<style>
	.backdrop {
		position: fixed;
		inset: 0;
		background: rgba(15, 23, 42, 0.5);
		backdrop-filter: blur(4px);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1rem;
		z-index: 50;
		animation: fade-in 120ms ease-out;
	}
	@keyframes fade-in {
		from { opacity: 0; }
		to { opacity: 1; }
	}
	.modal {
		background: var(--color-card, #ffffff);
		color: var(--color-foreground, #111827);
		border-radius: 12px;
		max-width: 640px;
		width: 100%;
		max-height: 80vh;
		overflow: auto;
		box-shadow: 0 24px 60px -12px rgba(15, 23, 42, 0.3);
		border: 1px solid var(--color-border, #e5e7eb);
		animation: pop-in 140ms ease-out;
	}
	.modal.wide {
		max-width: 760px;
	}
	@keyframes pop-in {
		from { opacity: 0; transform: scale(0.97); }
		to { opacity: 1; transform: scale(1); }
	}
	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.9rem 1rem;
		border-bottom: 1px solid var(--color-border, #e5e7eb);
	}
	.title {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	.title h2 {
		margin: 0;
		font-size: 1rem;
		font-weight: 600;
	}
	.title .dot {
		width: 0.5rem;
		height: 0.5rem;
		border-radius: 50%;
		background: #9ca3af;
	}
	.title .dot[data-tone='ok'] { background: #22c55e; }
	.title .dot[data-tone='warn'] { background: #f59e0b; }
	.title .dot[data-tone='err'] { background: #dc2626; }
	.title .dot[data-tone='pending'] {
		background: #3b82f6;
		animation: pulse 1.2s ease-in-out infinite;
	}
	@keyframes pulse {
		0%, 100% { opacity: 1; }
		50% { opacity: 0.4; }
	}
	.close {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.75rem;
		height: 1.75rem;
		background: transparent;
		border: none;
		border-radius: 6px;
		cursor: pointer;
		color: var(--color-muted-foreground, #6b7280);
		transition: background 120ms ease, color 120ms ease;
	}
	.close:hover {
		background: var(--color-accent, rgba(0, 0, 0, 0.05));
		color: var(--color-foreground);
	}
	.foot {
		display: flex;
		gap: 0.5rem;
		justify-content: flex-end;
		padding: 0.75rem 1rem;
		border-top: 1px solid var(--color-border, #e5e7eb);
	}
</style>
