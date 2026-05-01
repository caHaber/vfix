import { Renderer } from '@variable-font/core';
import type { AxisSnapshot, RendererOptions } from '@variable-font/core';
import type { Action } from 'svelte/action';

export interface VariableFontParams {
	axes: Record<string, number>;
}

export interface VariableFontAttributes {
	'on:vfir-update'?: (e: CustomEvent<AxisSnapshot>) => void;
}

/** Create a variable font action for use with use:directive */
export function createVariableFont(options: RendererOptions) {
	const renderer = new Renderer(options);

	const apply: Action<HTMLElement, VariableFontParams, VariableFontAttributes> = (
		node,
		params,
	) => {
		if (params?.axes) {
			renderer.interpolator.jumpTo(params.axes);
		}

		const unsub = renderer.interpolator.subscribe((axes) => {
			const settings = Object.entries(axes)
				.map(([tag, value]) => `"${tag}" ${value}`)
				.join(', ');
			node.style.fontVariationSettings = settings;
			node.style.fontFamily = `"${options.fontFamily}"`;
			node.dispatchEvent(new CustomEvent('vfir-update', { detail: axes }));
		});

		return {
			update(newParams: VariableFontParams) {
				if (newParams?.axes) {
					renderer.interpolator.setAll(newParams.axes);
				}
			},
			destroy() {
				unsub();
			},
		};
	};

	return {
		apply,
		set: (values: Record<string, number>) => renderer.interpolator.setAll(values),
		jumpTo: (values: Record<string, number>) => renderer.interpolator.jumpTo(values),
		getSnapshot: () => renderer.interpolator.getSnapshot(),
		destroy: () => renderer.destroy(),
	};
}
