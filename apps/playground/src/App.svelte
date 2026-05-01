<script lang="ts">
	import { variableFont } from '@variable-font/svelte';
	import { easeOutCubic } from '@variable-font/core';
	import * as Tabs from '$lib/components/ui/tabs';
	import * as Card from '$lib/components/ui/card';
	import { Slider } from '$lib/components/ui/slider';
	import { Label } from '$lib/components/ui/label';
	import KineticText from './KineticText.svelte';
	import PromptStudio from './PromptStudio.svelte';
	import ResponseMap from './ResponseMap.svelte';
	import SmartCharts from './SmartCharts.svelte';

	type Tab = 'sliders' | 'kinetic' | 'prompt-studio' | 'response-map' | 'smart-charts';
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

	function handleSliderChange(tag: string, values: number[]) {
		if (values.length > 0) {
			font.set({ [tag]: values[0] });
		}
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
	</header>

	<Tabs.Root bind:value={activeTab} class="flex-1 flex flex-col">
		<Tabs.List class="sticky top-12 z-10 w-full justify-start">
			<Tabs.Trigger value="sliders">Sliders</Tabs.Trigger>
			<Tabs.Trigger value="kinetic">Kinetic</Tabs.Trigger>
			<Tabs.Trigger value="prompt-studio">Prompt Studio</Tabs.Trigger>
			<Tabs.Trigger value="response-map">Response Map</Tabs.Trigger>
			<Tabs.Trigger value="smart-charts">Smart Charts</Tabs.Trigger>
		</Tabs.List>

		<Tabs.Content value="sliders">
			<main>
				<h1 use:font.apply>Variable Font Playground</h1>

				<Card.Root>
					<Card.Header>
						<Card.Title>Font Axes</Card.Title>
					</Card.Header>
					<Card.Content class="space-y-4">
						{#each Object.entries(font.axes) as [tag, value]}
							{@const range = axisRanges[tag] ?? { min: 0, max: 1, step: 0.01 }}
							<div class="space-y-2">
								<div class="flex justify-between items-center">
									<Label for={tag} class="font-mono text-sm">{tag}</Label>
									<span class="font-mono text-sm text-muted-foreground">{typeof value === 'number' ? value.toFixed(2) : ''}</span>
								</div>
								<Slider
									id={tag}
									min={range.min}
									max={range.max}
									step={range.step}
									value={[value]}
									onValueChange={(values) => handleSliderChange(tag, values)}
								/>
							</div>
						{/each}
					</Card.Content>
				</Card.Root>

				<p use:font.apply class="sample">
					The quick brown fox jumps over the lazy dog.<br />
					Pack my box with five dozen liquor jugs.
				</p>

				<p use:font.apply class="sample-sm">
					Casey Haber — variable font interpolation renderer
				</p>
			</main>
		</Tabs.Content>

		<Tabs.Content value="kinetic">
			<KineticText />
		</Tabs.Content>

		<Tabs.Content value="prompt-studio">
			<PromptStudio />
		</Tabs.Content>

		<Tabs.Content value="response-map">
			<ResponseMap onSent={() => (activeTab = 'prompt-studio')} />
		</Tabs.Content>

		<Tabs.Content value="smart-charts">
			<SmartCharts />
		</Tabs.Content>
	</Tabs.Root>
</div>

<style>
	:global(body) {
		margin: 0;
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
		padding: 0.9rem 1.5rem;
		border-bottom: 1px solid var(--color-border);
		position: sticky;
		top: 0;
		background: var(--color-background);
		z-index: 10;
	}

	.logo {
		font-size: 1.4rem;
		font-weight: 700;
		letter-spacing: -0.02em;
		color: var(--color-primary);
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
		color: var(--color-muted-foreground);
	}
</style>
