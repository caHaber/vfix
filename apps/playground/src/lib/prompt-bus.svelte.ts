// Cross-tab channel so the Response Map can push a serialized prompt into
// Prompt Studio's analyze view. Consumed by App.svelte (tab switch) and
// PromptStudio.svelte (text replacement).
export const promptBus = $state({
	pendingPrompt: null as string | null,
});

export function sendPromptToStudio(text: string): void {
	promptBus.pendingPrompt = text;
}

export function consumePendingPrompt(): string | null {
	const text = promptBus.pendingPrompt;
	promptBus.pendingPrompt = null;
	return text;
}
