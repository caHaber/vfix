<script lang="ts">
interface Props {
	value: number;
	/** Callback fired as the user drags or types a new value. */
	onchange?: (value: number) => void;
	/** Renders a smaller pill suitable for child preview rectangles. */
	compact?: boolean;
	/** Disables interaction (lock mode or dimmed overview groups). */
	disabled?: boolean;
	title?: string;
}

let { value, onchange, compact = false, disabled = false, title }: Props = $props();

const tone = $derived.by(() => {
	if (value >= 0.85) return 'crit';
	if (value >= 0.65) return 'high';
	if (value >= 0.4) return 'med';
	if (value >= 0.2) return 'low';
	return 'bg';
});

const label = $derived.by(() => {
	if (value >= 0.85) return 'critical';
	if (value >= 0.65) return 'high';
	if (value >= 0.4) return 'medium';
	if (value >= 0.2) return 'low';
	return 'background';
});

const display = $derived(value.toFixed(2).replace(/^0\./, '.'));
const interactive = $derived(!compact && !disabled && !!onchange);

let popoverOpen = $state(false);
let popoverInput = $state('0.5');
let dragging = $state(false);
let dragStartY = 0;
let dragStartValue = 0;
let dragMoved = false;

function onPointerDown(event: PointerEvent) {
	if (!interactive) return;
	if (event.button !== 0) return;
	dragging = true;
	dragMoved = false;
	dragStartY = event.clientY;
	dragStartValue = value;
	(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
	event.stopPropagation();
}

function onPointerMove(event: PointerEvent) {
	if (!dragging) return;
	const dy = dragStartY - event.clientY; // up = larger
	if (Math.abs(dy) > 2) dragMoved = true;
	const next = Math.max(0, Math.min(1, dragStartValue + dy / 200));
	if (Math.abs(next - value) > 0.001 && onchange) onchange(next);
}

function onPointerUp(event: PointerEvent) {
	if (!dragging) return;
	dragging = false;
	(event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
	if (!dragMoved) {
		popoverInput = value.toFixed(2);
		popoverOpen = true;
	}
}

function commitPopover() {
	const parsed = Number.parseFloat(popoverInput);
	if (Number.isFinite(parsed) && onchange) onchange(Math.max(0, Math.min(1, parsed)));
	popoverOpen = false;
}

function onPopoverKey(event: KeyboardEvent) {
	if (event.key === 'Enter') {
		event.preventDefault();
		commitPopover();
	} else if (event.key === 'Escape') {
		event.preventDefault();
		popoverOpen = false;
	}
}
</script>

{#if interactive}
	<button
		type="button"
		class="pill {tone}"
		class:compact
		class:dragging
		title={title ?? `${label} (${display}) — drag up/down to adjust`}
		onpointerdown={onPointerDown}
		onpointermove={onPointerMove}
		onpointerup={onPointerUp}
	>
		<span class="dot"></span>
		<span class="num">{display}</span>
	</button>
	{#if popoverOpen}
		<div
			class="pill-popover"
			role="dialog"
			aria-label="Importance"
			onclick={(e) => e.stopPropagation()}
			onkeydown={() => {}}
		>
			<input
				type="number"
				min="0"
				max="1"
				step="0.05"
				bind:value={popoverInput}
				onkeydown={onPopoverKey}
				onblur={commitPopover}
				autofocus
			/>
			<span class="pop-tone {tone}">{label}</span>
		</div>
	{/if}
{:else}
	<span class="pill {tone}" class:compact title={title ?? `${label} (${display})`}>
		<span class="dot"></span>
		{#if !compact}<span class="num">{display}</span>{/if}
	</span>
{/if}

<style>
	.pill {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 2px 8px;
		font-size: 11px;
		font-weight: 600;
		font-feature-settings: 'tnum';
		line-height: 1;
		border-radius: 999px;
		border: 1px solid color-mix(in srgb, var(--pill-color) 35%, transparent);
		background: color-mix(in srgb, var(--pill-color) 18%, var(--color-background));
		color: var(--pill-color);
		cursor: default;
		user-select: none;
		transition: transform 120ms ease;
		touch-action: none;
	}
	button.pill {
		cursor: ns-resize;
	}
	button.pill:hover {
		transform: translateY(-1px);
		background: color-mix(in srgb, var(--pill-color) 28%, var(--color-background));
	}
	button.pill.dragging {
		transform: scale(1.08);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--pill-color) 22%, transparent);
	}
	.compact {
		padding: 1px 5px;
		font-size: 9px;
		gap: 3px;
	}
	.dot {
		width: 6px;
		height: 6px;
		border-radius: 999px;
		background: var(--pill-color);
		box-shadow: 0 0 0 1px color-mix(in srgb, var(--pill-color) 50%, transparent);
	}
	.compact .dot {
		width: 5px;
		height: 5px;
	}
	.crit {
		--pill-color: hsl(0 75% 55%);
	}
	.high {
		--pill-color: hsl(28 90% 55%);
	}
	.med {
		--pill-color: hsl(48 92% 50%);
	}
	.low {
		--pill-color: hsl(212 80% 60%);
	}
	.bg {
		--pill-color: hsl(220 8% 55%);
	}

	.pill-popover {
		position: absolute;
		top: -50px;
		left: 0;
		display: inline-flex;
		align-items: center;
		gap: 8px;
		padding: 6px 8px;
		background: var(--color-card);
		border: 1px solid var(--color-border);
		border-radius: 8px;
		box-shadow: 0 6px 20px rgb(15 30 60 / 0.18);
		z-index: 5;
	}
	.pill-popover input {
		width: 64px;
		padding: 4px 6px;
		font-size: 12px;
		font-feature-settings: 'tnum';
		border: 1px solid var(--color-border);
		border-radius: 4px;
		background: var(--color-input);
		color: var(--color-card-foreground);
	}
	.pop-tone {
		font-size: 10px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--pill-color);
	}
</style>
