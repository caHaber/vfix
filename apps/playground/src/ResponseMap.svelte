<script lang="ts">
	import { Session, StreamingLayout, serializeToPrompt } from '@vfir/cartographer';
	import type { ContentBlock, Group, PositionedBlock, ResponseStructure } from '@vfir/cartographer';
	import { onDestroy, onMount, tick } from 'svelte';
	import { Input } from '$lib/components/ui/input';
	import { Button } from '$lib/components/ui/button';
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
		const out = new Map<string, { x: number; y: number; width: number; height: number; members: PositionedBlock[] }>();
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
		const members = rendered.filter((b) => b.groupId === groupId && !hiddenIds.has(b.id)).map((b) => b.id);
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
		const members = rendered.filter((b) => b.groupId === groupId && !hiddenIds.has(b.id)).map((b) => b.id);
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

<div class="flex flex-col h-[calc(100vh-57px)] overflow-hidden">
	<div class="flex gap-2 items-center px-6 py-3 border-b border-border flex-shrink-0">
		<Input
			type="password"
			placeholder="sk-ant-… (stored in localStorage)"
			bind:value={apiKey}
			onblur={saveKey}
			class="flex-1 font-mono text-sm"
		/>
		<Button onclick={run} disabled={status === 'streaming'}>
			{status === 'streaming' ? 'streaming…' : 'Map response'}
		</Button>
	</div>

	{#if status === 'ready' || status === 'streaming'}
		<div class="flex gap-2 items-center px-6 py-2 border-b border-border flex-shrink-0 text-xs font-mono text-muted-foreground">
			<span>{visibleCount} visible</span>
			{#if hiddenCount > 0}
				<span class="text-destructive">• {hiddenCount} hidden</span>
			{/if}
			{#if status === 'streaming'}
				<span class="text-primary">• streaming…</span>
			{/if}
			<span class="ml-auto flex gap-2 items-center">
				<Button variant="ghost" size="sm" onclick={undo} disabled={undoStack.length === 0}>
					Undo
				</Button>
				<Button variant="ghost" size="sm" onclick={applyDeletions} disabled={hiddenCount === 0}>
					Apply deletions
				</Button>
				<span class="w-px h-5 bg-border mx-1"></span>
				<Button variant="ghost" size="sm" onclick={() => (showPreview = !showPreview)}>
					{showPreview ? 'Hide' : 'Show'} prompt
				</Button>
				<Button variant="outline" size="sm" onclick={copyAsPrompt} disabled={status === 'streaming'}>
					{copyFeedback || 'Copy as prompt'}
				</Button>
			</span>
		</div>
	{/if}

	<div class="grid grid-cols-[360px_1fr] flex-1 min-h-0 overflow-hidden">
		<Textarea
			bind:value={responseText}
			spellcheck="false"
			class="rounded-none border-0 border-r border-border font-mono text-sm leading-relaxed p-5 resize-none"
		/>

		<div class="grid {showPreview ? 'grid-cols-[1fr_360px]' : 'grid-cols-1'} min-h-0">
			<div
				class="relative bg-muted/30 overflow-hidden cm-canvas {isPanning ? 'cm-panning' : ''}"
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
					<div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-muted-foreground/60 font-mono text-sm text-center pointer-events-none">
						Paste an LLM response on the left, then click "Map response".
					</div>
				{/if}

				{#if status === 'error'}
					<div class="absolute top-4 left-4 right-4 text-destructive font-mono text-sm whitespace-pre-wrap bg-destructive/10 border border-destructive/30 rounded p-3 z-10">
						{errorMsg}
					</div>
				{/if}

				{#if status === 'ready' || status === 'streaming'}
					<div class="absolute bottom-3 right-3 flex items-center gap-1 bg-card/90 border border-border rounded-md px-2 py-1 font-mono text-xs text-muted-foreground z-10 pointer-events-auto">
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

			{#if showPreview}
				<div class="border-l border-border bg-card/50 flex flex-col min-h-0">
					<div class="px-4 py-2 text-xs uppercase tracking-wider font-mono text-muted-foreground border-b border-border">
						Serialized prompt
					</div>
					<pre class="flex-1 overflow-auto p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap">{previewText}</pre>
				</div>
			{/if}
		</div>
	</div>
</div>

<style>
	.cm-canvas {
		cursor: grab;
		touch-action: none;
	}

	.cm-canvas.cm-panning {
		cursor: grabbing;
	}

	.cm-viewport {
		position: absolute;
		top: 0;
		left: 0;
		width: 0;
		height: 0;
		will-change: transform;
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
