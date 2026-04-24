# Playground → shadcn-svelte Migration — Haiku Execution Plan

**Target dir:** `apps/playground/`
**Run all commands from the repo root** unless noted.
**Pre-resolved decisions:**
- Scope: migrate all 4 tabs in this plan (shell, Sliders, Kinetic, Prompt Studio, Response Map).
- Theme: keep existing `#0f0f0f` background and `#7c6af7` primary.
- Icons: only where a shadcn-svelte component requires them.

**Execution rules for the agent:**
- Do steps in order. Do **not** skip or reorder.
- After every ✅ CHECKPOINT, stop and verify. If verification fails, fix before continuing.
- Prefer `pnpm --filter playground` over `cd apps/playground`.
- When a step says "edit file X", read the file first, then edit only the specified region.
- Do not modify any `packages/*` code. Do not change the Interpolator / `use:font.apply` logic.
- If a shadcn CLI prompt appears, accept the defaults listed in this plan.

---

## Step 1 — Install dependencies

Run:
```bash
pnpm --filter playground add tailwindcss@^4 @tailwindcss/vite tailwind-variants clsx tailwind-merge bits-ui lucide-svelte
```

✅ CHECKPOINT: `apps/playground/package.json` now lists all six packages under `dependencies` or `devDependencies`.

---

## Step 2 — Wire Tailwind into Vite

Edit `apps/playground/vite.config.ts`:
- Add `import tailwindcss from '@tailwindcss/vite';` at the top.
- Add `tailwindcss()` to the `plugins` array **before** `svelte()`.

✅ CHECKPOINT: `pnpm --filter playground run build` succeeds (no Tailwind errors; WASM stub fallback still works).

---

## Step 3 — Create `app.css` with theme tokens

Create `apps/playground/src/app.css` with exactly:

```css
@import "tailwindcss";

@theme {
  --color-background: #0f0f0f;
  --color-foreground: #f5f5f5;
  --color-primary: #7c6af7;
  --color-primary-foreground: #ffffff;
  --color-muted: #1a1a1a;
  --color-muted-foreground: #a1a1a1;
  --color-border: #262626;
  --color-input: #1a1a1a;
  --color-ring: #7c6af7;
  --color-card: #141414;
  --color-card-foreground: #f5f5f5;
  --color-accent: #1f1f1f;
  --color-accent-foreground: #f5f5f5;
  --color-secondary: #1a1a1a;
  --color-secondary-foreground: #f5f5f5;
  --color-destructive: #ef4444;
  --color-destructive-foreground: #ffffff;
  --radius: 0.5rem;
}

:root {
  color-scheme: dark;
}

html, body {
  background: var(--color-background);
  color: var(--color-foreground);
}
```

Edit `apps/playground/src/main.ts` — add as the first line:
```ts
import './app.css';
```

✅ CHECKPOINT: `pnpm --filter playground run dev` boots; the page still renders; background stays dark.

---

## Step 4 — Initialize shadcn-svelte

Run from `apps/playground/`:
```bash
cd apps/playground && pnpm dlx shadcn-svelte@latest init
```

Answers to prompts (accept these exactly):
- Which base color: **Slate**
- Global CSS file: `src/app.css`
- Tailwind config: (whichever the CLI suggests — Tailwind v4 uses CSS-based config; accept default)
- Components alias: `$lib/components`
- UI alias: `$lib/components/ui`
- Utils alias: `$lib/utils`
- Hooks alias: `$lib/hooks`

If the CLI rewrites `app.css` and removes the theme tokens from Step 3, re-apply the `@theme { ... }` block from Step 3 after the init completes.

Edit `apps/playground/tsconfig.json` — ensure `compilerOptions.paths` contains:
```json
"$lib/*": ["./src/lib/*"]
```
And `compilerOptions.baseUrl` is `"."`.

Edit `apps/playground/vite.config.ts` — add to `resolve.alias`:
```ts
'$lib': resolve(__dirname, './src/lib'),
```

✅ CHECKPOINT:
- `apps/playground/src/lib/utils.ts` exists (shadcn scaffolds it).
- `pnpm --filter playground run build` still succeeds.

---

## Step 5 — Add shadcn components

Run from `apps/playground/`:
```bash
cd apps/playground && pnpm dlx shadcn-svelte@latest add button input label textarea select slider tabs card badge separator
```

✅ CHECKPOINT: `apps/playground/src/lib/components/ui/` contains subdirs: `button`, `input`, `label`, `textarea`, `select`, `slider`, `tabs`, `card`, `badge`, `separator`.

---

## Step 6 — Refactor `App.svelte` shell

Read `apps/playground/src/App.svelte` in full first.

Replace the custom `<nav>` / tab-switching block with shadcn `<Tabs>`:
- Import: `import * as Tabs from '$lib/components/ui/tabs';`
- Keep the existing `activeTab` reactive state variable; bind it to `<Tabs.Root bind:value={activeTab}>`.
- Tab labels (in order): `Sliders`, `Kinetic`, `Prompt Studio`, `Response Map`.
- Each tab's existing content goes inside a `<Tabs.Content value="...">`.
- Keep the `variableFont` store and `use:font.apply` directive exactly as-is.

Delete from the `<style>` block **only**: rules that target the old `<nav>`, tab buttons, and header layout. **Keep** any rules that style tab *content* (Sliders form, etc.) — those get migrated in later steps.

✅ CHECKPOINT: `pnpm --filter playground run dev` — all 4 tabs still navigate; font-axis sliders still drive the font.

---

## Step 7 — Migrate Sliders tab (inside `App.svelte`)

Inside the Sliders `<Tabs.Content>`:
- Import `import * as Card from '$lib/components/ui/card';`
- Import `import { Slider } from '$lib/components/ui/slider';`
- Import `import { Label } from '$lib/components/ui/label';`
- Wrap the sliders in `<Card.Root><Card.Header><Card.Title>Font axes</Card.Title></Card.Header><Card.Content>…</Card.Content></Card.Root>`.
- For each `<input type="range">`: replace with `<Slider type="single" bind:value={...} min={...} max={...} step={...} />`. shadcn-svelte's Slider uses a single-number value when `type="single"` — map the existing scalar binding directly.
- Replace each `<label>` with `<Label>`; keep the monospace value readout as a sibling `<span class="font-mono text-sm text-muted-foreground">`.

Delete old slider-specific CSS from `<style>`.

✅ CHECKPOINT: Sliders render, dragging them animates the variable font exactly like before.

---

## Step 8 — Migrate Kinetic tab (`KineticText.svelte`)

Read `apps/playground/src/KineticText.svelte` in full first.

- Import `Button` from `$lib/components/ui/button`.
- Replace control `<button>` elements with `<Button variant="secondary">` for primary actions and `<Button variant="outline">` for preset toggles.
- **Do not touch** the text-rendering canvas / animation loop.
- Delete CSS rules that styled the replaced buttons.

✅ CHECKPOINT: Kinetic tab renders, all buttons respond, animation is unchanged.

---

## Step 9 — Migrate Prompt Studio (`PromptStudio.svelte`)

Read `apps/playground/src/PromptStudio.svelte` in full first (it's ~668 lines — read in chunks of 400).

- Imports: `Button`, `Input`, `Label`, `Textarea`, `* as Card`, `* as Select`.
- For each panel / section, wrap in `<Card.Root><Card.Header><Card.Title>…</Card.Title></Card.Header><Card.Content>…</Card.Content></Card.Root>`.
- Replace text inputs with `<Input>`; password / API-key inputs with `<Input type="password">`.
- Replace textareas with `<Textarea>`.
- Replace any `<select>` with shadcn `<Select.Root>` (keep the same bound value).
- Replace `<button>` with `<Button>`; use `variant="default"` for primary actions, `variant="outline"` for secondary, `variant="ghost"` for icon-only.
- Delete CSS rules for inputs/buttons/cards you just replaced. Keep layout/grid rules.

✅ CHECKPOINT: Prompt Studio renders, all form fields + buttons work, submitting prompts still produces a response.

---

## Step 10 — Migrate Response Map (`ResponseMap.svelte`)

Read `apps/playground/src/ResponseMap.svelte` in full first.

- Imports: `Button`, `Input`, `Label`, `* as Select`, `* as Card`, `Badge`.
- Toolbar row: wrap in `<div class="flex items-center gap-2 p-3 border-b">`, containing:
  - `<Input type="password" bind:value={apiKey} placeholder="API key" />`
  - `<Select.Root bind:value={mode}>…</Select.Root>`
  - `<Button onclick={handleMap}>Map response</Button>`
- **Do not touch** the animated canvas or absolute-positioned block rendering — they rely on `Interpolator` positions.
- Add a helper `function typeToClasses(type: string): string` that returns Tailwind classes (`bg-primary/20 text-primary`, `bg-accent text-accent-foreground`, etc.) for each block type. Replace per-type CSS classes with the helper's output applied to the block element.
- Optional: use `<Badge>` for the block-type chip on each block.
- Delete CSS rules for the toolbar and per-type colors you just replaced.

✅ CHECKPOINT: Response Map renders; API key persists across reloads; mode switches work; blocks animate into position on "Map response".

---

## Step 11 — Global cleanup

- In each `.svelte` file touched, check the remaining `<style>` block. Delete any rule whose selector no longer matches (old class names, old tag selectors for elements now replaced).
- Run a repo-wide grep for leftover references:
  ```bash
  pnpm --filter playground exec grep -rE "class=\"(nav|tab-btn|slider-row|toolbar|block-[a-z]+)\"" src/ || true
  ```
  Remove any stale class names found (they won't resolve anymore).
- Do **not** extract wrappers into `$lib/components/` unless a pattern repeats 3+ times.

✅ CHECKPOINT: No dead CSS; no stale class names.

---

## Step 12 — Verify

Run each and report results:
```bash
pnpm build
pnpm --filter playground run dev
```

Manually (or via preview tools) verify:
- Dark theme consistent across all 4 tabs.
- Tab switching via shadcn `<Tabs>` works.
- Sliders tab: dragging updates the variable font (Interpolator spring intact).
- Kinetic tab: animation unchanged, controls responsive.
- Prompt Studio: form submits and renders response.
- Response Map: API key persists, mode switch works, blocks animate.
- No errors in browser console.

✅ CHECKPOINT: All verification items pass.

---

## Step 13 — Commit

Stage only `apps/playground/` changes:
```bash
git add apps/playground
git status  # confirm nothing outside apps/playground is staged
git commit -m "Migrate playground to shadcn-svelte"
```

Do **not** push. Do **not** open a PR unless the user asks.

---

## Non-goals (do not do any of these)

- Don't edit `packages/core`, `packages/svelte`, `packages/cartographer`, `packages/wasm`.
- Don't rewrite the Interpolator spring logic or `use:font.apply`.
- Don't add new features. Visual + structural changes only.
- Don't bump Svelte / Vite / TypeScript versions.
- Don't reformat files outside the regions you're actively editing.
