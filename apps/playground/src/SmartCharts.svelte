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
	import * as Select from '$lib/components/ui/select';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Badge } from '$lib/components/ui/badge';
	import { Separator } from '$lib/components/ui/separator';
	import Database from '@lucide/svelte/icons/database';
	import MessageSquare from '@lucide/svelte/icons/message-square';
	import Sparkles from '@lucide/svelte/icons/sparkles';
	import Zap from '@lucide/svelte/icons/zap';
	import Check from '@lucide/svelte/icons/check';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import AlertTriangle from '@lucide/svelte/icons/alert-triangle';
	import X from '@lucide/svelte/icons/x';
	import Loader2 from '@lucide/svelte/icons/loader-2';

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

	let providerLabel = $derived.by(() => {
		if (provider === 'mock') return 'Heuristic (no API)';
		if (provider === 'openai') return 'OpenAI';
		return 'Anthropic';
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
			<div class="head-text">
				<div class="eyebrow">
					<Sparkles class="size-3.5" />
					<span>Smart Charts</span>
				</div>
				<h1>Ask data a question.</h1>
				<p>Statistics run locally in WASM. The model only sees an aggregated profile — never your raw rows.</p>
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
		<Card.Root class="panel">
			<Card.Header>
				<Card.Title class="panel-title">
					<Database class="size-4" />
					Dataset
				</Card.Title>
				<Card.Description>Pick a sample to analyze.</Card.Description>
			</Card.Header>
			<Card.Content class="space-y-2">
				<div class="picker">
					{#each DATASETS as ds (ds.id)}
						{@const selected = ds.id === datasetId}
						<button
							type="button"
							class="ds"
							class:selected
							onclick={() => (datasetId = ds.id)}
							aria-pressed={selected}
						>
							<div class="ds-row">
								<div class="ds-text">
									<div class="ds-label">{ds.label}</div>
									<div class="ds-desc">{ds.description}</div>
								</div>
								<div class="ds-check" aria-hidden="true">
									{#if selected}
										<Check class="size-4" />
									{/if}
								</div>
							</div>
						</button>
					{/each}
				</div>
			</Card.Content>
		</Card.Root>

		<Card.Root class="panel">
			<Card.Header>
				<Card.Title class="panel-title">
					<MessageSquare class="size-4" />
					Ask
				</Card.Title>
				<Card.Description>What do you want to know about <span class="emph">{datasetMeta.label}</span>?</Card.Description>
			</Card.Header>
			<Card.Content class="space-y-4">
				<div class="ask">
					<Input
						placeholder="What drove growth?"
						bind:value={question}
						onkeydown={(e: KeyboardEvent) => {
							if (e.key === 'Enter' && question.trim().length > 0) run(question);
						}}
					/>
					<Button onclick={() => run(question)} disabled={busy || question.trim().length === 0}>
						{#if busy}
							<Loader2 class="size-4 animate-spin" />
							Thinking
						{:else}
							<Zap class="size-4" />
							Run
						{/if}
					</Button>
				</div>

				{#if datasetMeta.suggestedQuestions.length > 0}
					<div class="suggestions">
						<span class="hint-label">Try:</span>
						{#each datasetMeta.suggestedQuestions as q (q)}
							<button class="chip" onclick={() => run(q)} disabled={busy}>{q}</button>
						{/each}
					</div>
				{/if}

				<Separator />

				<div class="llm-row">
					<div class="llm-col">
						<Label>Provider</Label>
						<Select.Root
							type="single"
							value={provider}
							onValueChange={(v) => (provider = v as Provider)}
						>
							<Select.Trigger class="w-full">
								{providerLabel}
							</Select.Trigger>
							<Select.Content>
								<Select.Item value="mock">Heuristic (no API)</Select.Item>
								<Select.Item value="openai">OpenAI</Select.Item>
								<Select.Item value="anthropic">Anthropic</Select.Item>
							</Select.Content>
						</Select.Root>
					</div>
					<div class="llm-col">
						<Label for="sc-model">Model</Label>
						<Input id="sc-model" bind:value={model} placeholder="claude-haiku-4-5" disabled={provider === 'mock'} />
					</div>
					<div class="llm-col">
						<Label for="sc-apikey">API key</Label>
						<Input id="sc-apikey" type="password" bind:value={apiKey} placeholder="sk-…" disabled={provider === 'mock'} />
					</div>
				</div>
				{#if provider !== 'mock'}
					<p class="api-note">Key is sent directly to {providerLabel}; nothing is proxied through this app.</p>
				{/if}
			</Card.Content>
		</Card.Root>
	</div>

	{#if error}
		<div class="error" role="alert">
			<AlertTriangle class="size-4" />
			<span>{error}</span>
		</div>
	{/if}

	{#if spec && profile && session}
		<Card.Root class="result">
			<Card.Content class="result-content">
				<SmartChart {spec} {profile} adapted={session.data} height={360} />
				{#if spec.caption}
					<p class="caption">{spec.caption}</p>
				{/if}
				{#if spec.followUpQuestions.length > 0}
					<div class="followups">
						<span class="hint-label">Follow-ups</span>
						<div class="followups-list">
							{#each spec.followUpQuestions as fq (fq)}
								<button class="chip" onclick={() => run(fq)} disabled={busy}>{fq}</button>
							{/each}
						</div>
					</div>
				{/if}

				<Separator />

				<button
					type="button"
					class="profile-toggle"
					onclick={() => (showProfile = !showProfile)}
					aria-expanded={showProfile}
				>
					{#if showProfile}
						<ChevronDown class="size-3.5" />
					{:else}
						<ChevronRight class="size-3.5" />
					{/if}
					<span>Statistical profile sent to model</span>
					<Badge variant="outline" class="ml-1 font-mono">{JSON.stringify(profile).length} chars</Badge>
				</button>
				{#if showProfile}
					<pre class="profile">{compactProfileForPrompt(profile)}</pre>
				{/if}
			</Card.Content>
		</Card.Root>
	{:else if !busy && !error}
		<div class="empty">
			<div class="empty-inner">
				<Sparkles class="size-5" />
				<div>
					<div class="empty-title">No chart yet</div>
					<div class="empty-desc">Type a question or pick a suggestion above to generate one.</div>
				</div>
			</div>
		</div>
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
					<Button variant="outline" onclick={refreshWasmDiag}>Refresh</Button>
					<Button onclick={() => (showWasmDebug = false)}>Close</Button>
				</div>
			</div>
		</div>
	{/if}
</main>

<style>
	main {
		max-width: 980px;
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
		max-width: 56ch;
		line-height: 1.5;
	}

	.wasm-status {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.32rem 0.65rem;
		border-radius: 999px;
		border: 1px solid var(--color-border, #e5e7eb);
		background: var(--color-card, #fff);
		font-size: 0.75rem;
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
	.diag .hint {
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

	.picker {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}
	.ds {
		text-align: left;
		padding: 0.65rem 0.8rem;
		border: 1px solid var(--color-border, #e5e7eb);
		border-radius: 8px;
		background: transparent;
		cursor: pointer;
		transition: border-color 120ms ease, background 120ms ease, transform 120ms ease;
	}
	.ds:hover {
		border-color: color-mix(in srgb, var(--color-primary) 40%, var(--color-border));
		background: var(--color-accent, rgba(59, 130, 246, 0.04));
	}
	.ds.selected {
		border-color: var(--color-primary, #3b82f6);
		background: var(--color-accent, rgba(59, 130, 246, 0.08));
		box-shadow: inset 0 0 0 1px var(--color-primary, #3b82f6);
	}
	.ds-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
	}
	.ds-text {
		min-width: 0;
	}
	.ds-label {
		font-weight: 600;
		font-size: 0.92rem;
	}
	.ds-desc {
		font-size: 0.78rem;
		color: var(--color-muted-foreground, #6b7280);
		margin-top: 0.15rem;
		line-height: 1.4;
	}
	.ds-check {
		width: 1.25rem;
		height: 1.25rem;
		border-radius: 50%;
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--color-primary);
		flex-shrink: 0;
	}
	.ds.selected .ds-check {
		background: var(--color-primary);
		color: var(--color-primary-foreground);
	}

	.ask {
		display: flex;
		gap: 0.5rem;
	}
	.ask :global(input) {
		flex: 1;
	}

	.suggestions {
		display: flex;
		gap: 0.4rem;
		flex-wrap: wrap;
		align-items: center;
	}
	.hint-label {
		font-size: 0.72rem;
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--color-muted-foreground, #6b7280);
		margin-right: 0.1rem;
	}
	.chip {
		padding: 0.3rem 0.7rem;
		border-radius: 999px;
		border: 1px solid var(--color-border, #e5e7eb);
		background: var(--color-card, transparent);
		color: var(--color-foreground);
		font-size: 0.78rem;
		cursor: pointer;
		transition: background 120ms ease, border-color 120ms ease, transform 120ms ease;
	}
	.chip:hover:not(:disabled) {
		background: var(--color-accent, rgba(0, 0, 0, 0.04));
		border-color: color-mix(in srgb, var(--color-primary) 40%, var(--color-border));
	}
	.chip:active:not(:disabled) {
		transform: translateY(1px);
	}
	.chip:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.llm-row {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1.6fr);
		gap: 0.75rem;
	}
	@media (max-width: 720px) {
		.llm-row {
			grid-template-columns: 1fr;
		}
	}
	.llm-col {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		min-width: 0;
	}
	.llm-col :global([data-slot="select-trigger"]) {
		width: 100%;
		height: 2.25rem;
	}
	.api-note {
		margin: 0;
		font-size: 0.72rem;
		color: var(--color-muted-foreground);
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

	:global(.result .result-content) {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		padding-top: 1.25rem;
	}
	.caption {
		font-size: 0.95rem;
		color: var(--color-foreground, inherit);
		margin: 0;
		line-height: 1.5;
	}
	.followups {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
		align-items: center;
	}
	.followups-list {
		display: flex;
		gap: 0.4rem;
		flex-wrap: wrap;
	}

	.profile-toggle {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.78rem;
		color: var(--color-muted-foreground, #6b7280);
		text-align: left;
		background: transparent;
		border: none;
		cursor: pointer;
		padding: 0;
		align-self: flex-start;
	}
	.profile-toggle:hover {
		color: var(--color-foreground);
	}
	.profile {
		font-size: 0.72rem;
		max-height: 240px;
		overflow: auto;
		background: var(--color-muted, rgba(0, 0, 0, 0.04));
		padding: 0.7rem 0.8rem;
		border: 1px solid var(--color-border);
		border-radius: 8px;
		white-space: pre-wrap;
		word-break: break-word;
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		line-height: 1.5;
		margin: 0;
	}

	.empty {
		display: flex;
		justify-content: center;
		padding: 2rem 1rem;
		border: 1px dashed var(--color-border);
		border-radius: 12px;
		background: color-mix(in srgb, var(--color-card) 60%, transparent);
	}
	.empty-inner {
		display: flex;
		align-items: center;
		gap: 0.85rem;
		color: var(--color-muted-foreground);
	}
	.empty-title {
		color: var(--color-foreground);
		font-weight: 500;
		font-size: 0.92rem;
	}
	.empty-desc {
		font-size: 0.82rem;
		margin-top: 0.1rem;
	}
</style>
