<script lang="ts">
	import {
		Renderer,
		Interpolator,
		easeOutCubic,
		type LayoutWord,
	} from '@variable-font/core';
	import { onMount, onDestroy } from 'svelte';
	import readmeRaw from '../../../README.md?raw';

	// Strip markdown syntax so the kinetic field shows clean prose, not symbols.
	function readmeToProse(md: string): string {
		return md
			.replace(/```[\s\S]*?```/g, ' ') // fenced code blocks
			.replace(/`[^`]*`/g, ' ') // inline code
			.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ') // images
			.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // links → text
			.replace(/^>\s?/gm, '') // blockquote markers
			.replace(/^#{1,6}\s+/gm, '') // heading markers
			.replace(/^\s*[-*+]\s+/gm, '') // bullet markers
			.replace(/[*_~]+/g, '') // emphasis chars
			.replace(/\s+/g, ' ')
			.trim();
	}

	const TEXT = readmeToProse(readmeRaw);
	const FONT_FAMILY = 'Recursive';
	const FONT_SIZE = 32;
	const LINE_HEIGHT = 42;

	// --- Core renderer: Pretext for layout, WASM for interpolation ---
	const renderer = new Renderer({
		fontFamily: FONT_FAMILY,
		fontSize: FONT_SIZE,
		lineHeight: LINE_HEIGHT,
		axes: {
			wght: { tag: 'wght', min: 300, max: 1000, default: 400 },
			CASL: { tag: 'CASL', min: 0, max: 1, default: 0 },
			slnt: { tag: 'slnt', min: -15, max: 0, default: 0 },
			MONO: { tag: 'MONO', min: 0, max: 1, default: 0 },
			CRSV: { tag: 'CRSV', min: 0, max: 1, default: 0 },
		},
		stiffness: 0.06,
		easing: easeOutCubic,
	});

	// --- Layout state (Pretext-computed via core MetricsProvider) ---
	let wordLayout = $state<LayoutWord[]>([]);
	let totalHeight = $state(0);
	let container: HTMLElement;
	let containerWidth = $state(0);

	// --- Per-word interpolators + visual state ---
	let interpolators: Interpolator[] = [];
	let unsubs: (() => void)[] = [];
	let styles = $state<string[]>([]);
	let opacities = $state<number[]>([]);

	// Plain array for DOM refs — not $state, so $effect can't reset it
	let wordEls: (HTMLElement | null)[] = [];

	function doLayout(width: number) {
		if (width <= 0) return;

		const result = renderer.metrics.layout(TEXT, width);
		const newCount = result.words.length;
		const oldCount = interpolators.length;

		// Only rebuild interpolators if word count changed
		if (newCount !== oldCount) {
			unsubs.forEach((u) => u());
			interpolators.forEach((interp) => interp.destroy());

			styles = new Array(newCount).fill('"wght" 300');
			opacities = new Array(newCount).fill(0.15);
			wordEls = new Array(newCount).fill(null);

			interpolators = Array.from(
				{ length: newCount },
				(_, i) =>
					new Interpolator({
						axes: {
							wght: { tag: 'wght', min: 300, max: 1000, default: 300 },
							CASL: { tag: 'CASL', min: 0, max: 1, default: 0 },
							slnt: { tag: 'slnt', min: -15, max: 0, default: 0 },
							MONO: { tag: 'MONO', min: 0, max: 1, default: 0 },
							CRSV: { tag: 'CRSV', min: 0, max: 1, default: 0 },
						},
						stiffness: 0.15 + (i % 13) * 0.015,
						easing: easeOutCubic,
						epsilon: 0.5,
					}),
			);

			unsubs = interpolators.map((interp, i) =>
				interp.subscribe((axes) => {
					styles[i] = Object.entries(axes)
						.map(([k, v]) => `"${k}" ${v}`)
						.join(', ');
					opacities[i] = 0.15 + ((axes.wght - 300) / 700) * 0.85;
				}),
			);
		}

		wordLayout = result.words;
		totalHeight = result.totalHeight;
	}

	// --- Mount + resize ---
	let resizeObserver: ResizeObserver;

	onMount(() => {
		containerWidth = container.clientWidth;
		doLayout(containerWidth);

		resizeObserver = new ResizeObserver((entries) => {
			const w = entries[0].contentBoxSize[0].inlineSize;
			if (Math.abs(w - containerWidth) > 2) {
				containerWidth = w;
				doLayout(w);
			}
		});
		resizeObserver.observe(container);
	});

	onDestroy(() => {
		resizeObserver?.disconnect();
		unsubs.forEach((u) => u());
		interpolators.forEach((interp) => interp.destroy());
		renderer.destroy();
	});

	// --- Mouse interaction ---
	const RADIUS = 350;

	function onmousemove(e: MouseEvent) {
		const mx = e.clientX;
		const my = e.clientY;

		for (let i = 0; i < wordEls.length; i++) {
			const el = wordEls[i];
			if (!el || !interpolators[i]) continue;
			const rect = el.getBoundingClientRect();
			const cx = rect.left + rect.width / 2;
			const cy = rect.top + rect.height / 2;
			const dist = Math.hypot(mx - cx, my - cy);
			const raw = Math.max(0, 1 - dist / RADIUS);
			const p = raw * raw * raw;

			interpolators[i].setAll({
				wght: 300 + p * 700,
				CASL: raw * raw,
				slnt: -p * 15,
				MONO: Math.max(0, raw - 0.8) * 5,
				CRSV: p,
			});
		}
	}

	function onmouseleave() {
		for (const interp of interpolators) {
			interp.setAll({ wght: 300, CASL: 0, slnt: 0, MONO: 0, CRSV: 0 });
		}
	}

	function onclick(e: MouseEvent) {
		const mx = e.clientX;
		const my = e.clientY;

		for (let i = 0; i < wordEls.length; i++) {
			const el = wordEls[i];
			if (!el || !interpolators[i]) continue;
			const rect = el.getBoundingClientRect();
			const cx = rect.left + rect.width / 2;
			const cy = rect.top + rect.height / 2;
			const dist = Math.hypot(mx - cx, my - cy);
			const delay = dist * 0.5;
			const returnDelay = delay + 200 + dist * 0.15;
			const idx = i;

			setTimeout(() => {
				interpolators[idx]?.setAll({ wght: 1000, CASL: 1, slnt: -15, MONO: 0, CRSV: 1 });
			}, delay);

			setTimeout(() => {
				interpolators[idx]?.setAll({ wght: 300, CASL: 0, slnt: 0, MONO: 0, CRSV: 0 });
			}, returnDelay);
		}
	}
</script>

<div
	class="kinetic-wrap"
	role="presentation"
	bind:this={container}
	{onmousemove}
	{onmouseleave}
	{onclick}
>
	<div
		class="kinetic-field"
		style="height: {totalHeight}px; font-size: {FONT_SIZE}px; line-height: {LINE_HEIGHT}px;"
	>
		{#each wordLayout as word, i (word.x + '-' + word.y + '-' + word.text)}
			<span
				bind:this={wordEls[i]}
				class="word"
				style="
					transform: translate({word.x}px, {word.y}px);
					font-variation-settings: {styles[i] || '"wght" 300'};
					opacity: {opacities[i] ?? 0.15};
				"
			>{word.text}</span>
		{/each}
	</div>

	<footer class="hint">
		<span>move to bloom</span>
		<span class="sep">/</span>
		<span>click to ripple</span>
		<span class="sep">/</span>
		<span>{wordLayout.length} words</span>
		<span class="sep">/</span>
		<span>pretext layout + wasm interpolation</span>
	</footer>
</div>

<style>
	.kinetic-wrap {
		padding: 2rem 2rem 1.5rem;
		cursor: crosshair;
		user-select: none;
		min-height: calc(100vh - 57px);
		box-sizing: border-box;
		display: flex;
		flex-direction: column;
	}

	.kinetic-field {
		position: relative;
		font-family: 'Recursive', system-ui;
		color: var(--color-foreground);
		flex: 1;
		-webkit-font-smoothing: antialiased;
	}

	.word {
		position: absolute;
		top: 0;
		left: 0;
		white-space: nowrap;
		will-change: font-variation-settings, opacity;
	}

	.hint {
		font-size: 0.7rem;
		color: var(--color-muted-foreground);
		font-family: monospace;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		margin-top: 2rem;
		display: flex;
		gap: 0.6rem;
		flex-shrink: 0;
	}

	.sep {
		color: var(--color-border);
	}
</style>
