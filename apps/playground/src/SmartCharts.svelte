<script lang="ts">
	import {
		SmartChart,
		createChart,
		compactProfileForPrompt,
		type EnhancementSpec,
		type LLMConfig,
		type StatisticalProfile,
		type SmartChartSession,
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
		try {
			const llm: LLMConfig | undefined = provider === 'mock'
				? { provider: 'mock', model: 'mock' }
				: { provider, model, apiKey };
			profile = await session.analyze();
			spec = await session.enhance({ question: q, llm });
		} catch (err) {
			error = err instanceof Error ? err.message : String(err);
		} finally {
			busy = false;
		}
	}
</script>

<main>
	<header class="head">
		<h1>Smart Charts</h1>
		<p>Pick a dataset, ask a question. Statistics run in WASM, the LLM only sees the profile.</p>
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
