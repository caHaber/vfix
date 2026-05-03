import type { LayoutResult, RendererOptions, RenderState } from '@variable-font/core';
import { Renderer } from '@variable-font/core';
import { onDestroy } from 'svelte';

export type VariableFontOptions = RendererOptions;

/** Reactive variable font controller using Svelte 5 runes */
export function variableFont(options: VariableFontOptions) {
	const renderer = new Renderer(options);
	let currentAxes = $state(renderer.interpolator.getSnapshot());

	const unsub = renderer.interpolator.subscribe((axes) => {
		currentAxes = { ...axes };
	});

	onDestroy(() => {
		unsub();
		renderer.destroy();
	});

	return {
		get axes() {
			return currentAxes;
		},
		set(values: Record<string, number>) {
			renderer.interpolator.setAll(values);
		},
		jumpTo(values: Record<string, number>) {
			renderer.interpolator.jumpTo(values);
		},
		/** Svelte action — use with use:font.apply */
		apply(node: HTMLElement) {
			const innerUnsub = renderer.interpolator.subscribe((axes) => {
				const settings = Object.entries(axes)
					.map(([tag, value]) => `"${tag}" ${value}`)
					.join(', ');
				node.style.fontVariationSettings = settings;
				node.style.fontFamily = `"${options.fontFamily}"`;
			});
			return { destroy: innerUnsub };
		},
		/** Access the underlying renderer (for addBlock, onRender, layout) */
		renderer,
	};
}
