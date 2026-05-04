<script lang="ts">
import Pin from '@lucide/svelte/icons/pin';
import Sparkles from '@lucide/svelte/icons/sparkles';
import type { BlockRect } from '@vfir/cartographer';
import { tick } from 'svelte';
import ImportancePill from './ImportancePill.svelte';
import { typeAccent, typeLabel } from './type-style.js';

interface Props {
	block: BlockRect;
	selected: boolean;
	hidden: boolean;
	editing: boolean;
	disabled: boolean;
	onclick?: (event: MouseEvent) => void;
	ondblclick?: (event: MouseEvent) => void;
	onimportanceChange?: (value: number) => void;
	oneditCommit?: (text: string) => void;
	oneditCancel?: () => void;
}

let {
	block,
	selected,
	hidden,
	editing,
	disabled,
	onclick,
	ondblclick,
	onimportanceChange,
	oneditCommit,
	oneditCancel,
}: Props = $props();

const accent = $derived(typeAccent(block.type));

let textareaEl: HTMLTextAreaElement | null = null;
let draftText = $state(block.text);

$effect(() => {
	if (editing) {
		draftText = block.text;
		// Focus + select on next tick after render.
		tick().then(() => {
			if (textareaEl) {
				textareaEl.focus();
				textareaEl.select();
			}
		});
	}
});

function commit() {
	if (!editing) return;
	if (draftText !== block.text) oneditCommit?.(draftText);
	else oneditCancel?.();
}

function onKeydown(event: KeyboardEvent) {
	if (event.key === 'Escape') {
		event.preventDefault();
		oneditCancel?.();
	} else if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
		event.preventDefault();
		commit();
	}
}
</script>

<div
	class="block-rect"
	class:selected
	class:hidden
	class:editing
	style="
		left: {block.x}px;
		top: {block.y}px;
		width: {block.w}px;
		height: {block.h}px;
		opacity: {hidden ? 0.18 : block.opacity};
		--accent: {accent};
	"
	role="button"
	tabindex="0"
	data-block-id={block.id}
	{onclick}
	ondblclick={(e) => {
		if (disabled) return;
		ondblclick?.(e);
	}}
	onkeydown={(e) => {
		if ((e.key === 'Enter' || e.key === ' ') && onclick) {
			e.preventDefault();
			onclick(e as unknown as MouseEvent);
		}
	}}
>
	<span class="stripe"></span>
	<span class="pill-anchor">
		<ImportancePill
			value={block.importance}
			onchange={disabled ? undefined : onimportanceChange}
			disabled={disabled || editing}
			title="{typeLabel(block.type)} · importance {block.importance.toFixed(2)}"
		/>
	</span>

	{#if editing}
		<textarea
			class="text-edit"
			bind:this={textareaEl}
			bind:value={draftText}
			onblur={commit}
			onkeydown={onKeydown}
			placeholder="Type to set this block's text…"
		></textarea>
	{:else}
		<span class="text">{block.text || 'Empty — double-click to add text'}</span>
	{/if}

	<span class="badges">
		{#if block.source === 'refined'}
			<span class="badge refined" title="Added by Refiner">
				<Sparkles size={10} />
			</span>
		{/if}
		{#if block.pinned}
			<span class="badge pinned" title="Pinned (sim won't move it)">
				<Pin size={10} />
			</span>
		{/if}
	</span>
</div>

<style>
	.block-rect {
		position: absolute;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 28px 18px 14px;
		border-radius: 14px;
		background: var(--color-card);
		color: var(--color-card-foreground);
		border: 1px solid var(--color-border);
		box-shadow: 0 1px 2px rgb(15 30 60 / 0.06);
		cursor: pointer;
		transition: box-shadow 140ms ease, border-color 140ms ease;
		will-change: left, top;
		box-sizing: border-box;
	}
	.block-rect:hover {
		border-color: color-mix(in srgb, var(--accent) 35%, var(--color-border));
	}
	.block-rect.selected {
		border-color: var(--accent);
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 35%, transparent);
	}
	.block-rect.editing {
		border-color: var(--accent);
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 50%, transparent);
		cursor: text;
	}
	.block-rect.hidden {
		pointer-events: none;
		border-style: dashed;
	}
	.stripe {
		position: absolute;
		left: 0;
		top: 0;
		bottom: 0;
		width: 4px;
		background: var(--accent);
		border-radius: 14px 0 0 14px;
	}
	.pill-anchor {
		position: absolute;
		top: 8px;
		left: 14px;
		z-index: 1;
	}
	.text {
		display: -webkit-box;
		-webkit-line-clamp: 6;
		-webkit-box-orient: vertical;
		overflow: hidden;
		text-overflow: ellipsis;
		font-size: 13.5px;
		line-height: 1.4;
		text-align: center;
		color: var(--color-card-foreground);
	}
	.text-edit {
		flex: 1;
		width: 100%;
		height: 100%;
		padding: 0;
		font-family: inherit;
		font-size: 13.5px;
		line-height: 1.4;
		text-align: center;
		color: var(--color-card-foreground);
		background: transparent;
		border: none;
		outline: none;
		resize: none;
	}
	.badges {
		position: absolute;
		bottom: 6px;
		right: 8px;
		display: inline-flex;
		gap: 4px;
	}
	.badge {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 16px;
		height: 16px;
		border-radius: 999px;
		background: var(--color-muted);
		color: var(--color-muted-foreground);
	}
	.badge.refined {
		color: hsl(280 70% 60%);
		background: color-mix(in srgb, hsl(280 70% 60%) 15%, var(--color-muted));
	}
</style>
