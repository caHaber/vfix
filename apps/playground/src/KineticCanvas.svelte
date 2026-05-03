<script lang="ts">
import Info from '@lucide/svelte/icons/info';
import { bindWasmRasterizer, GlyphAtlas, initWasmFont } from '@variable-font/atlas';
import { AtlasRenderer } from '@variable-font/atlas-webgl';
import {
	BatchedInterpolator,
	getWasm,
	getWasmDiagnostics,
	isWasmReady,
	type LayoutWord,
	loadWasm,
	MetricsProvider,
	type WasmDiagnostics,
} from '@variable-font/core';
import { onDestroy, onMount } from 'svelte';
import { Button } from '$lib/components/ui/button';
import { InfoButton, Modal, StatusPill } from '$lib/components/ui/info';
import {
	buildGlyphLayout,
	type GlyphLayout,
	packInstances,
	totalGlyphCount,
} from '$lib/kinetic/glyph-pipeline';
import readmeRaw from '../../../README.md?raw';

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

const FONT_URL = '/fonts/Recursive/Recursive_VF.ttf';

const metrics = new MetricsProvider({
	fontFamily: FONT_FAMILY,
	fontSize: FONT_SIZE,
	lineHeight: LINE_HEIGHT,
});

type LineGroup = { lineIndex: number; y: number; words: { word: LayoutWord; idx: number }[] };

let words = $state<LayoutWord[]>([]);
let lineGroups = $state<LineGroup[]>([]);
let totalHeight = $state(0);
let container: HTMLElement;
let canvasEl: HTMLCanvasElement;
let containerWidth = $state(0);

let batched: BatchedInterpolator | null = null;
let centers: Float32Array | null = null;
let containerRect: DOMRect | null = null;
// Reactive: the debug pill and modal read atlas fields like usedBytes/dpr.
let atlas = $state<GlyphAtlas | null>(null);
let renderer: AtlasRenderer | null = null;
let glyphLayout: GlyphLayout | null = null;
let lastAxes: Float32Array | null = null;
let frameRaf: number | null = null;

let unsub: (() => void) | null = null;

let wasmDiag = $state<WasmDiagnostics>(getWasmDiagnostics());
let showWasmDebug = $state<boolean>(false);
let showAbout = $state<boolean>(false);
let fontLoadState = $state<'pending' | 'ok' | 'err'>('pending');
let fontLoadError = $state<string | null>(null);
let atlasHits = $state(0);
let atlasMisses = $state(0);
let atlasDeferred = $state(0);
let atlasEntries = $state(0);

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
	if (wasmDiag.initError || fontLoadState === 'err') return 'err';
	if (wasmDiag.loaded && wasmDiag.backend === 'wasm' && fontLoadState === 'ok') return 'ok';
	if (wasmDiag.loaded && wasmDiag.backend === 'js-stub') return 'warn';
	if (wasmDiag.loading || fontLoadState === 'pending') return 'pending';
	return 'idle';
});

let wordCount = $derived(words.length);

function formatBytes(n: number | null): string {
	if (n == null) return '—';
	if (n < 1024) return `${n} B`;
	if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`;
	return `${(n / 1024 / 1024).toFixed(2)} MiB`;
}

async function bootstrap() {
	try {
		const wasm = await loadWasm();
		refreshWasmDiag();

		const fontResp = await fetch(FONT_URL);
		if (!fontResp.ok) throw new Error(`Font fetch failed: ${fontResp.status}`);
		const fontBytes = new Uint8Array(await fontResp.arrayBuffer());
		const ok = initWasmFont(wasm, fontBytes);
		if (!ok) throw new Error('init_font rejected the supplied bytes');
		fontLoadState = 'ok';

		const dpr = window.devicePixelRatio || 1;
		atlas = new GlyphAtlas({
			rasterize: bindWasmRasterizer(wasm),
			sizePx: FONT_SIZE,
			dpr,
		});
		renderer = new AtlasRenderer({ canvas: canvasEl, atlas });
		renderer.resize(containerWidth, totalHeight, dpr);

		doLayout(containerWidth);
	} catch (err) {
		fontLoadError = err instanceof Error ? err.message : String(err);
		fontLoadState = 'err';
		refreshWasmDiag();
	}
}

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

function readForegroundColor(): [number, number, number, number] {
	// Read the CSS foreground once per layout. Cheaper than per-frame.
	if (typeof getComputedStyle === 'undefined' || !container) return [0, 0, 0, 1];
	const cssColor = getComputedStyle(container).color;
	// rgb(r, g, b) or rgba(r, g, b, a)
	const m = cssColor.match(/rgba?\(([^)]+)\)/);
	if (!m) return [0, 0, 0, 1];
	const parts = m[1].split(',').map((p) => Number.parseFloat(p));
	const r = (parts[0] ?? 0) / 255;
	const g = (parts[1] ?? 0) / 255;
	const b = (parts[2] ?? 0) / 255;
	const a = parts[3] ?? 1;
	return [r, g, b, a];
}

let foregroundColor: [number, number, number, number] = [0, 0, 0, 1];

function applyCurrent(cur: Float32Array) {
	// Keep the latest axes Float32Array reference so the RAF loop has
	// the freshest snapshot. Don't draw here directly — we coalesce all
	// per-frame work into a single requestAnimationFrame to avoid double
	// draws when subscribers fire mid-frame.
	lastAxes = cur;
	if (frameRaf === null) frameRaf = requestAnimationFrame(drawFrame);
}

function drawFrame() {
	frameRaf = null;
	if (!renderer || !atlas || !glyphLayout || !lastAxes) return;

	atlas.tick();

	const scrollY = window.scrollY || 0;
	const viewportH = window.innerHeight || 0;
	const containerTop = container ? container.getBoundingClientRect().top + scrollY : 0;
	const cullTop = scrollY - containerTop - LINE_HEIGHT * 2;
	const cullBottom = scrollY + viewportH - containerTop + LINE_HEIGHT * 2;

	const requiredCapacity = totalGlyphCount(glyphLayout);
	const ensured = renderer.ensureCapacity(requiredCapacity);

	const count = packInstances({
		words,
		layout: glyphLayout,
		axesFlat: lastAxes,
		axesPerWord: AXES_PER_WORD,
		atlas,
		instanceCpu: ensured,
		color: foregroundColor,
		cullTop,
		cullBottom,
		lineHeight: LINE_HEIGHT,
		dpr: atlas.dpr,
	});

	renderer.draw(count);

	atlasHits = atlas.hits;
	atlasMisses = atlas.misses;
	atlasDeferred = atlas.deferred;
	atlasEntries = atlas.entryCount;

	maybeScheduleAtlasPrune();
}

let prunePending = false;
function maybeScheduleAtlasPrune() {
	if (prunePending || !atlas) return;
	if (!atlas.shouldPrune()) return;
	prunePending = true;
	const run = () => {
		prunePending = false;
		if (!atlas) return;
		atlas.rebuild(240);
	};
	// requestIdleCallback isn't on Safari; fall back to a chunky timeout
	// so the rebuild doesn't run during active interaction.
	const w = window as Window & {
		requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
	};
	if (typeof w.requestIdleCallback === 'function') {
		w.requestIdleCallback(run, { timeout: 4000 });
	} else {
		setTimeout(run, 1500);
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

function doLayout(_widthHint: number) {
	// Use the canvas's actual displayed width as the layout source.
	// The parent .kinetic-wrap has padding, so its clientWidth is wider
	// than the canvas/field by 2× the horizontal padding; laying out
	// against the wrap's width would put right-edge words past the
	// canvas right boundary and they'd get clipped by the GL viewport.
	const layoutWidth = canvasEl?.clientWidth ?? _widthHint;
	if (layoutWidth <= 0) return;
	if (!isWasmReady()) return;
	const wasm = getWasm();
	const result = metrics.layout(TEXT, layoutWidth);
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
	words = result.words;
	lineGroups = groupByLine(result.words);
	totalHeight = result.totalHeight;
	foregroundColor = readForegroundColor();

	glyphLayout = buildGlyphLayout(result.words, wasm, FONT_SIZE);

	// Prime the atlas at rest axes so the first paint after mount shows
	// the full text instead of empty fallbacks. Outside the per-frame
	// budget — this is a deliberate one-shot at layout time.
	if (atlas) {
		atlas.primeText(TEXT, {
			wght: WGHT_MIN,
			casl: 0,
			slnt: 0,
			mono: 0,
			crsv: 0,
		});
	}

	batched = new BatchedInterpolator({
		groups: newCount,
		axesPerGroup: AXES_PER_WORD,
		initial,
		stiffness,
		epsilon: 0.5,
		curveType: 2,
	});

	unsub = batched.subscribe((cur) => applyCurrent(cur));

	// Defer the canvas resize to the next frame so Svelte commits the
	// new totalHeight inline style first; sizing the canvas before the
	// CSS lays it out reads the previous size.
	requestAnimationFrame(syncCanvasSize);

	containerRect = container.getBoundingClientRect();
	// Schedule an initial draw even if interpolator hasn't ticked yet.
	if (frameRaf === null) frameRaf = requestAnimationFrame(drawFrame);
}

let resizeObserver: ResizeObserver;
let canvasResizeObserver: ResizeObserver;

function onScroll() {
	if (container) containerRect = container.getBoundingClientRect();
	if (frameRaf === null) frameRaf = requestAnimationFrame(drawFrame);
}

function syncCanvasSize() {
	if (!renderer || !canvasEl) return;
	const dpr = atlas?.dpr ?? window.devicePixelRatio ?? 1;
	// Authoritative canvas size = whatever CSS actually rendered. The
	// drawing buffer must match this exactly or the GL output gets
	// stretched/squished by the browser when blitting to the page.
	const w = canvasEl.clientWidth;
	const h = canvasEl.clientHeight;
	if (w <= 0 || h <= 0) return;
	renderer.resize(w, h, dpr);
	if (frameRaf === null) frameRaf = requestAnimationFrame(drawFrame);
}

let dprMql: MediaQueryList | null = null;
function onDprChange() {
	if (!atlas) return;
	const dpr = window.devicePixelRatio || 1;
	if (dpr === atlas.dpr) return;
	// Atlas was rasterized at old dpr; rebuild at the new one. Cheaper to
	// nuke and let it repopulate than to scale existing entries.
	atlas = new GlyphAtlas({
		rasterize: bindWasmRasterizer(getWasm()),
		sizePx: FONT_SIZE,
		dpr,
	});
	if (renderer) {
		renderer.destroy();
		renderer = new AtlasRenderer({ canvas: canvasEl, atlas });
		renderer.resize(containerWidth, totalHeight, dpr);
	}
	if (frameRaf === null) frameRaf = requestAnimationFrame(drawFrame);
}

onMount(() => {
	containerWidth = container.clientWidth;
	bootstrap();

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

	canvasResizeObserver = new ResizeObserver(() => syncCanvasSize());
	if (canvasEl) canvasResizeObserver.observe(canvasEl);

	window.addEventListener('scroll', onScroll, { passive: true });
	window.addEventListener('resize', onScroll, { passive: true });

	if (typeof window.matchMedia === 'function') {
		dprMql = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
		dprMql.addEventListener('change', onDprChange);
	}
});

onDestroy(() => {
	resizeObserver?.disconnect();
	canvasResizeObserver?.disconnect();
	window.removeEventListener('scroll', onScroll);
	window.removeEventListener('resize', onScroll);
	dprMql?.removeEventListener('change', onDprChange);
	if (frameRaf !== null) cancelAnimationFrame(frameRaf);
	cancelRipple();
	unsub?.();
	batched?.destroy();
	renderer?.destroy();
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

let rippleRaf: number | null = null;
let rippleState: {
	distances: Float32Array;
	peaked: Uint8Array;
	returned: Uint8Array;
	startMs: number;
} | null = null;
const PEAK_SPEED_MS_PER_PX = 0.5;
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
			<span>wasm atlas + webgl2</span>
			{#if atlasEntries > 0}
				<span class="sep">/</span>
				<span>atlas: {atlasEntries}g · {atlasHits}h/{atlasMisses}m{atlasDeferred > 0 ? `/${atlasDeferred}d` : ''}</span>
			{/if}
		</div>
		<div class="status-cluster">
			<StatusPill
				tone={wasmStatusTone}
				label={wasmStatusLabel}
				meta={wasmDiag.loaded && wasmDiag.initDurationMs !== null
					? `${wasmDiag.initDurationMs.toFixed(1)} ms`
					: undefined}
				title="Click for renderer debug info"
				onclick={() => {
					refreshWasmDiag();
					showWasmDebug = true;
				}}
			/>
			<InfoButton onclick={() => (showAbout = true)} label="About this renderer" />
		</div>
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
			<canvas class="kinetic-canvas" bind:this={canvasEl}></canvas>

			<!-- A11y mirror: invisible to GPU pipeline, present in the DOM so
			     selection, find-in-page and screen readers see real text. -->
			<div class="kinetic-mirror" aria-hidden="false">
				{#each lineGroups as group (group.lineIndex)}
					<div class="line" style="top: {group.y}px; height: {LINE_HEIGHT}px;">
						{#each group.words as { word, idx } (idx)}
							<span class="word" style="left: {word.x}px;">{word.text}</span>
						{/each}
					</div>
				{/each}
			</div>
		</div>
	</div>
</div>

<Modal
	open={showWasmDebug}
	title="Renderer debug"
	ariaLabel="Renderer debug info"
	headTone={wasmStatusTone}
	badge={wasmDiag.backend}
	onClose={() => (showWasmDebug = false)}
>
	{#snippet children()}
		<dl class="diag">
			<dt>Pipeline</dt>
			<dd>WASM rasterizer → R8 atlas → WebGL2 instanced quad</dd>
			<dt>Backend</dt>
			<dd>
				<code>{wasmDiag.backend}</code>
			</dd>
			<dt>Font</dt>
			<dd>
				{#if fontLoadState === 'ok'}
					<code>Recursive_VF.ttf</code> loaded
				{:else if fontLoadState === 'err'}
					<span class="hint-text">error: {fontLoadError}</span>
				{:else}
					loading…
				{/if}
			</dd>
			<dt>Atlas entries</dt>
			<dd>{atlasEntries} glyphs ({atlasHits} hits / {atlasMisses} misses)</dd>
			<dt>Atlas bytes used</dt>
			<dd>{formatBytes(atlas?.usedBytes ?? null)} / {formatBytes(atlas?.maxBytes ?? null)}</dd>
			<dt>Atlas size</dt>
			<dd>{atlas?.textureSize ?? '—'}² R8 (DPR ×{atlas?.dpr ?? '—'})</dd>
			<dt>init duration</dt>
			<dd>{wasmDiag.initDurationMs !== null ? `${wasmDiag.initDurationMs.toFixed(2)} ms` : '—'}</dd>
			<dt>WASM memory</dt>
			<dd>{formatBytes(wasmDiag.wasmMemoryBytes)}</dd>
			<dt>WebAssembly support</dt>
			<dd>{wasmEnv.hasWebAssembly ? 'yes' : 'no'}</dd>
			<dt>crossOriginIsolated</dt>
			<dd>{wasmEnv.crossOriginIsolated ? 'yes' : 'no'}</dd>
			<dt>User agent</dt>
			<dd class="ua">{wasmEnv.userAgent}</dd>
		</dl>
	{/snippet}
	{#snippet foot()}
		<Button variant="outline" onclick={refreshWasmDiag}>Refresh</Button>
		<Button onclick={() => (showWasmDebug = false)}>Close</Button>
	{/snippet}
</Modal>

<Modal
	open={showAbout}
	title="How this renders"
	ariaLabel="About the kinetic GPU renderer"
	width="wide"
	badge="GPU"
	onClose={() => (showAbout = false)}
>
	{#snippet icon()}
		<Info class="size-5" />
	{/snippet}
	{#snippet children()}
		<div class="about-body">
				<p class="lead">
					Every word on this page renders <strong>without using the browser's font system</strong>.
					Glyph bitmaps are produced on demand by Rust compiled to WebAssembly,
					packed into a single GPU texture, and drawn in one WebGL2 call per
					frame.
				</p>

				<h3>Why it exists</h3>
				<p>
					The CSS <code>font</code> shorthand on
					<code>&lt;canvas&gt;</code> only carries weight, style, size and family.
					Variable-font axes like <code>CASL</code>, <code>CRSV</code>,
					<code>MONO</code> have no canvas API across browsers
					(<a
						href="https://github.com/whatwg/html/issues/3571"
						target="_blank"
						rel="noopener noreferrer">whatwg/html#3571</a
					>, open since 2018). The DOM tab next to this one uses
					<code>font-variation-settings</code> via per-word
					<code>&lt;span&gt;</code>s — that works, but the engine churns through
					thousands of style recalcs per frame.
				</p>

				<h3>The pipeline</h3>
				<ol class="pipeline">
					<li>
						<strong>Layout (Pretext)</strong> — segments + line-breaks the README
						prose at the canvas's content width, producing word
						<code>(x, y, width)</code> rects.
					</li>
					<li>
						<strong>WASM rasterizer (swash)</strong> — for each
						<code>(codepoint, axis-tuple, size)</code>, returns an
						R8 alpha bitmap and metrics. The font is the actual variable
						<code>Recursive_VF.ttf</code> served from
						<code>/fonts/Recursive/</code>; no Google Fonts CDN at runtime.
					</li>
					<li>
						<strong>R8 atlas</strong> — bitmaps are packed into a
						2048×2048 single-channel texture via a shelf packer. Axis tuples
						are quantized into buckets (wght step 25, CASL 0.125, slnt 2°,
						CRSV 0.5, MONO collapsed) so 5D continuous interpolation reuses a
						finite cache. Idle-time pruning compacts the atlas in pixel
						space — no re-rasterization round-trips.
					</li>
					<li>
						<strong>WebGL2 instanced draw</strong> — every visible glyph is one
						instance carrying <code>posSize</code>, two atlas UV rects, a
						blend coefficient, and color. The fragment shader samples the two
						UV rects (low + high bucket along the moving axis) and lerps —
						<em>continuous-looking output from a discrete cache</em>. One
						<code>drawArraysInstanced</code> per frame regardless of word
						count.
					</li>
				</ol>

				<h3>What's novel about it</h3>
				<p>
					The constituent pieces (glyph atlas, WASM rasterization, instanced
					quads) are old. Combining them into a <strong
						>WASM-rasterized variable-font atlas with cross-bucket axis
						blending in a custom shader</strong
					> is the niche this fills. As of 2026-05 there isn't a public npm
					library that does this — closest cousins are
					<code>troika-three-text</code> (static MSDF, no variable axes) and
					Skia's <code>CanvasKit</code> (works but ships ~3 MB of WASM for the
					full Skia surface).
				</p>

				<h3>What you're seeing</h3>
				<ul>
					<li>
						<strong>Bloom</strong> — mouse position drives a smoothstep
						falloff (computed in WASM); each word's
						<code>wght/CASL/slnt/MONO/CRSV</code> springs toward the resulting
						target.
					</li>
					<li>
						<strong>Click ripple</strong> — single RAF wave-front drives
						per-word <code>setTargetGroup</code> calls timed by distance from
						the click.
					</li>
					<li>
						<strong>Selection / find-in-page</strong> — a hidden DOM mirror
						sits behind the canvas with transparent text at the same word
						positions, so accessibility, native selection, and Cmd-F all
						still work.
					</li>
					<li>
						<strong>The pill on the right</strong> — backend
						(<code>wasm</code> vs <code>js-stub</code>), atlas counts (entries,
						hits, misses, deferreds), and renderer state. Click it for the
						full debug breakdown.
					</li>
				</ul>

				<h3>Tradeoffs vs the DOM tab</h3>
				<ul>
					<li>
						<strong>1 GPU draw call vs N DOM nodes.</strong> Style recalc cost
						is constant regardless of word count.
					</li>
					<li>
						Glyph layout is locked at neutral-axis advances — Pretext stays
						the layout authority, only intra-word glyph positioning is
						handled by this renderer.
					</li>
					<li>
						Single-axis cross-bucket blend per frame; the other four axes
						snap to nearest bucket. With 25-wght-step blends the visual
						stepping is sub-pixel.
					</li>
					<li>
						No ligatures or contextual shaping in v1 — the
						<code>swash::shape</code> path is queued for a follow-up.
					</li>
				</ul>
			</div>
	{/snippet}
	{#snippet foot()}
		<Button onclick={() => (showAbout = false)}>Got it</Button>
	{/snippet}
</Modal>

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
		/* Padding lives here visually but the layout/canvas sizing uses the
		 * inner .kinetic-field's width. Container.clientWidth includes
		 * padding, so we measure canvasEl.clientWidth for the actual layout
		 * width (see syncCanvasSize / doLayout).
		 */
		cursor: crosshair;
		user-select: text;
		flex: 1;
		box-sizing: border-box;
		display: flex;
		flex-direction: column;
		padding: 1.5rem 2rem 2rem;
	}

	.kinetic-field {
		/* No flex:1: the field's height is the layout's totalHeight. With
		 * flex-grow the parent's flex column would stretch this to fill the
		 * page; the canvas's drawing buffer (sized to totalHeight × dpr)
		 * would then be scaled onto the larger display height, producing the
		 * "2/3 height" visual squish. The CSS DOM tab can get away with
		 * flex:1 because its words are absolutely positioned and don't care
		 * about parent height.
		 */
		position: relative;
		font-family: 'Recursive', system-ui;
		color: var(--color-foreground);
		-webkit-font-smoothing: antialiased;
	}

	.kinetic-canvas {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		display: block;
		pointer-events: none;
	}

	.kinetic-mirror {
		position: absolute;
		inset: 0;
		color: transparent;
		pointer-events: none;
		caret-color: transparent;
		user-select: text;
	}
	.kinetic-mirror .line {
		position: absolute;
		left: 0;
		right: 0;
	}
	.kinetic-mirror .word {
		position: absolute;
		top: 0;
		white-space: nowrap;
		pointer-events: auto;
	}

	.status-cluster {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		flex-shrink: 0;
	}

	.about-body {
		padding: 1rem 1.25rem;
		font-size: 0.88rem;
		line-height: 1.55;
	}
	.about-body p {
		margin: 0 0 0.75rem 0;
	}
	.about-body .lead {
		font-size: 0.95rem;
		color: var(--color-foreground);
	}
	.about-body h3 {
		margin: 1.1rem 0 0.4rem;
		font-size: 0.78rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--color-muted-foreground, #6b7280);
	}
	.about-body code {
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		font-size: 0.82em;
		background: var(--color-muted, rgba(0, 0, 0, 0.05));
		padding: 0.05rem 0.35rem;
		border-radius: 4px;
	}
	.about-body a {
		color: var(--color-foreground);
		text-decoration: underline;
		text-decoration-color: color-mix(in srgb, var(--color-foreground) 35%, transparent);
		text-underline-offset: 2px;
	}
	.about-body a:hover {
		text-decoration-color: var(--color-foreground);
	}
	.about-body ul,
	.about-body ol.pipeline {
		margin: 0 0 0.75rem 0;
		padding-left: 1.2rem;
	}
	.about-body ol.pipeline {
		counter-reset: step;
		list-style: none;
		padding-left: 0;
	}
	.about-body ol.pipeline > li {
		position: relative;
		padding: 0.5rem 0.6rem 0.5rem 2.2rem;
		margin-bottom: 0.4rem;
		border-radius: 8px;
		background: color-mix(in srgb, var(--color-foreground) 4%, transparent);
		counter-increment: step;
	}
	.about-body ol.pipeline > li::before {
		content: counter(step);
		position: absolute;
		left: 0.55rem;
		top: 0.55rem;
		width: 1.3rem;
		height: 1.3rem;
		border-radius: 50%;
		background: var(--color-foreground);
		color: var(--color-background);
		display: inline-flex;
		align-items: center;
		justify-content: center;
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		font-size: 0.72rem;
		font-weight: 600;
	}
	.about-body ul li {
		margin-bottom: 0.25rem;
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
	.ua {
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		font-size: 0.7rem;
	}
</style>
