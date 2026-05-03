<script lang="ts">
import AlertTriangle from '@lucide/svelte/icons/alert-triangle';
import Info from '@lucide/svelte/icons/info';
import KeyRound from '@lucide/svelte/icons/key-round';
import Loader2 from '@lucide/svelte/icons/loader-2';
import MessageSquare from '@lucide/svelte/icons/message-square';
import Sparkles from '@lucide/svelte/icons/sparkles';
import Zap from '@lucide/svelte/icons/zap';
import type { ContentBlock, Group, PositionedBlock, ResponseStructure } from '@vfir/cartographer';
import { Session, type StreamingLayout, serializeToPrompt } from '@vfir/cartographer';
import { onDestroy, onMount, tick } from 'svelte';
import { Button } from '$lib/components/ui/button';
import * as Card from '$lib/components/ui/card';
import { InfoButton, Modal, StatusPill } from '$lib/components/ui/info';
import { Input } from '$lib/components/ui/input';
import { Textarea } from '$lib/components/ui/textarea';

const LS_KEY = 'cartographer-api-key';

const SAMPLE = `You asked whether to use Postgres or DynamoDB for the new service.

**Use Postgres.** You already operate it, the access pattern is relational, and the projected scale (~50 RPS p99, ~200GB) is well under a single writer's limits for years.

Alternative: DynamoDB. Reasonable if the team commits to single-table design and you expect spiky bursts. But your team has no DDB experience and the queries are join-heavy.

Pros of Postgres:
- Existing ops knowledge
- Native joins, window functions
- Cheap at this scale

Cons of DynamoDB here:
- Schema-less design fights your relational data
- Query patterns require careful GSI planning

Caveat: if the write volume grows 10x in the next 12 months, revisit.

Context: the service handles order fulfillment events and downstream reporting joins.`;

type Status = 'idle' | 'streaming' | 'ready' | 'error';

let apiKey = $state('');
let responseText = $state(SAMPLE);
let status = $state<Status>('idle');
let errorMsg = $state('');
let container: HTMLElement;
let containerWidth = $state(800);
let containerHeight = $state(600);

let hiddenIds = $state<Set<string>>(new Set());
let selectedIds = $state<Set<string>>(new Set());
let hoveredBlockId = $state<string | null>(null);
let undoStack = $state<Array<Set<string>>>([]);
let showPreview = $state(false);
let copyFeedback = $state('');
let showAbout = $state(false);

let rendered = $state<PositionedBlock[]>([]);
let groups = $state<Group[]>([]);

// Pan/zoom: infinite canvas. panX/panY are screen-space offsets applied to
// the viewport. zoom is a scale factor. The world origin lives at (0,0) of
// the inner transform layer; the sim centers content around container/2.
let panX = $state(0);
let panY = $state(0);
let zoom = $state(1);

let isPanning = $state(false);
let panMoved = false;
let panStartX = 0;
let panStartY = 0;
let panOriginX = 0;
let panOriginY = 0;
// World-space center of the sim (frozen at createStreamingLayout time) —
// used so resetView recenters correctly even after the container resizes.
let worldCenterX = 0;
let worldCenterY = 0;

let session: Session | null = null;
let streamingLayout: StreamingLayout | null = null;
let abortController: AbortController | null = null;
let rafId: number | null = null;

// A settle-timer: keep stepping the sim for a bit after the last change
// (new block or edit) so it has time to relax, then pause until next change.
let settleEndTime = 0;

const hoveredGroupId = $derived.by(() => {
	if (!hoveredBlockId) return null;
	const block = rendered.find((b) => b.id === hoveredBlockId);
	return block?.groupId ?? null;
});

const groupBounds = $derived.by(() => {
	const out = new Map<
		string,
		{ x: number; y: number; width: number; height: number; members: PositionedBlock[] }
	>();
	for (const block of rendered) {
		if (!block.groupId) continue;
		if (hiddenIds.has(block.id)) continue;
		const d = block.diameter ?? Math.max(block.width, block.height);
		const existing = out.get(block.groupId);
		if (!existing) {
			out.set(block.groupId, {
				x: block.x,
				y: block.y,
				width: d,
				height: d,
				members: [block],
			});
		} else {
			const right = Math.max(existing.x + existing.width, block.x + d);
			const bottom = Math.max(existing.y + existing.height, block.y + d);
			existing.x = Math.min(existing.x, block.x);
			existing.y = Math.min(existing.y, block.y);
			existing.width = right - existing.x;
			existing.height = bottom - existing.y;
			existing.members.push(block);
		}
	}
	return out;
});

const groupsById = $derived(new Map(groups.map((g) => [g.id, g])));
const visibleCount = $derived(rendered.filter((b) => !hiddenIds.has(b.id)).length);
const hiddenCount = $derived(hiddenIds.size);

const statusTone = $derived.by<'ok' | 'warn' | 'err' | 'pending' | 'idle'>(() => {
	if (status === 'streaming') return 'pending';
	if (status === 'ready') return 'ok';
	if (status === 'error') return 'err';
	return 'idle';
});
const statusLabel = $derived.by(() => {
	if (status === 'streaming') return 'Streaming…';
	if (status === 'ready') return 'Mapped';
	if (status === 'error') return 'Error';
	return 'Ready';
});
const statusMeta = $derived.by(() => {
	if (status === 'ready' || status === 'streaming') {
		return `${visibleCount} block${visibleCount === 1 ? '' : 's'}`;
	}
	return undefined;
});

const previewText = $derived.by(() => {
	if (rendered.length === 0) return '';
	const blocks: ContentBlock[] = rendered.map((p) => ({
		id: p.id,
		text: p.text,
		type: p.type,
		importance: 0.5,
		groupId: p.groupId,
	}));
	const structure: ResponseStructure = { blocks, groups, relationships: [] };
	return serializeToPrompt(structure, { hiddenIds, positions: rendered });
});

onMount(() => {
	apiKey = localStorage.getItem(LS_KEY) ?? '';
	const ro = new ResizeObserver((entries) => {
		const box = entries[0].contentRect;
		containerWidth = Math.max(400, box.width);
		containerHeight = Math.max(500, box.height);
		// Intentionally do not call setBounds here — resize shouldn't drag
		// content around. The sim stays in its original coordinate frame
		// and the user pans/zooms the viewport instead.
	});
	ro.observe(container);

	const onWheel = (e: WheelEvent) => {
		e.preventDefault();
		const rect = container.getBoundingClientRect();
		const cx = e.clientX - rect.left;
		const cy = e.clientY - rect.top;
		const worldX = (cx - panX) / zoom;
		const worldY = (cy - panY) / zoom;
		const factor = Math.exp(-e.deltaY * 0.0015);
		const next = Math.max(0.2, Math.min(4, zoom * factor));
		zoom = next;
		panX = cx - worldX * next;
		panY = cy - worldY * next;
	};
	container.addEventListener('wheel', onWheel, { passive: false });

	return () => {
		ro.disconnect();
		container.removeEventListener('wheel', onWheel);
	};
});

onDestroy(() => {
	abortController?.abort();
	if (rafId !== null) cancelAnimationFrame(rafId);
});

function saveKey() {
	if (apiKey) localStorage.setItem(LS_KEY, apiKey);
}

function wakeSim(extraMs: number = 1200) {
	settleEndTime = Math.max(settleEndTime, performance.now() + extraMs);
	if (rafId === null) startLoop();
}

function startLoop() {
	function tick() {
		if (!streamingLayout) {
			rafId = null;
			return;
		}
		const positions = streamingLayout.step();
		rendered = positions;
		groups = streamingLayout.getGroups();

		const t = performance.now();
		const active = status === 'streaming' || t < settleEndTime || streamingLayout.energy() > 0.4;
		if (active) {
			rafId = requestAnimationFrame(tick);
		} else {
			rafId = null;
		}
	}
	rafId = requestAnimationFrame(tick);
}

async function run() {
	if (!apiKey.trim()) {
		errorMsg = 'Paste your Anthropic API key first.';
		status = 'error';
		return;
	}

	// Abort any prior run
	abortController?.abort();
	if (rafId !== null) {
		cancelAnimationFrame(rafId);
		rafId = null;
	}

	errorMsg = '';
	copyFeedback = '';
	hiddenIds = new Set();
	selectedIds = new Set();
	undoStack = [];
	rendered = [];
	groups = [];

	session = new Session({
		annotator: { apiKey: apiKey.trim() },
		fontFamily: 'Recursive',
		maxBlockWidth: Math.min(480, containerWidth * 0.55),
	});

	try {
		streamingLayout = await session.createStreamingLayout({
			width: containerWidth,
			height: containerHeight,
		});
	} catch (e) {
		errorMsg = e instanceof Error ? e.message : String(e);
		status = 'error';
		return;
	}

	worldCenterX = containerWidth / 2;
	worldCenterY = containerHeight / 2;
	resetView();
	status = 'streaming';
	wakeSim(2000);

	abortController = new AbortController();
	try {
		await session.streamAnnotate(
			responseText,
			(ev) => {
				if (!streamingLayout) return;
				if (ev.kind === 'block') {
					streamingLayout.addBlock(ev.block);
					wakeSim(1500);
				} else if (ev.kind === 'group') {
					streamingLayout.addGroup(ev.group);
				}
			},
			abortController.signal,
		);
		status = 'ready';
		wakeSim(1200);
	} catch (e) {
		if ((e as Error).name === 'AbortError') return;
		errorMsg = e instanceof Error ? e.message : String(e);
		status = 'error';
	}
}

function snapshotHidden() {
	undoStack = [...undoStack, new Set(hiddenIds)];
	if (undoStack.length > 50) undoStack = undoStack.slice(-50);
}

function hideIds(ids: Iterable<string>) {
	snapshotHidden();
	const next = new Set(hiddenIds);
	for (const id of ids) next.add(id);
	hiddenIds = next;
	selectedIds = new Set();
}

function undo() {
	if (undoStack.length === 0) return;
	const prev = undoStack[undoStack.length - 1];
	undoStack = undoStack.slice(0, -1);
	hiddenIds = prev;
}

function toggleSelect(id: string, shift: boolean) {
	if (shift) {
		const next = new Set(selectedIds);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		selectedIds = next;
	} else {
		selectedIds = new Set([id]);
	}
}

function selectGroup(groupId: string, additive: boolean) {
	const members = rendered
		.filter((b) => b.groupId === groupId && !hiddenIds.has(b.id))
		.map((b) => b.id);
	if (additive) {
		const next = new Set(selectedIds);
		for (const id of members) next.add(id);
		selectedIds = next;
	} else {
		selectedIds = new Set(members);
	}
}

function handleBlockClick(event: MouseEvent, id: string) {
	if (hiddenIds.has(id)) return;
	event.stopPropagation();
	if (event.altKey) {
		const block = rendered.find((b) => b.id === id);
		if (block?.groupId) {
			selectGroup(block.groupId, event.shiftKey);
			return;
		}
	}
	toggleSelect(id, event.shiftKey);
}

function handleCanvasClick() {
	if (panMoved) return;
	selectedIds = new Set();
}

function handleCanvasMouseDown(event: MouseEvent) {
	if (event.button !== 0) return;
	const target = event.target as HTMLElement | null;
	if (target?.closest('.cm-block') || target?.closest('.cm-group-label')) return;
	isPanning = true;
	panMoved = false;
	panStartX = event.clientX;
	panStartY = event.clientY;
	panOriginX = panX;
	panOriginY = panY;
}

function handleCanvasMouseMove(event: MouseEvent) {
	if (!isPanning) return;
	const dx = event.clientX - panStartX;
	const dy = event.clientY - panStartY;
	if (!panMoved && Math.abs(dx) + Math.abs(dy) > 3) panMoved = true;
	panX = panOriginX + dx;
	panY = panOriginY + dy;
}

function handleCanvasMouseUp() {
	isPanning = false;
	// Leave panMoved set until after the subsequent click fires so canvas
	// click doesn't clear selection at the end of a drag. Reset on next tick.
	setTimeout(() => (panMoved = false), 0);
}

function resetView() {
	zoom = 1;
	panX = containerWidth / 2 - worldCenterX;
	panY = containerHeight / 2 - worldCenterY;
}

function handleKeydown(event: KeyboardEvent) {
	if (status === 'idle') return;
	const target = event.target as HTMLElement | null;
	if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;

	if ((event.metaKey || event.ctrlKey) && event.key === 'z') {
		event.preventDefault();
		undo();
		return;
	}
	if (event.key === 'Delete' || event.key === 'Backspace') {
		if (selectedIds.size === 0) return;
		event.preventDefault();
		hideIds(selectedIds);
		return;
	}
	if ((event.key === '+' || event.key === '=') && selectedIds.size > 0) {
		event.preventDefault();
		scaleSelected(1.2);
		return;
	}
	if ((event.key === '-' || event.key === '_') && selectedIds.size > 0) {
		event.preventDefault();
		scaleSelected(1 / 1.2);
	}
}

function scaleSelected(factor: number) {
	if (!streamingLayout) return;
	for (const id of selectedIds) streamingLayout.scaleBlock(id, factor);
	wakeSim(1200);
}

function deleteGroup(groupId: string) {
	const members = rendered
		.filter((b) => b.groupId === groupId && !hiddenIds.has(b.id))
		.map((b) => b.id);
	if (members.length === 0) return;
	hideIds(members);
}

function applyDeletions() {
	if (!streamingLayout || hiddenIds.size === 0) return;
	for (const id of hiddenIds) streamingLayout.removeBlock(id);
	hiddenIds = new Set();
	selectedIds = new Set();
	undoStack = [];
	// Instant feedback: read positions now, but let sim resettle.
	rendered = streamingLayout.positions();
	wakeSim(1800);
}

async function copyAsPrompt() {
	if (!previewText) return;
	await navigator.clipboard.writeText(previewText);
	copyFeedback = 'Copied';
	await tick();
	setTimeout(() => (copyFeedback = ''), 1200);
}

function typeToClasses(type: string): string {
	switch (type) {
		case 'recommendation':
			return 'bg-primary/15 border-primary/50 text-foreground';
		case 'alternative':
			return 'bg-sky-100 border-sky-300 text-sky-900';
		case 'pro':
			return 'bg-emerald-50 border-emerald-300 text-emerald-900';
		case 'con':
			return 'bg-rose-50 border-rose-300 text-rose-900';
		case 'caveat':
			return 'bg-amber-50 border-l-4 border-l-amber-400 border-amber-200 text-amber-900';
		case 'code':
			return 'bg-slate-100 border-slate-300 text-slate-800 font-mono whitespace-pre-wrap';
		case 'context':
			return 'bg-transparent border-transparent text-muted-foreground';
		case 'question':
			return 'bg-yellow-50 border-yellow-300 text-yellow-900';
		default:
			return 'bg-card border-border text-foreground';
	}
}
</script>

<svelte:window onkeydown={handleKeydown} />

<main>
	<header class="head">
		<div class="head-row">
			<div class="head-text">
				<div class="eyebrow">
					<Sparkles class="size-3.5" />
					<span>Response Map</span>
				</div>
				<h1>Map a response.</h1>
				<p>Paste an LLM answer; we annotate it block-by-block, group related ideas, and lay them out as a force-directed map you can prune into a tighter prompt.</p>
			</div>
			<div class="head-controls">
				<StatusPill
					tone={statusTone}
					label={statusLabel}
					meta={statusMeta}
					title={status === 'error' ? errorMsg : 'Mapping status'}
				/>
				<InfoButton onclick={() => (showAbout = true)} label="About Response Map" />
			</div>
		</div>
	</header>

	<div class="grid">
		<Card.Root class="panel">
			<Card.Header>
				<Card.Title class="panel-title">
					<KeyRound class="size-4" />
					API key
				</Card.Title>
				<Card.Description>Sent directly to Anthropic; stored only in localStorage. Nothing is proxied.</Card.Description>
			</Card.Header>
			<Card.Content>
				<Input
					type="password"
					placeholder="sk-ant-…"
					bind:value={apiKey}
					onblur={saveKey}
					class="font-mono"
				/>
			</Card.Content>
		</Card.Root>

		<Card.Root class="panel">
			<Card.Header>
				<Card.Title class="panel-title">
					<MessageSquare class="size-4" />
					Response
				</Card.Title>
				<Card.Description>The LLM answer you want to map. Edit freely — clicking <span class="emph">Map response</span> re-annotates from scratch.</Card.Description>
			</Card.Header>
			<Card.Content class="space-y-3">
				<Textarea
					bind:value={responseText}
					spellcheck="false"
					class="font-mono text-sm leading-relaxed min-h-[160px]"
				/>
				<div class="run-row">
					<Button onclick={run} disabled={status === 'streaming' || !apiKey.trim()}>
						{#if status === 'streaming'}
							<Loader2 class="size-4 animate-spin" />
							Streaming
						{:else}
							<Zap class="size-4" />
							Map response
						{/if}
					</Button>
				</div>
			</Card.Content>
		</Card.Root>
	</div>

	{#if status === 'error'}
		<div class="error" role="alert">
			<AlertTriangle class="size-4" />
			<span>{errorMsg}</span>
		</div>
	{/if}

	<Card.Root class="result">
		<div class="toolbar">
			<div class="toolbar-meta">
				{#if status === 'idle'}
					<span>idle — paste a key and answer to begin</span>
				{:else}
					<span>{visibleCount} visible</span>
					{#if hiddenCount > 0}
						<span class="warn">• {hiddenCount} hidden</span>
					{/if}
				{/if}
			</div>
			<div class="toolbar-actions">
				<Button variant="ghost" size="sm" onclick={undo} disabled={undoStack.length === 0}>
					Undo
				</Button>
				<Button variant="ghost" size="sm" onclick={applyDeletions} disabled={hiddenCount === 0}>
					Apply deletions
				</Button>
				<span class="divider"></span>
				<Button variant="ghost" size="sm" onclick={() => (showPreview = !showPreview)} disabled={status === 'idle'}>
					{showPreview ? 'Hide' : 'Show'} prompt
				</Button>
				<Button variant="outline" size="sm" onclick={copyAsPrompt} disabled={status !== 'ready'}>
					{copyFeedback || 'Copy as prompt'}
				</Button>
			</div>
		</div>

		<div class="workspace" class:with-preview={showPreview && status !== 'idle'}>
			<div
				class="cm-canvas {isPanning ? 'cm-panning' : ''}"
				bind:this={container}
				onclick={handleCanvasClick}
				onmousedown={handleCanvasMouseDown}
				onmousemove={handleCanvasMouseMove}
				onmouseup={handleCanvasMouseUp}
				onmouseleave={handleCanvasMouseUp}
				onkeydown={() => {}}
				role="presentation"
			>
				{#if status === 'idle'}
					<div class="canvas-empty">
						<Sparkles class="size-5" />
						<div>
							<div class="canvas-empty-title">No map yet</div>
							<div class="canvas-empty-desc">Paste your API key and an answer above, then click <span class="emph">Map response</span>.</div>
						</div>
					</div>
				{/if}

				{#if status === 'ready' || status === 'streaming'}
					<div class="zoom-cluster">
						<span>{Math.round(zoom * 100)}%</span>
						<button type="button" class="cm-zoom-btn" onclick={() => (zoom = Math.max(0.2, zoom / 1.2))} aria-label="Zoom out">−</button>
						<button type="button" class="cm-zoom-btn" onclick={() => (zoom = Math.min(4, zoom * 1.2))} aria-label="Zoom in">+</button>
						<button type="button" class="cm-zoom-btn" onclick={resetView} aria-label="Reset view">⟲</button>
					</div>
				{/if}

					<div
						class="cm-viewport"
						style="transform: translate({panX}px, {panY}px) scale({zoom}); transform-origin: 0 0;"
					>
						{#if hoveredGroupId && groupBounds.has(hoveredGroupId)}
							{@const b = groupBounds.get(hoveredGroupId)}
							{@const meta = groupsById.get(hoveredGroupId)}
							{#if b && b.members.length > 1}
								<div
									class="cm-group-outline"
									style="transform: translate({b.x - 8}px, {b.y - 8}px); width: {b.width + 16}px; height: {b.height + 16}px;"
								></div>
								<div
									class="cm-group-label"
									style="transform: translate({b.x - 8}px, {b.y - 32}px);"
								>
									<span>{meta?.label ?? hoveredGroupId}</span>
									<button
										type="button"
										class="cm-group-delete"
										onclick={(e) => { e.stopPropagation(); deleteGroup(hoveredGroupId!); }}
										aria-label="Delete group"
									>×</button>
								</div>
							{/if}
						{/if}

						{#each rendered as block (block.id)}
							{@const isHidden = hiddenIds.has(block.id)}
							{@const isSelected = selectedIds.has(block.id)}
							{@const inHoveredGroup = hoveredGroupId && block.groupId === hoveredGroupId && !isHidden}
							{@const d = block.diameter ?? Math.max(block.width, block.height)}
							<button
								type="button"
								class="cm-block {typeToClasses(block.type)} {isHidden ? 'cm-hidden' : ''} {isSelected ? 'cm-selected' : ''} {inHoveredGroup ? 'cm-in-group' : ''}"
								style="
									transform: translate({block.x}px, {block.y}px);
									width: {d}px;
									height: {d}px;
									font-size: {block.fontSize}px;
									font-weight: {block.fontWeight};
									opacity: {isHidden ? 0.1 : block.opacity};
								"
								onmouseenter={() => (hoveredBlockId = block.id)}
								onmouseleave={() => { if (hoveredBlockId === block.id) hoveredBlockId = null; }}
								onclick={(e) => handleBlockClick(e, block.id)}
							><span class="cm-block-text" style="max-width: {block.width}px;">{block.text}</span></button>
						{/each}
					</div>
				</div>

				{#if showPreview && status !== 'idle'}
					<aside class="preview">
						<div class="preview-head">Serialized prompt</div>
						<pre class="preview-body">{previewText}</pre>
					</aside>
				{/if}
			</div>
		</Card.Root>
</main>

<Modal
	open={showAbout}
	title="How Response Map works"
	ariaLabel="About Response Map"
	width="wide"
	badge="Cartographer"
	onClose={() => (showAbout = false)}
>
	{#snippet icon()}
		<Info class="size-5" />
	{/snippet}
	{#snippet children()}
		<div class="about-body">
			<p class="lead">
				Response Map turns a free-form LLM answer into a force-directed map of
				its ideas. Hover to surface groups, click to select, delete to prune,
				then copy back as a tighter prompt.
			</p>

			<h3>Why it exists</h3>
			<p>
				LLM responses are linear text but the <em>structure</em> — what's a
				recommendation, what's a caveat, which pros belong to which option —
				is what matters when you want to compress, reuse, or feed an answer
				back into another prompt. Reading prose to find the load-bearing
				parts is slow; pruning them visually is faster.
			</p>

			<h3>The pipeline</h3>
			<ol class="pipeline">
				<li>
					<strong>Annotate (Anthropic streaming)</strong> —
					<code>cartographer/Session.streamAnnotate</code> parses the prose
					into typed <code>ContentBlock</code>s
					(<code>recommendation</code>, <code>pro</code>, <code>con</code>,
					<code>caveat</code>, <code>alternative</code>, <code>code</code>,
					<code>context</code>, <code>question</code>) as the model
					streams.
				</li>
				<li>
					<strong>Group</strong> — the model also emits
					<code>Group</code>s, clustering co-occurring blocks (e.g. all pros
					of one option) so they layout together.
				</li>
				<li>
					<strong>Layout</strong> — <code>StreamingLayout</code> runs a
					force-directed simulation with collision + grouping forces.
					Positions stream live as new blocks arrive; the sim only steps
					while energy is non-trivial.
				</li>
				<li>
					<strong>Prune &amp; serialize</strong> — hide blocks or whole
					groups, undo, apply, then <code>serializeToPrompt</code> reflows
					the survivors into a compact prompt you can copy and paste back
					into a new conversation.
				</li>
			</ol>

			<h3>What you're seeing</h3>
			<ul>
				<li>
					<strong>Block colors</strong> encode type — primary tint for
					recommendations, sky for alternatives, green/red for pros/cons,
					amber for caveats, etc. Block size encodes importance.
				</li>
				<li>
					<strong>Hover</strong> a block to highlight the group it belongs
					to (dashed outline + label).
				</li>
				<li>
					<strong>Click</strong> to select. <kbd>Shift</kbd>-click to
					multi-select. <kbd>Alt</kbd>-click to select the whole group.
				</li>
				<li>
					<strong>Delete</strong> / <kbd>Backspace</kbd> to hide; the
					"Apply deletions" button removes them permanently from the layout
					(everything else re-settles).
				</li>
				<li>
					<strong>+ / −</strong> on selected blocks scales them, biasing
					their layout weight.
				</li>
				<li>
					<strong>Pan</strong> by drag; <strong>zoom</strong> via wheel or
					the bottom-right cluster.
				</li>
				<li>
					<strong>Show prompt</strong> opens the side panel with the
					current serialized prompt; <strong>Copy as prompt</strong>
					puts that string on your clipboard.
				</li>
			</ul>

			<h3>Tradeoffs</h3>
			<ul>
				<li>
					Annotation latency depends on response length and the model;
					streaming hides most of it but a 2K-token answer still takes a
					few seconds to fully classify.
				</li>
				<li>
					The force sim is non-deterministic — re-mapping the same answer
					produces visually similar but not identical layouts.
				</li>
				<li>
					Group bounds are rendered as post-hoc bounding rectangles around
					member blocks, not real spatial clusters. Overlap is possible
					when groups co-locate.
				</li>
				<li>
					The serialized prompt is a flat ordering of survivors; it loses
					the spatial nuance of the map, which is intentional — the map is
					a thinking tool, the prompt is the artifact.
				</li>
			</ul>
		</div>
	{/snippet}
	{#snippet foot()}
		<Button onclick={() => (showAbout = false)}>Got it</Button>
	{/snippet}
</Modal>

<style>
	main {
		max-width: 1200px;
		margin: 2rem auto 4rem;
		padding: 0 1.5rem;
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
	}

	.head {
		padding-top: 0.5rem;
	}
	.head-row {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1.5rem;
	}
	.head-text {
		min-width: 0;
	}
	.eyebrow {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.2rem 0.55rem 0.2rem 0.45rem;
		font-size: 0.72rem;
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--color-primary);
		background: var(--color-accent);
		border: 1px solid var(--color-border);
		border-radius: 999px;
		margin-bottom: 0.7rem;
	}
	.head h1 {
		font-size: clamp(1.6rem, 3.2vw, 2.4rem);
		line-height: 1.1;
		letter-spacing: -0.02em;
		margin: 0 0 0.4rem;
	}
	.head p {
		color: var(--color-muted-foreground, #6b7280);
		margin: 0;
		max-width: 64ch;
		line-height: 1.5;
	}
	.head-controls {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		flex-shrink: 0;
	}

	.grid {
		display: grid;
		grid-template-columns: minmax(0, 0.85fr) minmax(0, 1.15fr);
		gap: 1rem;
	}
	@media (max-width: 720px) {
		.grid {
			grid-template-columns: 1fr;
		}
	}
	:global(.panel) {
		transition: box-shadow 160ms ease, border-color 160ms ease;
	}
	:global(.panel:hover) {
		box-shadow: 0 6px 24px -16px rgba(30, 58, 95, 0.18);
	}
	:global(.panel .panel-title) {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.95rem;
	}
	.emph {
		color: var(--color-foreground);
		font-weight: 500;
	}
	.run-row {
		display: flex;
		justify-content: flex-end;
	}

	.error {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.65rem 0.85rem;
		border-radius: 8px;
		background: color-mix(in srgb, var(--color-destructive) 10%, transparent);
		border: 1px solid color-mix(in srgb, var(--color-destructive) 35%, transparent);
		color: var(--color-destructive);
		font-size: 0.85rem;
	}

	:global(.result) {
		overflow: hidden;
	}
	.toolbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		padding: 0.6rem 1rem;
		border-bottom: 1px solid var(--color-border);
		font-size: 0.78rem;
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		color: var(--color-muted-foreground);
	}
	.toolbar-meta {
		display: inline-flex;
		gap: 0.5rem;
	}
	.toolbar-meta .warn {
		color: var(--color-destructive);
	}
	.toolbar-actions {
		display: inline-flex;
		gap: 0.25rem;
		align-items: center;
		flex-wrap: wrap;
	}
	.toolbar-actions .divider {
		width: 1px;
		height: 1.25rem;
		background: var(--color-border);
		margin: 0 0.35rem;
	}

	.workspace {
		display: grid;
		grid-template-columns: 1fr;
		height: 640px;
		min-height: 480px;
	}
	.workspace.with-preview {
		grid-template-columns: 1fr 320px;
	}

	.preview {
		border-left: 1px solid var(--color-border);
		background: color-mix(in srgb, var(--color-card) 60%, transparent);
		display: flex;
		flex-direction: column;
		min-height: 0;
	}
	.preview-head {
		padding: 0.5rem 0.85rem;
		border-bottom: 1px solid var(--color-border);
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--color-muted-foreground);
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
	}
	.preview-body {
		flex: 1;
		overflow: auto;
		padding: 0.85rem;
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		font-size: 0.72rem;
		line-height: 1.5;
		white-space: pre-wrap;
		word-break: break-word;
		margin: 0;
	}

	.cm-canvas {
		position: relative;
		cursor: grab;
		touch-action: none;
		background: color-mix(in srgb, var(--color-muted) 35%, transparent);
		overflow: hidden;
		min-height: 0;
	}

	.cm-canvas.cm-panning {
		cursor: grabbing;
	}

	.canvas-empty {
		position: absolute;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		display: flex;
		align-items: center;
		gap: 0.85rem;
		color: var(--color-muted-foreground);
		text-align: left;
		pointer-events: none;
	}
	.canvas-empty-title {
		color: var(--color-foreground);
		font-weight: 500;
		font-size: 0.92rem;
	}
	.canvas-empty-desc {
		font-size: 0.82rem;
		margin-top: 0.1rem;
		max-width: 36ch;
	}

	.cm-viewport {
		position: absolute;
		top: 0;
		left: 0;
		width: 0;
		height: 0;
		will-change: transform;
	}

	.zoom-cluster {
		position: absolute;
		bottom: 0.75rem;
		right: 0.75rem;
		display: flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.25rem 0.5rem;
		border: 1px solid var(--color-border);
		border-radius: 6px;
		background: color-mix(in srgb, var(--color-card) 90%, transparent);
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		font-size: 0.7rem;
		color: var(--color-muted-foreground);
		z-index: 10;
		pointer-events: auto;
	}

	.cm-zoom-btn {
		width: 1.3rem;
		height: 1.3rem;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border-radius: 4px;
		font-size: 0.9rem;
		line-height: 1;
		color: var(--color-muted-foreground);
		background: transparent;
		border: none;
		cursor: pointer;
		padding: 0;
	}

	.cm-zoom-btn:hover {
		background: color-mix(in srgb, var(--color-foreground) 8%, transparent);
		color: var(--color-foreground);
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
	.about-body kbd {
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		font-size: 0.78em;
		background: var(--color-muted, rgba(0, 0, 0, 0.05));
		padding: 0.05rem 0.35rem;
		border-radius: 4px;
		border: 1px solid var(--color-border);
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

	.cm-block {
		position: absolute;
		top: 0;
		left: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		text-align: center;
		font-family: 'Recursive', system-ui;
		line-height: 1.3;
		padding: 0;
		box-sizing: border-box;
		border-radius: 9999px;
		border-width: 1px;
		border-style: solid;
		-webkit-font-smoothing: antialiased;
		word-wrap: break-word;
		overflow-wrap: break-word;
		cursor: pointer;
		transition: box-shadow 0.15s ease, opacity 0.2s ease, width 0.2s ease, height 0.2s ease;
	}

	.cm-block-text {
		display: block;
		padding: 0;
		word-wrap: break-word;
		overflow-wrap: break-word;
	}

	.cm-block:hover {
		box-shadow: 0 4px 14px -6px rgba(30, 58, 95, 0.25);
	}

	.cm-selected {
		box-shadow: 0 0 0 2px var(--color-primary), 0 4px 14px -6px rgba(30, 58, 95, 0.25);
	}

	.cm-in-group:not(.cm-hidden) {
		box-shadow: 0 0 0 1px color-mix(in srgb, var(--color-primary) 60%, transparent);
	}

	.cm-hidden {
		border-style: dashed !important;
		pointer-events: none;
	}

	.cm-group-outline {
		position: absolute;
		top: 0;
		left: 0;
		border: 1.5px dashed color-mix(in srgb, var(--color-primary) 70%, transparent);
		border-radius: 12px;
		background: color-mix(in srgb, var(--color-primary) 5%, transparent);
		pointer-events: none;
	}

	.cm-group-label {
		position: absolute;
		top: 0;
		left: 0;
		display: flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.15rem 0.5rem 0.15rem 0.65rem;
		background: var(--color-primary);
		color: var(--color-primary-foreground);
		font-family: monospace;
		font-size: 0.7rem;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		border-radius: 4px;
		pointer-events: auto;
		z-index: 5;
	}

	.cm-group-delete {
		background: rgba(255, 255, 255, 0.2);
		border: none;
		color: inherit;
		font-size: 0.9rem;
		line-height: 1;
		width: 1.1rem;
		height: 1.1rem;
		border-radius: 50%;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		padding: 0;
	}

	.cm-group-delete:hover {
		background: rgba(255, 255, 255, 0.4);
	}
</style>
