<script lang="ts">
	import { Session } from '@vfir/cartographer';
	import type { LayoutMode, LayoutResult, PositionedBlock } from '@vfir/cartographer';
	import { Interpolator, easeOutCubic } from '@vfir/core';
	import { onDestroy, onMount } from 'svelte';

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

	type Status = 'idle' | 'annotating' | 'laying-out' | 'error' | 'ready';

	let apiKey = $state('');
	let responseText = $state(SAMPLE);
	let mode = $state<LayoutMode | 'auto'>('auto');
	let status = $state<Status>('idle');
	let errorMsg = $state('');
	let container: HTMLElement;
	let containerWidth = $state(800);
	let containerHeight = $state(600);

	// Interpolator-animated positions — one per block
	let interps = new Map<string, Interpolator>();
	let unsubs: Array<() => void> = [];
	let rendered = $state<PositionedBlock[]>([]);

	// Session held across runs so annotation is cached on resize
	let session: Session | null = null;

	onMount(() => {
		apiKey = localStorage.getItem(LS_KEY) ?? '';
		const ro = new ResizeObserver((entries) => {
			const box = entries[0].contentRect;
			containerWidth = Math.max(400, box.width);
			containerHeight = Math.max(500, box.height);
			if (status === 'ready' && session) relayout();
		});
		ro.observe(container);
		return () => ro.disconnect();
	});

	onDestroy(() => {
		for (const u of unsubs) u();
		for (const i of interps.values()) i.destroy();
	});

	function saveKey() {
		if (apiKey) localStorage.setItem(LS_KEY, apiKey);
	}

	async function run() {
		if (!apiKey.trim()) {
			errorMsg = 'Paste your Anthropic API key first.';
			status = 'error';
			return;
		}
		errorMsg = '';
		status = 'annotating';

		// Fresh session (annotation is cached inside Session on same text input)
		session = new Session({
			annotator: { apiKey: apiKey.trim() },
			fontFamily: 'Recursive',
			maxBlockWidth: Math.min(480, containerWidth * 0.55),
		});

		try {
			status = 'laying-out';
			const result = await session.map(responseText, {
				width: containerWidth,
				height: containerHeight,
				mode: mode === 'auto' ? undefined : mode,
			});
			applyLayout(result);
			status = 'ready';
		} catch (e) {
			errorMsg = e instanceof Error ? e.message : String(e);
			status = 'error';
		}
	}

	async function relayout() {
		if (!session) return;
		try {
			const result = await session.map(responseText, {
				width: containerWidth,
				height: containerHeight,
				mode: mode === 'auto' ? undefined : mode,
			});
			applyLayout(result);
		} catch {
			// silent on resize failures
		}
	}

	function applyLayout(result: LayoutResult) {
		const byId = new Map(result.positions.map((p) => [p.id, p]));

		// Kill stale interpolators for blocks no longer in layout
		for (const [id, interp] of interps) {
			if (!byId.has(id)) {
				interp.destroy();
				interps.delete(id);
			}
		}

		// Create or update one Interpolator per block
		for (const pos of result.positions) {
			let interp = interps.get(pos.id);
			if (!interp) {
				interp = new Interpolator({
					axes: {
						x: { tag: 'x', min: -9999, max: 9999, default: pos.x },
						y: { tag: 'y', min: -9999, max: 9999, default: pos.y },
						opacity: { tag: 'opacity', min: 0, max: 1, default: 0 },
					},
					stiffness: 0.12,
					easing: easeOutCubic,
					epsilon: 0.3,
				});
				interps.set(pos.id, interp);
				const unsub = interp.subscribe(() => {
					// Rebuild rendered array from all current interpolators
					rendered = result.positions.map((p) => {
						const ip = interps.get(p.id);
						if (!ip) return p;
						const s = ip.getSnapshot();
						return { ...p, x: s.x, y: s.y, opacity: s.opacity };
					});
				});
				unsubs.push(unsub);
			}
			interp.setAll({ x: pos.x, y: pos.y, opacity: pos.opacity });
		}
	}
</script>

<div class="cm-wrap">
	<div class="cm-toolbar">
		<input
			class="cm-key"
			type="password"
			placeholder="sk-ant-… (stored in localStorage)"
			bind:value={apiKey}
			onblur={saveKey}
		/>
		<select class="cm-mode" bind:value={mode}>
			<option value="auto">auto mode</option>
			<option value="decision">decision</option>
			<option value="exploration">exploration</option>
		</select>
		<button
			class="cm-run"
			onclick={run}
			disabled={status === 'annotating' || status === 'laying-out'}
		>
			{status === 'annotating'
				? 'annotating…'
				: status === 'laying-out'
					? 'laying out…'
					: 'Map response'}
		</button>
	</div>

	<div class="cm-split">
		<textarea class="cm-input" bind:value={responseText} spellcheck="false"></textarea>

		<div class="cm-canvas" bind:this={container}>
			{#if status === 'idle'}
				<div class="cm-hint">Paste an LLM response on the left, then click "Map response".</div>
			{/if}

			{#if status === 'error'}
				<div class="cm-err">{errorMsg}</div>
			{/if}

			{#each rendered as block (block.id)}
				<div
					class="cm-block type-{block.type}"
					style="
						transform: translate({block.x}px, {block.y}px);
						width: {block.width}px;
						font-size: {block.fontSize}px;
						font-weight: {block.fontWeight};
						opacity: {block.opacity};
					"
				>{block.text}</div>
			{/each}
		</div>
	</div>
</div>

<style>
	.cm-wrap {
		display: flex;
		flex-direction: column;
		height: calc(100vh - 57px);
		overflow: hidden;
	}

	.cm-toolbar {
		display: flex;
		gap: 0.5rem;
		padding: 0.75rem 1.5rem;
		border-bottom: 1px solid #1e1e1e;
		flex-shrink: 0;
	}

	.cm-key {
		flex: 1;
		background: #111;
		border: 1px solid #2a2a2a;
		color: #ccc;
		font-family: monospace;
		font-size: 0.8rem;
		padding: 0.4rem 0.6rem;
		border-radius: 4px;
		outline: none;
	}

	.cm-key:focus {
		border-color: #7c6af7;
	}

	.cm-mode {
		background: #1a1a1a;
		border: 1px solid #2a2a2a;
		color: #ccc;
		font-family: monospace;
		font-size: 0.8rem;
		padding: 0.4rem 0.6rem;
		border-radius: 4px;
	}

	.cm-run {
		background: #7c6af7;
		border: none;
		color: #fff;
		font-family: system-ui;
		font-size: 0.85rem;
		font-weight: 600;
		padding: 0.4rem 1.1rem;
		border-radius: 4px;
		cursor: pointer;
		white-space: nowrap;
	}

	.cm-run:disabled {
		opacity: 0.5;
		cursor: wait;
	}

	.cm-run:not(:disabled):hover {
		background: #9182f9;
	}

	.cm-split {
		display: grid;
		grid-template-columns: 360px 1fr;
		flex: 1;
		min-height: 0;
		overflow: hidden;
	}

	.cm-input {
		background: #111;
		border: none;
		border-right: 1px solid #1e1e1e;
		color: #e0e0e0;
		font-family: 'Berkeley Mono', 'JetBrains Mono', monospace;
		font-size: 0.8rem;
		line-height: 1.65;
		padding: 1rem 1.25rem;
		resize: none;
		outline: none;
	}

	.cm-canvas {
		position: relative;
		background: #0b0b0b;
		overflow: auto;
	}

	.cm-hint {
		position: absolute;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		color: #333;
		font-family: monospace;
		font-size: 0.8rem;
		text-align: center;
		pointer-events: none;
	}

	.cm-err {
		position: absolute;
		top: 1rem;
		left: 1rem;
		right: 1rem;
		color: #f74a4a;
		font-family: monospace;
		font-size: 0.8rem;
		white-space: pre-wrap;
		background: rgba(247, 74, 74, 0.08);
		border: 1px solid rgba(247, 74, 74, 0.3);
		border-radius: 4px;
		padding: 0.75rem 1rem;
	}

	.cm-block {
		position: absolute;
		top: 0;
		left: 0;
		font-family: 'Recursive', system-ui;
		color: #f0f0f0;
		line-height: 1.4;
		will-change: transform, opacity;
		padding: 0.6rem 0.9rem;
		box-sizing: border-box;
		border-radius: 6px;
		background: rgba(26, 26, 26, 0.85);
		border: 1px solid transparent;
		-webkit-font-smoothing: antialiased;
		word-wrap: break-word;
		overflow-wrap: break-word;
	}

	.cm-block.type-recommendation {
		background: rgba(124, 106, 247, 0.18);
		border-color: rgba(124, 106, 247, 0.45);
	}

	.cm-block.type-alternative {
		background: rgba(106, 200, 247, 0.13);
		border-color: rgba(106, 200, 247, 0.3);
	}

	.cm-block.type-pro {
		background: rgba(74, 247, 122, 0.11);
		border-color: rgba(74, 247, 122, 0.25);
	}

	.cm-block.type-con {
		background: rgba(247, 106, 106, 0.11);
		border-color: rgba(247, 106, 106, 0.25);
	}

	.cm-block.type-caveat {
		background: rgba(247, 166, 54, 0.11);
		border-left: 2px solid rgba(247, 166, 54, 0.55);
	}

	.cm-block.type-code {
		background: #0d0d0d;
		border-color: #2a2a2a;
		font-family: 'Berkeley Mono', 'JetBrains Mono', monospace;
		white-space: pre-wrap;
	}

	.cm-block.type-context {
		background: transparent;
		border-color: transparent;
		color: #777;
	}

	.cm-block.type-question {
		background: rgba(247, 220, 106, 0.1);
		border-color: rgba(247, 220, 106, 0.3);
	}
</style>
