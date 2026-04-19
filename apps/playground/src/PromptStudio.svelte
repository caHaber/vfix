<script lang="ts">
	import { registry, analyze, tokenDiff, MODEL_PRICING } from '@prompt-studio/core';
	import type { Analysis, TokenDiff, TokenizerID, ModelID } from '@prompt-studio/core';
	import { onMount } from 'svelte';

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

	async function switchTokenizer(id: TokenizerID) {
		loading = true;
		tokenizerId = id;
		// Update model to match tokenizer
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

	function onModelChange(e: Event) {
		modelId = (e.target as HTMLSelectElement).value as ModelID;
		// Sync tokenizer from model
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

	// --- Token color cycling for boundary view ---
	const TOKEN_COLORS = [
		'rgba(124, 106, 247, 0.25)',
		'rgba(247, 106, 124, 0.25)',
		'rgba(106, 247, 180, 0.25)',
		'rgba(247, 220, 106, 0.25)',
		'rgba(106, 200, 247, 0.25)',
		'rgba(247, 150, 106, 0.25)',
	];
</script>

<div class="ps-container">
	<!-- Toolbar -->
	<div class="ps-toolbar">
		<div class="ps-tabs">
			<button class:active={subTab === 'analyze'} onclick={() => { subTab = 'analyze'; runAnalysis(); }}>
				Analyze
			</button>
			<button class:active={subTab === 'diff'} onclick={() => { subTab = 'diff'; runAnalysis(); }}>
				Diff
			</button>
		</div>

		<div class="ps-controls">
			<label>
				<span class="ctrl-label">Model</span>
				<select value={modelId} onchange={onModelChange}>
					{#each availableModels as m}
						<option value={m}>{m}</option>
					{/each}
				</select>
			</label>
			<label>
				<span class="ctrl-label">Tokenizer</span>
				<select value={tokenizerId} onchange={(e) => switchTokenizer((e.target as HTMLSelectElement).value as TokenizerID)}>
					{#each availableTokenizers as t}
						<option value={t}>{t}</option>
					{/each}
				</select>
			</label>
		</div>
	</div>

	{#if loading}
		<div class="ps-loading">Loading tokenizer...</div>
	{:else if subTab === 'analyze'}
		<!-- ANALYZE VIEW -->
		<div class="ps-analyze">
			<div class="ps-editor-col">
				<textarea
					class="ps-textarea"
					value={text}
					oninput={onTextInput}
					placeholder="Paste your prompt here..."
					spellcheck="false"
				></textarea>

				<!-- Token boundary overlay -->
				{#if showBoundaries && analysis && analysis.tokens.length > 0}
					<div class="ps-boundaries">
						<button class="toggle-boundaries" onclick={() => (showBoundaries = !showBoundaries)}>
							Hide tokens
						</button>
						<div class="ps-token-vis">
							{#each analysis.tokens as token, i}
								<span
									class="ps-token"
									style="background: {TOKEN_COLORS[i % TOKEN_COLORS.length]}"
									title="Token #{token.id}: {JSON.stringify(token.text)}"
								>{token.text}</span>
							{/each}
						</div>
					</div>
				{:else if !showBoundaries}
					<button class="toggle-boundaries" onclick={() => (showBoundaries = true)}>
						Show token boundaries
					</button>
				{/if}
			</div>

			<!-- Stats panel -->
			{#if analysis}
				<div class="ps-stats">
					<div class="stat-group">
						<h3>Tokens</h3>
						<div class="stat-big">{formatNumber(analysis.tokenCount)}</div>
						<div class="stat-sub">{formatNumber(analysis.characterCount)} chars</div>
						<div class="stat-sub">{analysis.density.toFixed(3)} tokens/char</div>
					</div>

					{#if analysis.estimatedCost}
						<div class="stat-group">
							<h3>Estimated Cost</h3>
							<div class="stat-row">
								<span>Input</span>
								<span class="stat-val">{formatCost(analysis.estimatedCost.input)}</span>
							</div>
							<div class="stat-row">
								<span>Output (est.)</span>
								<span class="stat-val">{formatCost(analysis.estimatedCost.output)}</span>
							</div>
						</div>
					{/if}

					{#if analysis.contextWindow}
						<div class="stat-group">
							<h3>Context Window</h3>
							<div class="ctx-bar-wrap">
								<div
									class="ctx-bar"
									class:warn={analysis.contextWindow.percentage > 80}
									class:error={analysis.contextWindow.percentage > 100}
									style="width: {Math.min(analysis.contextWindow.percentage, 100)}%"
								></div>
							</div>
							<div class="stat-sub">
								{formatNumber(analysis.contextWindow.used)} / {formatNumber(analysis.contextWindow.total)}
								({analysis.contextWindow.percentage.toFixed(1)}%)
							</div>
						</div>
					{/if}

					{#if analysis.warnings.length > 0}
						<div class="stat-group">
							<h3>Warnings</h3>
							{#each analysis.warnings as w}
								<div class="warning">{w.message}</div>
							{/each}
						</div>
					{/if}

					{#if analysis.sections.length > 1}
						<div class="stat-group">
							<h3>Sections</h3>
							{#each analysis.sections as section}
								<div class="stat-row">
									<span class="section-label">{section.label}</span>
									<span class="stat-val">{formatNumber(section.tokenCount)}</span>
								</div>
							{/each}
						</div>
					{/if}
				</div>
			{/if}
		</div>

	{:else}
		<!-- DIFF VIEW -->
		<div class="ps-diff-view">
			<div class="ps-diff-editors">
				<div class="ps-diff-pane">
					<div class="pane-label">Before</div>
					<textarea
						class="ps-textarea"
						value={diffBefore}
						oninput={onDiffBeforeInput}
						placeholder="Original prompt..."
						spellcheck="false"
					></textarea>
				</div>
				<div class="ps-diff-pane">
					<div class="pane-label">After</div>
					<textarea
						class="ps-textarea"
						value={diffAfter}
						oninput={onDiffAfterInput}
						placeholder="Modified prompt..."
						spellcheck="false"
					></textarea>
				</div>
			</div>

			{#if diff}
				<div class="ps-diff-result">
					<div class="diff-header">
						<span class="diff-delta" class:positive={diff.tokenDelta > 0} class:negative={diff.tokenDelta < 0}>
							{diff.tokenDelta > 0 ? '+' : ''}{diff.tokenDelta} tokens
						</span>
						{#if diff.costDelta !== undefined}
							<span class="diff-cost">
								({diff.costDelta > 0 ? '+' : ''}{formatCost(Math.abs(diff.costDelta))}/call)
							</span>
						{/if}
					</div>
					<div class="diff-tokens">
						{#each diff.ops as op}
							{#each op.tokens as token}
								<span
									class="diff-token {op.type}"
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

<style>
	.ps-container {
		display: flex;
		flex-direction: column;
		min-height: calc(100vh - 57px);
		padding: 0;
	}

	.ps-toolbar {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 0.75rem 1.5rem;
		border-bottom: 1px solid #1e1e1e;
		flex-shrink: 0;
	}

	.ps-tabs {
		display: flex;
		gap: 0.25rem;
		background: #1a1a1a;
		border-radius: 6px;
		padding: 0.2rem;
	}

	.ps-tabs button {
		background: none;
		border: none;
		color: #666;
		font-size: 0.8rem;
		padding: 0.3rem 0.75rem;
		border-radius: 4px;
		cursor: pointer;
		font-family: monospace;
	}

	.ps-tabs button:hover {
		color: #ccc;
	}

	.ps-tabs button.active {
		background: #2a2a2a;
		color: #f0f0f0;
	}

	.ps-controls {
		display: flex;
		gap: 1rem;
		align-items: center;
	}

	.ps-controls label {
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}

	.ctrl-label {
		font-size: 0.7rem;
		color: #555;
		text-transform: uppercase;
		font-family: monospace;
		letter-spacing: 0.05em;
	}

	.ps-controls select {
		background: #1a1a1a;
		border: 1px solid #2a2a2a;
		color: #ccc;
		font-size: 0.8rem;
		padding: 0.3rem 0.5rem;
		border-radius: 4px;
		font-family: monospace;
	}

	.ps-loading {
		display: flex;
		align-items: center;
		justify-content: center;
		flex: 1;
		color: #555;
		font-family: monospace;
		font-size: 0.85rem;
	}

	/* --- Analyze View --- */
	.ps-analyze {
		display: grid;
		grid-template-columns: 1fr 280px;
		flex: 1;
		overflow: hidden;
	}

	.ps-editor-col {
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	.ps-textarea {
		flex: 1;
		min-height: 200px;
		background: #111;
		border: none;
		color: #e0e0e0;
		font-family: 'Berkeley Mono', 'JetBrains Mono', 'Fira Code', monospace;
		font-size: 0.85rem;
		line-height: 1.6;
		padding: 1.25rem 1.5rem;
		resize: none;
		outline: none;
		tab-size: 2;
	}

	.ps-textarea::placeholder {
		color: #333;
	}

	.ps-boundaries {
		border-top: 1px solid #1e1e1e;
		padding: 0.75rem 1.5rem;
		max-height: 300px;
		overflow-y: auto;
	}

	.toggle-boundaries {
		background: none;
		border: 1px solid #2a2a2a;
		color: #555;
		font-size: 0.7rem;
		padding: 0.25rem 0.6rem;
		border-radius: 4px;
		cursor: pointer;
		font-family: monospace;
		margin-bottom: 0.5rem;
	}

	.toggle-boundaries:hover {
		color: #999;
		border-color: #444;
	}

	.ps-token-vis {
		font-family: 'Berkeley Mono', 'JetBrains Mono', monospace;
		font-size: 0.8rem;
		line-height: 1.8;
		word-break: break-all;
	}

	.ps-token {
		border-radius: 2px;
		padding: 0.1rem 0;
		cursor: default;
		white-space: pre-wrap;
	}

	.ps-token:hover {
		outline: 1px solid rgba(124, 106, 247, 0.6);
	}

	/* --- Stats Panel --- */
	.ps-stats {
		border-left: 1px solid #1e1e1e;
		padding: 1.25rem;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
	}

	.stat-group h3 {
		font-size: 0.7rem;
		color: #555;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		font-family: monospace;
		margin: 0 0 0.5rem;
	}

	.stat-big {
		font-size: 2rem;
		font-weight: 700;
		color: #7c6af7;
		font-family: monospace;
		line-height: 1;
		margin-bottom: 0.25rem;
	}

	.stat-sub {
		font-size: 0.75rem;
		color: #555;
		font-family: monospace;
	}

	.stat-row {
		display: flex;
		justify-content: space-between;
		font-size: 0.8rem;
		color: #888;
		font-family: monospace;
		padding: 0.15rem 0;
	}

	.stat-val {
		color: #ccc;
	}

	.section-label {
		max-width: 150px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.ctx-bar-wrap {
		height: 6px;
		background: #1a1a1a;
		border-radius: 3px;
		overflow: hidden;
		margin-bottom: 0.4rem;
	}

	.ctx-bar {
		height: 100%;
		background: #7c6af7;
		border-radius: 3px;
		transition: width 0.2s;
	}

	.ctx-bar.warn {
		background: #f7a636;
	}

	.ctx-bar.error {
		background: #f74a4a;
	}

	.warning {
		font-size: 0.75rem;
		color: #f7a636;
		font-family: monospace;
		padding: 0.3rem 0;
	}

	/* --- Diff View --- */
	.ps-diff-view {
		display: flex;
		flex-direction: column;
		flex: 1;
		overflow: hidden;
	}

	.ps-diff-editors {
		display: grid;
		grid-template-columns: 1fr 1fr;
		flex: 1;
		min-height: 0;
	}

	.ps-diff-pane {
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	.ps-diff-pane:first-child {
		border-right: 1px solid #1e1e1e;
	}

	.pane-label {
		font-size: 0.7rem;
		color: #555;
		text-transform: uppercase;
		font-family: monospace;
		letter-spacing: 0.1em;
		padding: 0.5rem 1.5rem;
		border-bottom: 1px solid #1a1a1a;
	}

	.ps-diff-result {
		border-top: 1px solid #1e1e1e;
		padding: 1rem 1.5rem;
		max-height: 300px;
		overflow-y: auto;
		flex-shrink: 0;
	}

	.diff-header {
		display: flex;
		gap: 0.75rem;
		align-items: baseline;
		margin-bottom: 0.75rem;
	}

	.diff-delta {
		font-family: monospace;
		font-size: 1rem;
		font-weight: 700;
		color: #888;
	}

	.diff-delta.positive {
		color: #f74a4a;
	}

	.diff-delta.negative {
		color: #4af77a;
	}

	.diff-cost {
		font-family: monospace;
		font-size: 0.8rem;
		color: #555;
	}

	.diff-tokens {
		font-family: 'Berkeley Mono', 'JetBrains Mono', monospace;
		font-size: 0.8rem;
		line-height: 1.8;
		word-break: break-all;
	}

	.diff-token {
		padding: 0.1rem 0;
		border-radius: 2px;
		white-space: pre-wrap;
	}

	.diff-token.equal {
		color: #888;
	}

	.diff-token.insert {
		background: rgba(74, 247, 122, 0.15);
		color: #4af77a;
	}

	.diff-token.delete {
		background: rgba(247, 74, 74, 0.15);
		color: #f74a4a;
		text-decoration: line-through;
	}
</style>
