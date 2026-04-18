import { Renderer } from '@vfir/core';
import type { AxisSnapshot, RendererOptions } from '@vfir/core';

export interface VFIRElement {
	/** Update axis targets (animated) */
	set(values: Record<string, number>): void;
	/** Jump instantly to values (no animation) */
	jumpTo(values: Record<string, number>): void;
	/** Destroy and clean up */
	destroy(): void;
	/** Access the underlying renderer */
	renderer: Renderer;
}

export interface VFIROptions extends RendererOptions {
	/** CSS selector or HTMLElement to target */
	target: string | HTMLElement;
}

/** Apply variable font interpolation to a DOM element */
export function vfir(options: VFIROptions): VFIRElement {
	const el =
		typeof options.target === 'string'
			? document.querySelector<HTMLElement>(options.target)
			: options.target;

	if (!el) throw new Error(`Target element not found: ${options.target}`);

	const renderer = new Renderer(options);

	renderer.interpolator.subscribe((axes: AxisSnapshot) => {
		const settings = Object.entries(axes)
			.map(([tag, value]) => `"${tag}" ${value}`)
			.join(', ');
		el.style.fontVariationSettings = settings;
		el.style.fontFamily = `"${options.fontFamily}"`;
	});

	return {
		set: (values) => renderer.interpolator.setAll(values),
		jumpTo: (values) => renderer.interpolator.jumpTo(values),
		destroy: () => renderer.destroy(),
		renderer,
	};
}
