<script lang="ts">
	import { registry, analyze, tokenDiff, MODEL_PRICING } from '@prompt-studio/core';
	import type { Analysis, TokenDiff, TokenizerID, ModelID } from '@prompt-studio/core';
	import { onMount } from 'svelte';
	import { consumePendingPrompt, promptBus } from '$lib/prompt-bus.svelte';
	import * as Tabs from '$lib/components/ui/tabs';
	import * as Select from '$lib/components/ui/select';
	import { Textarea } from '$lib/components/ui/textarea';
	import { Button } from '$lib/components/ui/button';
	import { Label } from '$lib/components/ui/label';

	type SubTab = 'analyze' | 'diff';
	let subTab = $state<SubTab>('analyze');

	// --- State ---
	let text = $state(SAMPLE_PROMPT);
	let diffBefore = $state(SAMPLE_BEFORE);
	let diffAfter = $state(SAMPLE_AFTER);

	let tokenizerId = $state<TokenizerID>('cl100k_base');
	let modelId = $state<ModelID>('gpt-4o');
	let analysis = $state<Analysis | null>(null);
	let diff = $state<TokenDiff | null>(null);
	let loading = $state(true);
	let showBoundaries = $state(true);

	const availableModels = Object.keys(MODEL_PRICING);
	const availableTokenizers: TokenizerID[] = ['cl100k_base', 'o200k_base'];

	// --- Init ---
	onMount(async () => {
		await registry.load(tokenizerId);
		loading = false;
		runAnalysis();
	});

	// Pick up prompts sent from Response Map after mount or tab switch.
	$effect(() => {
		if (promptBus.pendingPrompt !== null) {
			const incoming = consumePendingPrompt();
			if (incoming !== null) {
				text = incoming;
				subTab = 'analyze';
				if (!loading) runAnalysis();
			}
		}
	});

	async function switchTokenizer(id: TokenizerID) {
		loading = true;
		tokenizerId = id;
		const matchingModel = availableModels.find(
			(m) => MODEL_PRICING[m].tokenizer === id,
		);
		if (matchingModel) modelId = matchingModel as ModelID;

		await registry.load(id);
		loading = false;
		runAnalysis();
	}

	function runAnalysis() {
		if (loading) return;
		const tokenizer = registry.get(tokenizerId);
		if (subTab === 'analyze') {
			analysis = analyze(text, tokenizer, modelId);
		} else {
			diff = tokenDiff(diffBefore, diffAfter, tokenizer, modelId);
		}
	}

	function onTextInput(e: Event) {
		text = (e.target as HTMLTextAreaElement).value;
		runAnalysis();
	}

	function onDiffBeforeInput(e: Event) {
		diffBefore = (e.target as HTMLTextAreaElement).value;
		runAnalysis();
	}

	function onDiffAfterInput(e: Event) {
		diffAfter = (e.target as HTMLTextAreaElement).value;
		runAnalysis();
	}

	function selectModel(id: string) {
		modelId = id as ModelID;
		const pricing = MODEL_PRICING[modelId];
		if (pricing && pricing.tokenizer !== tokenizerId) {
			switchTokenizer(pricing.tokenizer);
		} else {
			runAnalysis();
		}
	}

	function formatCost(n: number): string {
		if (n < 0.001) return '<$0.001';
		if (n < 0.01) return `$${n.toFixed(4)}`;
		return `$${n.toFixed(3)}`;
	}

	function formatNumber(n: number): string {
		return n.toLocaleString();
	}

	const TOKEN_COLORS = [
		'rgba(107, 155, 210, 0.18)',
		'rgba(125, 185, 220, 0.18)',
		'rgba(155, 200, 225, 0.22)',
		'rgba(180, 210, 235, 0.22)',
		'rgba(140, 175, 215, 0.18)',
		'rgba(100, 140, 200, 0.15)',
	];
</script>

<div class="flex flex-col min-h-[calc(100vh-57px)]">
	<!-- Toolbar -->
	<div class="flex justify-between items-center gap-4 px-6 py-3 border-b border-border flex-shrink-0 flex-wrap">
		<Tabs.Root value={subTab} onValueChange={(val) => { subTab = val as SubTab; runAnalysis(); }}>
			<Tabs.List>
				<Tabs.Trigger value="analyze">Analyze</Tabs.Trigger>
				<Tabs.Trigger value="diff">Diff</Tabs.Trigger>
			</Tabs.List>
		</Tabs.Root>

		<div class="flex gap-3 items-center">
			<div class="flex items-center gap-2">
				<Label for="model-select" class="text-xs uppercase text-muted-foreground font-mono">Model</Label>
				<Select.Root type="single" value={modelId} onValueChange={selectModel}>
					<Select.Trigger id="model-select" class="w-40">
						{modelId}
					</Select.Trigger>
					<Select.Content>
						{#each availableModels as m}
							<Select.Item value={m}>{m}</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
			</div>
			<div class="flex items-center gap-2">
				<Label for="tokenizer-select" class="text-xs uppercase text-muted-foreground font-mono">Tokenizer</Label>
				<Select.Root type="single" value={tokenizerId} onValueChange={(val) => switchTokenizer(val as TokenizerID)}>
					<Select.Trigger id="tokenizer-select" class="w-40">
						{tokenizerId}
					</Select.Trigger>
					<Select.Content>
						{#each availableTokenizers as t}
							<Select.Item value={t}>{t}</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
			</div>
		</div>
	</div>

	{#if loading}
		<div class="flex items-center justify-center flex-1 text-muted-foreground font-mono text-sm">
			Loading tokenizer...
		</div>
	{:else if subTab === 'analyze'}
		<!-- ANALYZE VIEW -->
		<div class="grid grid-cols-[1fr_320px] flex-1 overflow-hidden">
			<div class="flex flex-col overflow-hidden">
				<Textarea
					value={text}
					oninput={onTextInput}
					placeholder="Paste your prompt here..."
					class="flex-1 min-h-[200px] font-mono text-sm leading-relaxed rounded-none border-0 resize-none p-6"
					spellcheck="false"
				/>

				{#if showBoundaries && analysis && analysis.tokens.length > 0}
					<div class="border-t border-border p-3 max-h-[300px] overflow-y-auto">
						<Button variant="outline" size="sm" class="mb-2" onclick={() => (showBoundaries = false)}>
							Hide tokens
						</Button>
						<div class="font-mono text-sm leading-[1.8] break-all">
							{#each analysis.tokens as token, i}
								<span
									class="rounded-sm py-[0.1rem] whitespace-pre-wrap hover:outline hover:outline-1 hover:outline-primary/60"
									style="background: {TOKEN_COLORS[i % TOKEN_COLORS.length]}"
									title="Token #{token.id}: {JSON.stringify(token.text)}"
								>{token.text}</span>
							{/each}
						</div>
					</div>
				{:else if !showBoundaries}
					<div class="border-t border-border p-3">
						<Button variant="outline" size="sm" onclick={() => (showBoundaries = true)}>
							Show token boundaries
						</Button>
					</div>
				{/if}
			</div>

			<!-- Stats panel -->
			{#if analysis}
				<div class="border-l border-border p-5 overflow-y-auto flex flex-col gap-5">
					<div>
						<h3 class="text-xs uppercase tracking-wider font-mono text-muted-foreground mb-2">Tokens</h3>
						<div class="text-3xl font-bold text-primary font-mono leading-none mb-1">{formatNumber(analysis.tokenCount)}</div>
						<div class="text-xs text-muted-foreground font-mono">{formatNumber(analysis.characterCount)} chars</div>
						<div class="text-xs text-muted-foreground font-mono">{analysis.density.toFixed(3)} tokens/char</div>
					</div>

					{#if analysis.estimatedCost}
						<div>
							<h3 class="text-xs uppercase tracking-wider font-mono text-muted-foreground mb-2">Estimated Cost</h3>
							<div class="flex justify-between text-sm text-muted-foreground font-mono py-[0.15rem]">
								<span>Input</span>
								<span class="text-foreground">{formatCost(analysis.estimatedCost.input)}</span>
							</div>
							<div class="flex justify-between text-sm text-muted-foreground font-mono py-[0.15rem]">
								<span>Output (est.)</span>
								<span class="text-foreground">{formatCost(analysis.estimatedCost.output)}</span>
							</div>
						</div>
					{/if}

					{#if analysis.contextWindow}
						<div>
							<h3 class="text-xs uppercase tracking-wider font-mono text-muted-foreground mb-2">Context Window</h3>
							<div class="h-1.5 bg-muted rounded-sm overflow-hidden mb-2">
								<div
									class="h-full rounded-sm transition-[width] duration-200 {analysis.contextWindow.percentage > 100 ? 'bg-destructive' : analysis.contextWindow.percentage > 80 ? 'bg-yellow-500' : 'bg-primary'}"
									style="width: {Math.min(analysis.contextWindow.percentage, 100)}%"
								></div>
							</div>
							<div class="text-xs text-muted-foreground font-mono">
								{formatNumber(analysis.contextWindow.used)} / {formatNumber(analysis.contextWindow.total)}
								({analysis.contextWindow.percentage.toFixed(1)}%)
							</div>
						</div>
					{/if}

					{#if analysis.warnings.length > 0}
						<div>
							<h3 class="text-xs uppercase tracking-wider font-mono text-muted-foreground mb-2">Warnings</h3>
							{#each analysis.warnings as w}
								<div class="text-xs text-yellow-500 font-mono py-1">{w.message}</div>
							{/each}
						</div>
					{/if}

					{#if analysis.sections.length > 1}
						<div>
							<h3 class="text-xs uppercase tracking-wider font-mono text-muted-foreground mb-2">Sections</h3>
							{#each analysis.sections as section}
								<div class="flex justify-between text-sm text-muted-foreground font-mono py-[0.15rem]">
									<span class="max-w-[150px] overflow-hidden text-ellipsis whitespace-nowrap">{section.label}</span>
									<span class="text-foreground">{formatNumber(section.tokenCount)}</span>
								</div>
							{/each}
						</div>
					{/if}
				</div>
			{/if}
		</div>
	{:else}
		<!-- DIFF VIEW -->
		<div class="flex flex-col flex-1 overflow-hidden">
			<div class="grid grid-cols-2 flex-1 min-h-0">
				<div class="flex flex-col overflow-hidden border-r border-border">
					<div class="text-xs text-muted-foreground uppercase font-mono tracking-wider px-6 py-2 border-b border-border">Before</div>
					<Textarea
						value={diffBefore}
						oninput={onDiffBeforeInput}
						placeholder="Original prompt..."
						class="flex-1 min-h-[200px] font-mono text-sm leading-relaxed rounded-none border-0 resize-none p-6"
						spellcheck="false"
					/>
				</div>
				<div class="flex flex-col overflow-hidden">
					<div class="text-xs text-muted-foreground uppercase font-mono tracking-wider px-6 py-2 border-b border-border">After</div>
					<Textarea
						value={diffAfter}
						oninput={onDiffAfterInput}
						placeholder="Modified prompt..."
						class="flex-1 min-h-[200px] font-mono text-sm leading-relaxed rounded-none border-0 resize-none p-6"
						spellcheck="false"
					/>
				</div>
			</div>

			{#if diff}
				<div class="border-t border-border px-6 py-4 max-h-[300px] overflow-y-auto flex-shrink-0">
					<div class="flex gap-3 items-baseline mb-3">
						<span class="font-mono text-base font-bold {diff.tokenDelta > 0 ? 'text-destructive' : diff.tokenDelta < 0 ? 'text-green-500' : 'text-muted-foreground'}">
							{diff.tokenDelta > 0 ? '+' : ''}{diff.tokenDelta} tokens
						</span>
						{#if diff.costDelta !== undefined}
							<span class="font-mono text-sm text-muted-foreground">
								({diff.costDelta > 0 ? '+' : ''}{formatCost(Math.abs(diff.costDelta))}/call)
							</span>
						{/if}
					</div>
					<div class="font-mono text-sm leading-[1.8] break-all">
						{#each diff.ops as op}
							{#each op.tokens as token}
								<span
									class="py-[0.1rem] rounded-sm whitespace-pre-wrap {op.type === 'insert' ? 'bg-green-500/15 text-green-500' : op.type === 'delete' ? 'bg-destructive/15 text-destructive line-through' : 'text-muted-foreground'}"
									title="Token #{token.id}"
								>{token.text}</span>
							{/each}
						{/each}
					</div>
				</div>
			{/if}
		</div>
	{/if}
</div>

<script module lang="ts">
const SAMPLE_PROMPT = `# System Prompt

You are a helpful assistant that specializes in code review. You should:

1. Analyze code for potential bugs, security vulnerabilities, and performance issues
2. Suggest improvements following best practices
3. Be concise but thorough in your explanations
4. Use markdown formatting for code examples

<context>
The user is working on a TypeScript project using React and Node.js.
The codebase follows functional programming patterns where possible.
</context>

## Response Format

Always structure your response as:
- **Summary**: One-line assessment
- **Issues**: Numbered list of problems found
- **Suggestions**: Actionable improvements
- **Revised Code**: If applicable, show the corrected version

Remember: Focus on correctness first, then readability, then performance.`;

const SAMPLE_BEFORE = `You are a helpful coding assistant. Review the following code and identify any bugs or issues. Be thorough and explain each problem you find.`;

const SAMPLE_AFTER = `You are an expert code reviewer specializing in TypeScript. Review the following code for:
1. Type safety issues
2. Potential runtime errors
3. Performance concerns

Be concise. Use bullet points. Show corrected code when applicable.`;
</script>
