<script lang="ts">
import type { GroupRectOut } from '@vfir/cartographer';
import ImportancePill from './ImportancePill.svelte';

interface Props {
	group: GroupRectOut;
	drilled: boolean;
	dimmed: boolean;
	disabled: boolean;
	onclick?: (event: MouseEvent) => void;
	onimportanceChange?: (value: number) => void;
}

let { group, drilled, dimmed, disabled, onclick, onimportanceChange }: Props = $props();

const previewScale = $derived.by(() => {
	if (group.childPreview.length === 0) return 1;
	const contentX = 18;
	const contentY = 56;
	const contentW = group.w - 36;
	const contentH = group.h - 56 - 18;
	let maxX = 0;
	let maxY = 0;
	for (const c of group.childPreview) {
		maxX = Math.max(maxX, c.x + c.w);
		maxY = Math.max(maxY, c.y + c.h);
	}
	if (maxX <= 0 || maxY <= 0) return { scale: 1, contentX, contentY };
	const sx = contentW / maxX;
	const sy = contentH / maxY;
	return { scale: Math.min(sx, sy, 1), contentX, contentY };
});
</script>

<div
	class="group-rect"
	class:drilled
	class:dimmed
	style="
		left: {group.x}px;
		top: {group.y}px;
		width: {group.w}px;
		height: {group.h}px;
		opacity: {dimmed ? 0.35 : group.opacity};
	"
	role="button"
	tabindex="0"
	data-group-id={group.id}
	{onclick}
	onkeydown={(e) => {
		if ((e.key === 'Enter' || e.key === ' ') && onclick) {
			e.preventDefault();
			onclick(e as unknown as MouseEvent);
		}
	}}
>
	<header class="head">
		<div class="head-text">
			<h3 class="label">{group.label}</h3>
			{#if group.summary}<p class="summary">{group.summary}</p>{/if}
		</div>
		<div class="head-aside">
			<ImportancePill
				value={group.importance}
				onchange={disabled ? undefined : onimportanceChange}
				disabled={disabled || dimmed}
				title="Phase importance: {group.importance.toFixed(2)}"
			/>
			<span class="meta">{group.childCount}</span>
		</div>
	</header>

	{#if !drilled && typeof previewScale === 'object'}
		<div class="preview" aria-hidden="true">
			{#each group.childPreview as child (child.id)}
				<span
					class="preview-rect"
					style="
						left: {previewScale.contentX + child.x * previewScale.scale}px;
						top: {previewScale.contentY + child.y * previewScale.scale}px;
						width: {child.w * previewScale.scale}px;
						height: {child.h * previewScale.scale}px;
					"
				></span>
			{/each}
		</div>
	{/if}
</div>

<style>
	.group-rect {
		position: absolute;
		border-radius: 22px;
		background: color-mix(in srgb, var(--color-muted) 60%, var(--color-background));
		border: 1.5px solid var(--color-border);
		box-shadow: 0 4px 16px rgb(15 30 60 / 0.06);
		cursor: pointer;
		transition: border-color 160ms ease, box-shadow 160ms ease, opacity 160ms ease;
		will-change: left, top;
		box-sizing: border-box;
	}
	.group-rect:hover {
		border-color: var(--color-ring);
	}
	.group-rect.drilled {
		border-color: var(--color-ring);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-ring) 25%, transparent);
		cursor: default;
	}
	.group-rect.dimmed {
		pointer-events: none;
	}
	.head {
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		height: 56px;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 10px 18px;
		background: linear-gradient(
			to bottom,
			var(--color-card),
			color-mix(in srgb, var(--color-card) 70%, transparent)
		);
		border-bottom: 1px solid var(--color-border);
		border-radius: 22px 22px 0 0;
		box-sizing: border-box;
		overflow: hidden;
	}
	.head-text {
		min-width: 0;
	}
	.label {
		margin: 0;
		font-size: 14px;
		font-weight: 600;
		letter-spacing: -0.01em;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		color: var(--color-card-foreground);
	}
	.summary {
		margin: 2px 0 0;
		font-size: 11.5px;
		color: var(--color-muted-foreground);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.meta {
		font-variant-numeric: tabular-nums;
		font-size: 11px;
		color: var(--color-muted-foreground);
		padding: 2px 8px;
		border-radius: 999px;
		background: var(--color-muted);
		flex-shrink: 0;
	}
	.head-aside {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		flex-shrink: 0;
	}
	.preview {
		position: absolute;
		inset: 0;
		pointer-events: none;
		overflow: hidden;
		border-radius: 22px;
	}
	.preview-rect {
		position: absolute;
		border-radius: 6px;
		background: color-mix(in srgb, var(--color-muted-foreground) 18%, transparent);
		border: 1px solid color-mix(in srgb, var(--color-muted-foreground) 25%, transparent);
		box-sizing: border-box;
	}
</style>
