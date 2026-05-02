<script lang="ts">
	import {
		BatchedInterpolator,
		MetricsProvider,
		loadWasm,
		isWasmReady,
		getWasm,
		getWasmDiagnostics,
		type LayoutWord,
		type WasmDiagnostics,
	} from '@variable-font/core';
	import { onMount, onDestroy } from 'svelte';
	import readmeRaw from '../../../README.md?raw';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import X from '@lucide/svelte/icons/x';

	function readmeToProse(md: string): string {
		return md
			.replace(/```[\s\S]*?```/g, ' ')
			.replace(/`[^`]*`/g, ' ')
			.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
			.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
			.replace(/^>\s?/gm, '')
			.replace(/^#{1,6}\s+/gm, '')
			.replace(/^\s*[-*+]\s+/gm, '')
			.replace(/[*_~]+/g, '')
			.replace(/\s+/g, ' ')
			.trim();
	}

	const TEXT = readmeToProse(readmeRaw);
	const FONT_FAMILY = 'Recursive';
	const FONT_SIZE = 22;
	const LINE_HEIGHT = 32;

	const AXES_PER_WORD = 5;
	const WGHT_MIN = 300;
	const WGHT_RANGE = 700;
	const SLNT_RANGE = 15;
	const REST_TARGETS: readonly number[] = [WGHT_MIN, 0, 0, 0, 0];
	const PEAK_TARGETS: readonly number[] = [WGHT_MIN + WGHT_RANGE, 1, -SLNT_RANGE, 0, 1];

	const RADIUS = 320;

	const metrics = new MetricsProvider({
		fontFamily: FONT_FAMILY,
		fontSize: FONT_SIZE,
		lineHeight: LINE_HEIGHT,
	});

	type LineGroup = { lineIndex: number; y: number; words: { word: LayoutWord; idx: number }[] };

	let lineGroups = $state<LineGroup[]>([]);
	let totalHeight = $state(0);
	let container: HTMLElement;
	let containerWidth = $state(0);

	let batched: BatchedInterpolator | null = null;
	let centers: Float32Array | null = null;
	let containerRect: DOMRect | null = null;

	const wordEls: (HTMLElement | null)[] = [];
	let unsub: (() => void) | null = null;

	let wasmDiag = $state<WasmDiagnostics>(getWasmDiagnostics());
	let showWasmDebug = $state<boolean>(false);
	const wasmEnv = {
		hasWebAssembly: typeof WebAssembly !== 'undefined',
		userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'n/a',
		crossOriginIsolated:
			typeof globalThis !== 'undefined' && 'crossOriginIsolated' in globalThis
				? ((globalThis as { crossOriginIsolated?: boolean }).crossOriginIsolated ?? false)
				: false,
	};

	function refreshWasmDiag() {
		wasmDiag = getWasmDiagnostics();
	}

	let wasmStatusLabel = $derived.by(() => {
		if (wasmDiag.loading) return 'Loading…';
		if (!wasmDiag.loaded) return 'Idle';
		if (wasmDiag.initError) return 'Error';
		if (wasmDiag.backend === 'wasm') return 'WASM active';
		if (wasmDiag.backend === 'js-stub') return 'JS fallback';
		return 'Loaded';
	});

	let wasmStatusTone = $derived.by(() => {
		if (wasmDiag.initError) return 'err';
		if (wasmDiag.loaded && wasmDiag.backend === 'wasm') return 'ok';
		if (wasmDiag.loaded && wasmDiag.backend === 'js-stub') return 'warn';
		if (wasmDiag.loading) return 'pending';
		return 'idle';
	});

	let wordCount = $derived(lineGroups.reduce((acc, g) => acc + g.words.length, 0));

	function formatBytes(n: number | null): string {
		if (n == null) return '—';
		if (n < 1024) return `${n} B`;
		if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`;
		return `${(n / 1024 / 1024).toFixed(2)} MiB`;
	}

	loadWasm()
		.then(() => refreshWasmDiag())
		.catch(() => refreshWasmDiag());

	function buildInitialAndStiffness(words: LayoutWord[]): {
		initial: Float32Array;
		stiffness: Float32Array;
		centers: Float32Array;
	} {
		const n = words.length;
		const initial = new Float32Array(n * AXES_PER_WORD);
		const stiffness = new Float32Array(n);
		const c = new Float32Array(n * 2);
		const halfLine = LINE_HEIGHT / 2;
		for (let i = 0; i < n; i++) {
			initial[i * AXES_PER_WORD + 0] = WGHT_MIN;
			stiffness[i] = 0.12 + (i % 13) * 0.012;
			const w = words[i];
			c[i * 2 + 0] = w.x + w.width / 2;
			c[i * 2 + 1] = w.y + halfLine;
		}
		return { initial, stiffness, centers: c };
	}

	function applyCurrent(cur: Float32Array, count: number) {
		// Imperative per-property writes — avoids re-parsing the whole inline
		// `style` attribute on every reactive change. Each word has 1000s of
		// updates per second during the bloom; this keeps recalc-styles cost
		// proportional to what actually changed.
		for (let i = 0; i < count; i++) {
			const el = wordEls[i];
			if (!el) continue;
			const base = i * AXES_PER_WORD;
			const wght = cur[base + 0];
			el.style.fontVariationSettings = `"wght" ${wght}, "CASL" ${cur[base + 1]}, "slnt" ${cur[base + 2]}, "MONO" ${cur[base + 3]}, "CRSV" ${cur[base + 4]}`;
			el.style.opacity = String(0.18 + ((wght - WGHT_MIN) / WGHT_RANGE) * 0.82);
		}
	}

	function groupByLine(words: LayoutWord[]): LineGroup[] {
		const groups: LineGroup[] = [];
		let prev = -1;
		for (let i = 0; i < words.length; i++) {
			const w = words[i];
			if (w.lineIndex !== prev) {
				groups.push({ lineIndex: w.lineIndex, y: w.y, words: [] });
				prev = w.lineIndex;
			}
			groups[groups.length - 1].words.push({ word: w, idx: i });
		}
		return groups;
	}

	function doLayout(width: number) {
		if (width <= 0) return;
		const result = metrics.layout(TEXT, width);
		const newCount = result.words.length;

		if (unsub) {
			unsub();
			unsub = null;
		}
		if (batched) {
			batched.destroy();
			batched = null;
		}
		cancelRipple();

		const { initial, stiffness, centers: c } = buildInitialAndStiffness(result.words);
		centers = c;

		// Don't clear surviving entries: Svelte reuses spans whose `idx` key is
		// unchanged and only fires the action's `update`, not `create`. Wiping
		// here would leave those slots null until the next destroy/create cycle.
		// Just trim length; action.create populates new slots, action.destroy
		// clears removed ones.
		if (wordEls.length > newCount) wordEls.length = newCount;

		batched = new BatchedInterpolator({
			groups: newCount,
			axesPerGroup: AXES_PER_WORD,
			initial,
			stiffness,
			epsilon: 0.5,
			curveType: 2,
		});

		unsub = batched.subscribe((cur) => applyCurrent(cur, newCount));

		lineGroups = groupByLine(result.words);
		totalHeight = result.totalHeight;

		containerRect = container.getBoundingClientRect();
	}

	function bindWord(node: HTMLElement, idx: number) {
		wordEls[idx] = node;
		node.style.fontVariationSettings = '"wght" 300, "CASL" 0, "slnt" 0, "MONO" 0, "CRSV" 0';
		node.style.opacity = '0.18';
		return {
			update(newIdx: number) {
				if (newIdx !== idx) {
					if (wordEls[idx] === node) wordEls[idx] = null;
					idx = newIdx;
				}
				// Always reattach: covers the doLayout path where the array may
				// have been re-sized or the current state is otherwise wrong.
				wordEls[idx] = node;
			},
			destroy() {
				if (wordEls[idx] === node) wordEls[idx] = null;
			},
		};
	}

	let resizeObserver: ResizeObserver;

	function onScroll() {
		if (container) containerRect = container.getBoundingClientRect();
	}

	onMount(() => {
		containerWidth = container.clientWidth;
		doLayout(containerWidth);

		resizeObserver = new ResizeObserver((entries) => {
			const w = entries[0].contentBoxSize[0].inlineSize;
			if (Math.abs(w - containerWidth) > 2) {
				containerWidth = w;
				doLayout(w);
			} else {
				containerRect = container.getBoundingClientRect();
			}
		});
		resizeObserver.observe(container);

		window.addEventListener('scroll', onScroll, { passive: true });
		window.addEventListener('resize', onScroll, { passive: true });
	});

	onDestroy(() => {
		resizeObserver?.disconnect();
		window.removeEventListener('scroll', onScroll);
		window.removeEventListener('resize', onScroll);
		cancelRipple();
		unsub?.();
		batched?.destroy();
	});

	function ensureRect(): DOMRect {
		if (containerRect) return containerRect;
		containerRect = container.getBoundingClientRect();
		return containerRect;
	}

	function computeRadialTargets(localX: number, localY: number): Float32Array {
		if (!centers) return new Float32Array(0);
		if (isWasmReady()) {
			const wasm = getWasm();
			const half = centers.length / 2;
			const cx = new Float32Array(half);
			const cy = new Float32Array(half);
			for (let i = 0; i < half; i++) {
				cx[i] = centers[i * 2 + 0];
				cy[i] = centers[i * 2 + 1];
			}
			return wasm.compute_radial_targets(
				cx,
				cy,
				localX,
				localY,
				RADIUS,
				WGHT_MIN,
				WGHT_RANGE,
				SLNT_RANGE,
			) as Float32Array;
		}
		const n = centers.length / 2;
		const out = new Float32Array(n * AXES_PER_WORD);
		const invR = 1 / RADIUS;
		for (let i = 0; i < n; i++) {
			const dx = localX - centers[i * 2 + 0];
			const dy = localY - centers[i * 2 + 1];
			const dist = Math.sqrt(dx * dx + dy * dy);
			const raw = Math.max(0, 1 - dist * invR);
			const p = raw * raw * (3 - 2 * raw);
			const o = i * AXES_PER_WORD;
			out[o + 0] = WGHT_MIN + p * WGHT_RANGE;
			out[o + 1] = raw * raw;
			out[o + 2] = -p * SLNT_RANGE;
			out[o + 3] = Math.max(0, raw - 0.5) * 2;
			out[o + 4] = p;
		}
		return out;
	}

	function onmousemove(e: MouseEvent) {
		if (!batched || !centers) return;
		const rect = ensureRect();
		const localX = e.clientX - rect.left;
		const localY = e.clientY - rect.top;
		const targets = computeRadialTargets(localX, localY);
		batched.setTargets(targets);
	}

	function onmouseleave() {
		if (!batched) return;
		const n = batched.groups;
		const rest = new Float32Array(n * AXES_PER_WORD);
		for (let i = 0; i < n; i++) {
			rest[i * AXES_PER_WORD + 0] = WGHT_MIN;
		}
		batched.setTargets(rest);
	}

	// --- Click ripple as a single RAF-driven wave instead of 2N setTimeouts ---
	let rippleRaf: number | null = null;
	let rippleState: {
		distances: Float32Array;
		peaked: Uint8Array;
		returned: Uint8Array;
		startMs: number;
	} | null = null;
	const PEAK_SPEED_MS_PER_PX = 0.5; // matches old delay = dist * 0.5
	const RETURN_DELAY_MS = 200;
	const RETURN_TAIL_MS_PER_PX = 0.15;

	function cancelRipple() {
		if (rippleRaf !== null) {
			cancelAnimationFrame(rippleRaf);
			rippleRaf = null;
		}
		rippleState = null;
	}

	function rippleTick() {
		rippleRaf = null;
		if (!rippleState || !batched) return;
		const elapsed = performance.now() - rippleState.startMs;
		let outstanding = false;
		const { distances, peaked, returned } = rippleState;
		const n = distances.length;
		for (let i = 0; i < n; i++) {
			const d = distances[i];
			const peakAt = d * PEAK_SPEED_MS_PER_PX;
			const returnAt = peakAt + RETURN_DELAY_MS + d * RETURN_TAIL_MS_PER_PX;
			if (!peaked[i]) {
				if (elapsed >= peakAt) {
					batched.setTargetGroup(i, PEAK_TARGETS);
					peaked[i] = 1;
				} else {
					outstanding = true;
				}
			}
			if (peaked[i] && !returned[i]) {
				if (elapsed >= returnAt) {
					batched.setTargetGroup(i, REST_TARGETS);
					returned[i] = 1;
				} else {
					outstanding = true;
				}
			}
		}
		if (outstanding) {
			rippleRaf = requestAnimationFrame(rippleTick);
		} else {
			rippleState = null;
		}
	}

	function onclick(e: MouseEvent) {
		if (!batched || !centers) return;
		const rect = ensureRect();
		const localX = e.clientX - rect.left;
		const localY = e.clientY - rect.top;
		const n = centers.length / 2;
		const distances = new Float32Array(n);
		for (let i = 0; i < n; i++) {
			const dx = localX - centers[i * 2 + 0];
			const dy = localY - centers[i * 2 + 1];
			distances[i] = Math.hypot(dx, dy);
		}
		// Cancel any prior ripple in flight; the new one supersedes it.
		cancelRipple();
		rippleState = {
			distances,
			peaked: new Uint8Array(n),
			returned: new Uint8Array(n),
			startMs: performance.now(),
		};
		rippleRaf = requestAnimationFrame(rippleTick);
	}
</script>

<div class="kinetic-shell">
	<header class="kinetic-bar">
		<div class="hint">
			<span>move to bloom</span>
			<span class="sep">/</span>
			<span>click to ripple</span>
			<span class="sep">/</span>
			<span>{wordCount} words</span>
			<span class="sep">/</span>
			<span>pretext layout + wasm interpolation</span>
		</div>
		<button
			type="button"
			class="wasm-status"
			data-tone={wasmStatusTone}
			onclick={() => {
				refreshWasmDiag();
				showWasmDebug = true;
			}}
			title="Click for WASM debug info"
		>
			<span class="dot" aria-hidden="true"></span>
			<span class="wasm-status-label">{wasmStatusLabel}</span>
			{#if wasmDiag.loaded && wasmDiag.initDurationMs !== null}
				<span class="wasm-status-meta">{wasmDiag.initDurationMs.toFixed(1)} ms</span>
			{/if}
		</button>
	</header>

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
			{#each lineGroups as group (group.lineIndex)}
				<div class="line" style="top: {group.y}px; height: {LINE_HEIGHT}px;">
					{#each group.words as { word, idx } (idx)}
						<span class="word" style="left: {word.x}px;" use:bindWord={idx}>{word.text}</span>
					{/each}
				</div>
			{/each}
		</div>
	</div>
</div>

{#if showWasmDebug}
	<div
		class="modal-backdrop"
		role="presentation"
		onclick={() => (showWasmDebug = false)}
		onkeydown={(e: KeyboardEvent) => {
			if (e.key === 'Escape') showWasmDebug = false;
		}}
	>
		<div
			class="modal"
			role="dialog"
			aria-modal="true"
			aria-label="WASM debug info"
			tabindex="-1"
			onclick={(e: MouseEvent) => e.stopPropagation()}
			onkeydown={(e: KeyboardEvent) => e.stopPropagation()}
		>
			<div class="modal-head">
				<div class="modal-title">
					<span class="dot" data-tone={wasmStatusTone} aria-hidden="true"></span>
					<h2>WASM debug</h2>
					<Badge variant="outline" class="font-mono">{wasmDiag.backend}</Badge>
				</div>
				<button
					type="button"
					class="close"
					onclick={() => (showWasmDebug = false)}
					aria-label="Close"
				>
					<X class="size-4" />
				</button>
			</div>
			<dl class="diag">
				<dt>Backend</dt>
				<dd>
					<code>{wasmDiag.backend}</code>
					{#if wasmDiag.backend === 'wasm'}
						<span class="hint-text">— compiled Rust → WebAssembly (interpolate_batch + compute_radial_targets)</span>
					{:else if wasmDiag.backend === 'js-stub'}
						<span class="hint-text">— pure-JS fallback (run <code>pnpm build:wasm</code> for real WASM)</span>
					{:else if !wasmDiag.loaded}
						<span class="hint-text">— not loaded yet</span>
					{/if}
				</dd>
				<dt>Loaded</dt>
				<dd>{wasmDiag.loaded ? 'yes' : wasmDiag.loading ? 'loading…' : 'no'}</dd>
				<dt>init() called</dt>
				<dd>{wasmDiag.initCalled ? 'yes' : 'no'}</dd>
				<dt>init duration</dt>
				<dd>{wasmDiag.initDurationMs !== null ? `${wasmDiag.initDurationMs.toFixed(2)} ms` : '—'}</dd>
				<dt>init error</dt>
				<dd>{wasmDiag.initError ?? 'none'}</dd>
				<dt>Loaded at</dt>
				<dd>{wasmDiag.loadedAt ? new Date(wasmDiag.loadedAt).toLocaleTimeString() : '—'}</dd>
				<dt>WASM memory</dt>
				<dd>{formatBytes(wasmDiag.wasmMemoryBytes)}</dd>
				<dt>Module exports ({wasmDiag.exportCount})</dt>
				<dd>
					{#if wasmDiag.exportNames.length === 0}
						—
					{:else}
						<div class="exports">
							{#each wasmDiag.exportNames as name (name)}
								<code>{name}</code>
							{/each}
						</div>
					{/if}
				</dd>
				<dt>WebAssembly support</dt>
				<dd>{wasmEnv.hasWebAssembly ? 'yes' : 'no'}</dd>
				<dt>crossOriginIsolated</dt>
				<dd>{wasmEnv.crossOriginIsolated ? 'yes' : 'no'}</dd>
				<dt>User agent</dt>
				<dd class="ua">{wasmEnv.userAgent}</dd>
			</dl>
			<div class="modal-foot">
				<Button variant="outline" onclick={refreshWasmDiag}>Refresh</Button>
				<Button onclick={() => (showWasmDebug = false)}>Close</Button>
			</div>
		</div>
	</div>
{/if}

<style>
	.kinetic-shell {
		display: flex;
		flex-direction: column;
		min-height: calc(100vh - 57px);
	}

	.kinetic-bar {
		position: sticky;
		top: 48px;
		z-index: 5;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 0.55rem 1.5rem;
		background: color-mix(in srgb, var(--color-background) 92%, transparent);
		backdrop-filter: blur(8px);
		border-bottom: 1px solid var(--color-border);
	}

	.hint {
		font-size: 0.7rem;
		color: var(--color-muted-foreground);
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		display: flex;
		gap: 0.6rem;
		flex-wrap: wrap;
	}

	.sep {
		color: var(--color-border);
	}

	.kinetic-wrap {
		padding: 1.5rem 2rem 2rem;
		cursor: crosshair;
		user-select: none;
		flex: 1;
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
		/* Bound paint propagation to inside the field. */
		contain: paint;
	}

	.line {
		position: absolute;
		left: 0;
		right: 0;
		/* Skip style/layout/paint for off-screen lines (Safari 18+, Chrome). */
		content-visibility: auto;
		contain-intrinsic-size: auto 32px;
	}

	.word {
		position: absolute;
		top: 0;
		white-space: nowrap;
		/*
		 * No `transform` and no `will-change`: those promote each word to its
		 * own composited layer, and `font-variation-settings` can't be GPU-
		 * accelerated anyway. Position via `left` so we stay paint-only.
		 */
	}

	.wasm-status {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.28rem 0.6rem;
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
	.wasm-status:hover {
		background: var(--color-accent, rgba(0, 0, 0, 0.04));
	}
	.wasm-status:active {
		transform: translateY(1px);
	}
	.wasm-status .dot {
		width: 0.5rem;
		height: 0.5rem;
		border-radius: 50%;
		background: #9ca3af;
		box-shadow: 0 0 0 3px rgba(156, 163, 175, 0.18);
	}
	.wasm-status[data-tone='ok'] .dot { background: #22c55e; box-shadow: 0 0 0 3px rgba(34, 197, 94, 0.18); }
	.wasm-status[data-tone='ok'] { border-color: rgba(34, 197, 94, 0.4); }
	.wasm-status[data-tone='warn'] .dot { background: #f59e0b; box-shadow: 0 0 0 3px rgba(245, 158, 11, 0.18); }
	.wasm-status[data-tone='warn'] { border-color: rgba(245, 158, 11, 0.4); }
	.wasm-status[data-tone='err'] .dot { background: #dc2626; box-shadow: 0 0 0 3px rgba(220, 38, 38, 0.18); }
	.wasm-status[data-tone='err'] { border-color: rgba(220, 38, 38, 0.4); }
	.wasm-status[data-tone='pending'] .dot {
		background: #3b82f6;
		animation: pulse 1.2s ease-in-out infinite;
	}
	.wasm-status-meta {
		color: var(--color-muted-foreground, #6b7280);
	}
	@keyframes pulse {
		0%, 100% { opacity: 1; }
		50% { opacity: 0.4; }
	}

	.modal-backdrop {
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
	@keyframes pop-in {
		from { opacity: 0; transform: scale(0.97); }
		to { opacity: 1; transform: scale(1); }
	}
	.modal-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.9rem 1rem;
		border-bottom: 1px solid var(--color-border, #e5e7eb);
	}
	.modal-title {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	.modal-title h2 {
		margin: 0;
		font-size: 1rem;
		font-weight: 600;
	}
	.modal-title .dot {
		width: 0.5rem;
		height: 0.5rem;
		border-radius: 50%;
		background: #9ca3af;
	}
	.modal-title .dot[data-tone='ok'] { background: #22c55e; }
	.modal-title .dot[data-tone='warn'] { background: #f59e0b; }
	.modal-title .dot[data-tone='err'] { background: #dc2626; }
	.modal-title .dot[data-tone='pending'] {
		background: #3b82f6;
		animation: pulse 1.2s ease-in-out infinite;
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
	.diag {
		display: grid;
		grid-template-columns: 9rem 1fr;
		gap: 0.5rem 1rem;
		margin: 0;
		padding: 1rem;
		font-size: 0.8rem;
	}
	.diag dt {
		color: var(--color-muted-foreground, #6b7280);
	}
	.diag dd {
		margin: 0;
		word-break: break-word;
	}
	.diag .hint-text {
		color: var(--color-muted-foreground, #6b7280);
		margin-left: 0.4rem;
	}
	.diag code {
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		background: var(--color-muted, rgba(0, 0, 0, 0.05));
		padding: 0.05rem 0.35rem;
		border-radius: 4px;
	}
	.exports {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
		max-height: 8rem;
		overflow: auto;
	}
	.ua {
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		font-size: 0.7rem;
	}
	.modal-foot {
		display: flex;
		gap: 0.5rem;
		justify-content: flex-end;
		padding: 0.75rem 1rem;
		border-top: 1px solid var(--color-border, #e5e7eb);
	}
</style>
