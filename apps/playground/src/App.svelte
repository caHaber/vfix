<script lang="ts">
	import { variableFont } from '@vfir/svelte';
	import { easeOutCubic } from '@vfir/core';
	import KineticText from './KineticText.svelte';
	import PromptStudio from './PromptStudio.svelte';
	import ResponseMap from './ResponseMap.svelte';

	type Tab = 'sliders' | 'kinetic' | 'prompt-studio' | 'response-map';
	let activeTab = $state<Tab>('sliders');

	const font = variableFont({
		fontFamily: 'Recursive',
		axes: {
			wght: { tag: 'wght', min: 300, max: 1000, default: 400 },
			slnt: { tag: 'slnt', min: -15, max: 0, default: 0 },
			CASL: { tag: 'CASL', min: 0, max: 1, default: 0 },
			CRSV: { tag: 'CRSV', min: 0, max: 1, default: 0.5 },
			MONO: { tag: 'MONO', min: 0, max: 1, default: 0 },
		},
		easing: easeOutCubic,
		stiffness: 0.06,
	});

	const axisRanges: Record<string, { min: number; max: number; step: number }> = {
		wght: { min: 300, max: 1000, step: 1 },
		slnt: { min: -15, max: 0, step: 0.1 },
		CASL: { min: 0, max: 1, step: 0.01 },
		CRSV: { min: 0, max: 1, step: 0.01 },
		MONO: { min: 0, max: 1, step: 0.01 },
	};

	function handleSlider(tag: string, event: Event) {
		const target = event.target as HTMLInputElement;
		font.set({ [tag]: parseFloat(target.value) });
	}
</script>

<svelte:head>
	<link
		href="https://fonts.googleapis.com/css2?family=Recursive:slnt,wght,CASL,CRSV,MONO@-15..0,300..1000,0..1,0..1,0..1&display=swap"
		rel="stylesheet"
	/>
</svelte:head>

<div class="shell">
	<header>
		<span class="logo" use:font.apply>vfir</span>
		<nav>
			<button
				class:active={activeTab === 'sliders'}
				onclick={() => (activeTab = 'sliders')}
			>Sliders</button>
			<button
				class:active={activeTab === 'kinetic'}
				onclick={() => (activeTab = 'kinetic')}
			>Kinetic</button>
			<button
				class:active={activeTab === 'prompt-studio'}
				onclick={() => (activeTab = 'prompt-studio')}
			>Prompt Studio</button>
			<button
				class:active={activeTab === 'response-map'}
				onclick={() => (activeTab = 'response-map')}
			>Response Map</button>
		</nav>
	</header>

	{#if activeTab === 'sliders'}
		<main>
			<h1 use:font.apply>Variable Font Playground</h1>

			<div class="controls">
				{#each Object.entries(font.axes) as [tag, value]}
					{@const range = axisRanges[tag] ?? { min: 0, max: 1, step: 0.01 }}
					<label>
						<span class="tag">{tag}</span>
						<input
							type="range"
							min={range.min}
							max={range.max}
							step={range.step}
							value={value}
							oninput={(e) => handleSlider(tag, e)}
						/>
						<span class="value">{typeof value === 'number' ? value.toFixed(2) : ''}</span>
					</label>
				{/each}
			</div>

			<p use:font.apply class="sample">
				The quick brown fox jumps over the lazy dog.<br />
				Pack my box with five dozen liquor jugs.
			</p>

			<p use:font.apply class="sample-sm">
				Casey Haber — variable font interpolation renderer
			</p>
		</main>
	{:else if activeTab === 'kinetic'}
		<KineticText />
	{:else if activeTab === 'prompt-studio'}
		<PromptStudio />
	{:else}
		<ResponseMap />
	{/if}
</div>

<style>
	:global(body) {
		margin: 0;
		background: #0f0f0f;
		color: #f0f0f0;
		font-family: system-ui, sans-serif;
	}

	.shell {
		min-height: 100vh;
		display: flex;
		flex-direction: column;
	}

	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.9rem 1.5rem;
		border-bottom: 1px solid #1e1e1e;
		position: sticky;
		top: 0;
		background: #0f0f0f;
		z-index: 10;
	}

	.logo {
		font-size: 1.4rem;
		font-weight: 700;
		letter-spacing: -0.02em;
		color: #7c6af7;
	}

	nav {
		display: flex;
		gap: 0.25rem;
		background: #1a1a1a;
		border-radius: 8px;
		padding: 0.25rem;
	}

	nav button {
		background: none;
		border: none;
		color: #666;
		font-size: 0.85rem;
		padding: 0.35rem 0.85rem;
		border-radius: 6px;
		cursor: pointer;
		font-family: system-ui;
		transition: color 0.15s, background 0.15s;
	}

	nav button:hover {
		color: #ccc;
	}

	nav button.active {
		background: #2a2a2a;
		color: #f0f0f0;
	}

	main {
		max-width: 860px;
		margin: 3rem auto;
		padding: 0 1.5rem;
		width: 100%;
		box-sizing: border-box;
	}

	h1 {
		font-size: clamp(2rem, 5vw, 4rem);
		margin-bottom: 2rem;
		line-height: 1.1;
	}

	.controls {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		margin-bottom: 2.5rem;
		background: #1a1a1a;
		border-radius: 8px;
		padding: 1.25rem;
	}

	label {
		display: grid;
		grid-template-columns: 3rem 1fr 3.5rem;
		align-items: center;
		gap: 0.75rem;
	}

	.tag {
		font-family: monospace;
		font-size: 0.85rem;
		color: #888;
	}

	.value {
		font-family: monospace;
		font-size: 0.85rem;
		text-align: right;
		color: #aaa;
	}

	input[type='range'] {
		width: 100%;
		accent-color: #7c6af7;
	}

	.sample {
		font-family: 'Recursive', system-ui;
		font-size: clamp(1.5rem, 4vw, 2.5rem);
		line-height: 1.4;
		margin-bottom: 1.5rem;
	}

	.sample-sm {
		font-family: 'Recursive', system-ui;
		font-size: clamp(1rem, 2.5vw, 1.5rem);
		line-height: 1.6;
		color: #aaa;
	}
</style>
