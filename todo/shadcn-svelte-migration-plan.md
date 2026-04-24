# Playground → shadcn-svelte Migration — Lightweight Plan

**Target:** `apps/playground/`
**Goal:** Replace hand-rolled CSS in the playground with [shadcn-svelte](https://www.shadcn-svelte.com) components. Keep the 4 tabs (Sliders, Kinetic, Prompt Studio, Response Map) working and visually coherent in a dark theme.

---

## Phase 1: Install Tailwind v4 + shadcn-svelte

1. Add `tailwindcss@^4`, `@tailwindcss/vite`, `tailwind-variants`, `clsx`, `tailwind-merge`, `bits-ui`, `lucide-svelte` to `apps/playground`.
2. Add `@tailwindcss/vite` plugin to `apps/playground/vite.config.ts`.
3. Create `apps/playground/src/app.css` with `@import "tailwindcss";` + shadcn CSS variables (dark-mode default, match existing `#0f0f0f` background / `#7c6af7` primary).
4. Import `app.css` in `apps/playground/src/main.ts` (before mounting).
5. Run `pnpm dlx shadcn-svelte@latest init` inside `apps/playground/` — pick Slate base, dark mode, `$lib/components/ui` alias.
6. Verify: `pnpm --filter playground run dev` boots without errors; Tailwind classes apply.

## Phase 2: Add components

Run `pnpm dlx shadcn-svelte@latest add <comp>` for each:

- `button` — nav, toolbar actions
- `input` — API key, text fields
- `label` — form labels
- `textarea` — Prompt Studio, Response Map
- `select` — mode selector
- `slider` — variable-font axis sliders
- `tabs` — replace custom nav pill
- `card` — group controls + sample blocks
- `badge` — block-type chips in Response Map (optional)
- `separator` — header/toolbar dividers

## Phase 3: Refactor shell (`App.svelte`)

- Replace custom `<nav>` with `<Tabs>` (`Sliders | Kinetic | Prompt Studio | Response Map`).
- Wrap each tab's content in a `<Tabs.Content>`.
- Keep `variableFont` + `use:font.apply` — only swap chrome.
- Delete the `<style>` block's nav/header rules once migrated (keep global body color reset in `app.css`).

## Phase 4: Sliders tab (inside `App.svelte`)

- Wrap sliders in a `<Card>` with `<CardHeader>` + `<CardContent>`.
- Replace each `<input type="range">` with `<Slider>` from shadcn (bind `value` as a single-element array).
- Use `<Label>` + monospace `<span>` for tag + value readout.

## Phase 5: Response Map (`ResponseMap.svelte`)

- Toolbar: `<Input type="password">` for API key, `<Select>` for mode, `<Button>` for "Map response".
- Wrap toolbar in `<Card>` or a flex row with `gap-2 p-3 border-b`.
- Keep the animated canvas + block rendering unchanged (those are `Interpolator`-driven absolute positions, not layout-dependent).
- Convert per-type block colors to Tailwind utility classes via a small `typeToClasses(type)` helper instead of CSS.

## Phase 6: Prompt Studio (`PromptStudio.svelte`)

- Replace inputs/buttons with shadcn equivalents.
- Use `<Card>` for each panel.
- Use `<Textarea>` for prompt/response.

## Phase 7: Kinetic (`KineticText.svelte`)

- Smallest surface — likely just swap the control buttons and presets to `<Button variant="secondary">`, `<Button variant="outline">`.
- Keep the text-rendering canvas untouched.

## Phase 8: Cleanup

- Remove dead CSS blocks from each `.svelte` file (anything now handled by Tailwind).
- Consolidate any repeated utility patterns into `$lib/components/` wrappers only if used 3+ times.
- Grep for leftover inline `style=` and CSS class names that no longer resolve.

## Phase 9: Verify

- `pnpm build` — all packages still build.
- `pnpm --filter playground run dev` — open http://localhost:5173, walk every tab, check:
  - Dark theme consistent across tabs
  - Tab switching works
  - Sliders still drive the font (Interpolator spring intact)
  - Response Map: API key persists, mode switches, blocks animate
  - No console errors

## Phase 10: Commit

One commit per phase, or one squashed commit. Title: `Migrate playground to shadcn-svelte`.

---

## Open decisions (leave for execution)

- **Scope:** shell + Response Map only as a first pass, OR all 4 tabs in one go? (Full pass is ~2x the work but avoids a mixed-style playground.)
- **Theme tokens:** match the existing purple `#7c6af7` as `--primary`, or adopt shadcn's defaults? Existing purple ties into the `vfir` logo, keep it.
- **Icons:** `lucide-svelte` everywhere, or only where shadcn components require it?

## Non-goals

- Don't touch library packages (`@vfir/core`, `@vfir/svelte`, `@vfir/cartographer`, `@vfir/wasm`) — they stay framework-agnostic.
- Don't rewrite the Interpolator animation plumbing — it's orthogonal to styling.
- Don't add new features during the migration. Visual + structural only.