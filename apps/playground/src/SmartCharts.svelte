<script lang="ts">
	import {
		SmartChart,
		createChart,
		compactProfileForPrompt,
		getWasmStatsDiagnostics,
		type EnhancementSpec,
		type LLMConfig,
		type StatisticalProfile,
		type SmartChartSession,
		type WasmDiagnostics,
	} from '@vfir/smart-charts';
	import { DATASETS } from './smart-charts-data';
	import * as Card from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';

	const STORAGE_KEY = 'smart-charts-config';

	type Provider = 'mock' | 'openai' | 'anthropic';

	let datasetId = $state<string>(DATASETS[0].id);
	let question = $state<string>('');
	let provider = $state<Provider>('mock');
	let model = $state<string>('claude-haiku-4-5');
	let apiKey = $state<string>('');

	let busy = $state<boolean>(false);
	let error = $state<string | null>(null);
	let profile = $state<StatisticalProfile | null>(null);
	let spec = $state<EnhancementSpec | null>(null);
	let showProfile = $state<boolean>(false);

	if (typeof localStorage !== 'undefined') {
		try {
			const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as {
				provider?: Provider;
				model?: string;
				apiKey?: string;
			};
			if (stored.provider) provider = stored.provider;
			if (stored.model) model = stored.model;
			if (stored.apiKey) apiKey = stored.apiKey;
		} catch {
			// ignore
		}
	}

	$effect(() => {
		if (typeof localStorage === 'undefined') return;
		localStorage.setItem(STORAGE_KEY, JSON.stringify({ provider, model, apiKey }));
	});

	let session = $state<SmartChartSession | null>(null);
	let datasetMeta = $derived(DATASETS.find((d) => d.id === datasetId) ?? DATASETS[0]);

	let wasmDiag = $state<WasmDiagnostics>(getWasmStatsDiagnostics());
	let showWasmDebug = $state<boolean>(false);
	let wasmEnv = {
		hasWebAssembly: typeof WebAssembly !== 'undefined',
		userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'n/a',
		crossOriginIsolated:
			typeof globalThis !== 'undefined' && 'crossOriginIsolated' in globalThis
				? (globalThis as { crossOriginIsolated?: boolean }).crossOriginIsolated ?? false
				: false,
	};

	function refreshWasmDiag() {
		wasmDiag = getWasmStatsDiagnostics();
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

	function formatBytes(n: number | null): string {
		if (n == null) return '—';
		if (n < 1024) return `${n} B`;
		if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`;
		return `${(n / 1024 / 1024).toFixed(2)} MiB`;
	}

	$effect(() => {
		const meta = datasetMeta;
		session = createChart({
			data: meta.rows,
			wasm: () => import('@vfir/wasm-stats'),
		});
		profile = null;
		spec = null;
	});

	async function run(q: string) {
		if (!session) return;
		error = null;
		busy = true;
		question = q;
		refreshWasmDiag();
		try {
			const llm: LLMConfig | undefined = provider === 'mock'
				? { provider: 'mock', model: 'mock' }
				: { provider, model, apiKey };
			profile = await session.analyze();
			refreshWasmDiag();
			spec = await session.enhance({ question: q, llm });
		} catch (err) {
			error = err instanceof Error ? err.message : String(err);
		} finally {
			busy = false;
			refreshWasmDiag();
		}
	}
</script>

<main>
	<header class="head">
		<div class="head-row">
			<div>
				<h1>Smart Charts</h1>
				<p>Pick a dataset, ask a question. Statistics run in WASM, the LLM only sees the profile.</p>
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
		</div>
	</header>

	<div class="grid">
		<Card.Root>
			<Card.Header>
				<Card.Title>Dataset</Card.Title>
			</Card.Header>
			<Card.Content class="space-y-3">
				<div class="picker">
					{#each DATASETS as ds (ds.id)}
						<button class="ds" class:selected={ds.id === datasetId} onclick={() => (datasetId = ds.id)}>
							<div class="ds-label">{ds.label}</div>
							<div class="ds-desc">{ds.description}</div>
						</button>
					{/each}
				</div>
			</Card.Content>
		</Card.Root>

		<Card.Root>
			<Card.Header>
				<Card.Title>Ask</Card.Title>
			</Card.Header>
			<Card.Content class="space-y-3">
				<div class="ask">
					<Input
						placeholder="What drove growth?"
						bind:value={question}
						onkeydown={(e: KeyboardEvent) => {
							if (e.key === 'Enter' && question.trim().length > 0) run(question);
						}}
					/>
					<Button onclick={() => run(question)} disabled={busy || question.trim().length === 0}>
						{busy ? 'Thinking…' : 'Run'}
					</Button>
				</div>
				<div class="suggestions">
					{#each datasetMeta.suggestedQuestions as q (q)}
						<button class="chip" onclick={() => run(q)} disabled={busy}>{q}</button>
					{/each}
				</div>

				<div class="llm-row">
					<div class="llm-col">
						<Label>Provider</Label>
						<select bind:value={provider}>
							<option value="mock">Heuristic (no API)</option>
							<option value="openai">OpenAI</option>
							<option value="anthropic">Anthropic</option>
						</select>
					</div>
					<div class="llm-col">
						<Label>Model</Label>
						<Input bind:value={model} placeholder="claude-haiku-4-5" />
					</div>
					<div class="llm-col">
						<Label>API key</Label>
						<Input type="password" bind:value={apiKey} placeholder="sk-… (only sent to the model endpoint)" />
					</div>
				</div>
			</Card.Content>
		</Card.Root>
	</div>

	{#if error}
		<div class="error">⚠️ {error}</div>
	{/if}

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
					<h2>WASM debug</h2>
					<button class="close" onclick={() => (showWasmDebug = false)} aria-label="Close">×</button>
				</div>
				<dl class="diag">
					<dt>Backend</dt>
					<dd>
						<code>{wasmDiag.backend}</code>
						{#if wasmDiag.backend === 'wasm'}
							<span class="hint">— compiled Rust → WebAssembly</span>
						{:else if wasmDiag.backend === 'js-stub'}
							<span class="hint">— pure-JS fallback (run <code>pnpm build:wasm-stats</code> for real WASM)</span>
						{:else if !wasmDiag.loaded}
							<span class="hint">— not loaded yet (click Run)</span>
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
					<Button onclick={refreshWasmDiag}>Refresh</Button>
					<Button onclick={() => (showWasmDebug = false)}>Close</Button>
				</div>
			</div>
		</div>
	{/if}

	{#if spec && profile && session}
		<Card.Root class="result">
			<Card.Content class="space-y-3 pt-4">
				<SmartChart {spec} {profile} adapted={session.data} height={360} />
				{#if spec.caption}
					<p class="caption">{spec.caption}</p>
				{/if}
				{#if spec.followUpQuestions.length > 0}
					<div class="followups">
						{#each spec.followUpQuestions as fq (fq)}
							<button class="chip" onclick={() => run(fq)} disabled={busy}>{fq}</button>
						{/each}
					</div>
				{/if}

				<button class="profile-toggle" onclick={() => (showProfile = !showProfile)}>
					{showProfile ? '▾' : '▸'} Statistical profile sent to model ({JSON.stringify(profile).length} chars)
				</button>
				{#if showProfile}
					<pre class="profile">{compactProfileForPrompt(profile)}</pre>
				{/if}
			</Card.Content>
		</Card.Root>
	{/if}
</main>

<style>
	main {
		max-width: 980px;
		margin: 2rem auto;
		padding: 0 1.5rem;
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
	}
	.head h1 {
		font-size: clamp(1.5rem, 3vw, 2.25rem);
		margin: 0 0 0.25rem;
	}
	.head p {
		color: var(--color-muted-foreground, #6b7280);
		margin: 0;
	}
	.head-row {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
	}
	.wasm-status {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.3rem 0.6rem;
		border-radius: 999px;
		border: 1px solid var(--color-border, #e5e7eb);
		background: rgba(0, 0, 0, 0.02);
		font-size: 0.75rem;
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		cursor: pointer;
		flex-shrink: 0;
		white-space: nowrap;
	}
	.wasm-status:hover {
		background: rgba(0, 0, 0, 0.06);
	}
	.wasm-status .dot {
		width: 0.5rem;
		height: 0.5rem;
		border-radius: 50%;
		background: #9ca3af;
	}
	.wasm-status[data-tone='ok'] .dot { background: #22c55e; }
	.wasm-status[data-tone='ok'] { border-color: rgba(34, 197, 94, 0.4); }
	.wasm-status[data-tone='warn'] .dot { background: #f59e0b; }
	.wasm-status[data-tone='warn'] { border-color: rgba(245, 158, 11, 0.4); }
	.wasm-status[data-tone='err'] .dot { background: #dc2626; }
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
		background: rgba(0, 0, 0, 0.45);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1rem;
		z-index: 50;
	}
	.modal {
		background: var(--color-background, #ffffff);
		color: var(--color-foreground, #111827);
		border-radius: 8px;
		max-width: 640px;
		width: 100%;
		max-height: 80vh;
		overflow: auto;
		box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3);
		border: 1px solid var(--color-border, #e5e7eb);
	}
	.modal-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.9rem 1rem;
		border-bottom: 1px solid var(--color-border, #e5e7eb);
	}
	.modal-head h2 {
		margin: 0;
		font-size: 1rem;
	}
	.close {
		background: transparent;
		border: none;
		font-size: 1.4rem;
		line-height: 1;
		cursor: pointer;
		color: var(--color-muted-foreground, #6b7280);
	}
	.diag {
		display: grid;
		grid-template-columns: 9rem 1fr;
		gap: 0.4rem 1rem;
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
	.diag .hint {
		color: var(--color-muted-foreground, #6b7280);
		margin-left: 0.4rem;
	}
	.diag code {
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		background: rgba(0, 0, 0, 0.05);
		padding: 0.05rem 0.3rem;
		border-radius: 3px;
	}
	.exports {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem;
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
	.grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 1rem;
	}
	@media (max-width: 720px) {
		.grid {
			grid-template-columns: 1fr;
		}
	}
	.picker {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.ds {
		text-align: left;
		padding: 0.6rem 0.8rem;
		border: 1px solid var(--color-border, #e5e7eb);
		border-radius: 6px;
		background: transparent;
		cursor: pointer;
	}
	.ds.selected {
		border-color: var(--color-primary, #3b82f6);
		background: rgba(59, 130, 246, 0.06);
	}
	.ds-label {
		font-weight: 600;
	}
	.ds-desc {
		font-size: 0.8rem;
		color: var(--color-muted-foreground, #6b7280);
		margin-top: 0.15rem;
	}
	.ask {
		display: flex;
		gap: 0.5rem;
	}
	.suggestions {
		display: flex;
		gap: 0.4rem;
		flex-wrap: wrap;
	}
	.chip {
		padding: 0.25rem 0.6rem;
		border-radius: 999px;
		border: 1px solid var(--color-border, #e5e7eb);
		background: transparent;
		font-size: 0.78rem;
		cursor: pointer;
	}
	.chip:hover:not(:disabled) {
		background: rgba(0, 0, 0, 0.04);
	}
	.chip:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.llm-row {
		display: grid;
		grid-template-columns: 1fr 1fr 2fr;
		gap: 0.5rem;
	}
	@media (max-width: 720px) {
		.llm-row {
			grid-template-columns: 1fr;
		}
	}
	.llm-col {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	.llm-col select {
		padding: 0.5rem;
		border: 1px solid var(--color-border, #e5e7eb);
		border-radius: 6px;
		background: transparent;
	}
	.error {
		color: #dc2626;
		font-size: 0.9rem;
	}
	.caption {
		font-size: 0.95rem;
		color: var(--color-foreground, inherit);
		margin: 0;
	}
	.followups {
		display: flex;
		gap: 0.4rem;
		flex-wrap: wrap;
	}
	.profile-toggle {
		font-size: 0.75rem;
		color: var(--color-muted-foreground, #6b7280);
		text-align: left;
		background: transparent;
		border: none;
		cursor: pointer;
		padding: 0;
	}
	.profile {
		font-size: 0.7rem;
		max-height: 240px;
		overflow: auto;
		background: rgba(0, 0, 0, 0.04);
		padding: 0.6rem;
		border-radius: 6px;
		white-space: pre-wrap;
		word-break: break-word;
	}
</style>
