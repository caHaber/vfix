<script lang="ts">
	import type { RendererOptions, AxisSnapshot } from '@variable-font/core';
	import { variableFont } from './variableFont.svelte.js';
	import { untrack } from 'svelte';
	import type { Snippet } from 'svelte';

	interface Props {
		options: RendererOptions;
		tag?: string;
		class?: string;
		children?: Snippet;
		onupdate?: (axes: AxisSnapshot) => void;
	}

	let { options, tag = 'span', class: className, children, onupdate }: Props = $props();

	// options is stable init config — intentionally not reactive
	const font = untrack(() => variableFont(options));

	$effect(() => {
		if (onupdate) {
			onupdate(font.axes);
		}
	});
</script>

<svelte:element this={tag} use:font.apply class={className}>
	{#if children}
		{@render children()}
	{/if}
</svelte:element>
