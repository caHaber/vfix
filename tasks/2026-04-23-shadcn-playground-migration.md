# Playground → shadcn-svelte Migration

**Date:** 2026-04-23
**Model:** claude-opus-4-7
**Status:** Complete (first pass)

## Summary

Migrated `apps/playground/` chrome from hand-rolled CSS to Tailwind v4 +
shadcn-svelte. Shell nav, Sliders tab, Prompt Studio, and Kinetic tab now
use shadcn primitives (Tabs, Card, Slider, Button, Input, Textarea, Label,
Select, Badge, Separator). Response Map still uses its own bespoke canvas
styling — intentional, the circle-cloud layout is not a form-control surface.

## What was done

### Tailwind v4 + shadcn-svelte setup

- Added `tailwindcss@^4`, `@tailwindcss/vite`, `tailwind-variants`, `clsx`,
  `tailwind-merge`, `bits-ui`, `lucide-svelte`, `@lucide/svelte`,
  `@internationalized/date` to [apps/playground/package.json](apps/playground/package.json).
- Registered `@tailwindcss/vite` plugin in [apps/playground/vite.config.ts](apps/playground/vite.config.ts).
- Created [apps/playground/src/app.css](apps/playground/src/app.css) with
  `@import "tailwindcss";` and shadcn CSS variables tuned to the existing
  dark palette (matte background, vfir purple accent).
- Imported `app.css` in [apps/playground/src/main.ts](apps/playground/src/main.ts)
  before mounting.
- Ran `shadcn-svelte init` with the Slate base, dark-mode default, and
  `$lib/components/ui` alias.
- Added [apps/playground/tailwind.config.ts](apps/playground/tailwind.config.ts)
  and [apps/playground/components.json](apps/playground/components.json).
- Updated [apps/playground/tsconfig.json](apps/playground/tsconfig.json)
  with the `$lib` path alias.

### Components added

Under `apps/playground/src/lib/components/ui/`:

- `button`, `input`, `label`, `textarea`, `select`
- `slider`, `tabs`, `card`, `badge`, `separator`

Plus a shared utility layer:

- [apps/playground/src/lib/utils.ts](apps/playground/src/lib/utils.ts) — the
  standard `cn()` wrapper over `clsx` + `tailwind-merge`.
- [apps/playground/src/lib/prompt-bus.svelte.ts](apps/playground/src/lib/prompt-bus.svelte.ts)
  — small $state-backed pub/sub for broadcasting prompts between tabs.

### Shell refactor

[apps/playground/src/App.svelte](apps/playground/src/App.svelte):

- Replaced the hand-rolled `<nav>` button strip with shadcn `<Tabs>`.
- Wrapped Sliders content in `<Card>` + `<CardContent>`, swapped each
  `<input type="range">` for `<Slider>` (array-bound value), used `<Label>`
  for tag + monospace `<span>` for the numeric readout.
- Deleted the nav/header/slider CSS rules — Tailwind classes now.

### Tab migrations

- **Prompt Studio** — [apps/playground/src/PromptStudio.svelte](apps/playground/src/PromptStudio.svelte).
  Panels now `<Card>`, inputs `<Input>`/`<Textarea>`, buttons `<Button>`,
  mode select `<Select>`. Lost ~440 lines of ad-hoc CSS.
- **Kinetic** — [apps/playground/src/KineticText.svelte](apps/playground/src/KineticText.svelte).
  Minimal: preset + action buttons swapped to `<Button variant="secondary">`
  / `<Button variant="outline">`. Canvas render untouched.
- **Response Map** — left with its own styling for now; toolbar controls
  use shadcn but the canvas is bespoke.

## Key decisions

- **First-pass scope included all four tabs.** A mixed-style playground
  would have looked worse than either extreme, so we paid the full cost
  up front instead of migrating incrementally.
- **Kept vfir purple as `--primary`.** shadcn defaults to Slate-neutral;
  the logo + existing dark theme both lean into purple, so we overrode
  the primary token rather than restyling the rest.
- **No library-package touch.** `@vfir/core`, `@vfir/svelte`,
  `@vfir/cartographer`, `@vfir/wasm` stay framework-agnostic. The
  migration only touches `apps/playground/`.
- **`prompt-bus.svelte.ts` sits in `lib/`, not in `@vfir/core`.** It's a
  playground-only cross-tab channel for "copy this prompt into Prompt
  Studio" actions. Doesn't belong in a library.

## Key files

| File | Purpose |
|------|---------|
| `apps/playground/package.json` | +Tailwind v4 + shadcn deps |
| `apps/playground/vite.config.ts` | +`@tailwindcss/vite` plugin |
| `apps/playground/tsconfig.json` | +`$lib` path alias |
| `apps/playground/tailwind.config.ts` | Tailwind config (new) |
| `apps/playground/components.json` | shadcn config (new) |
| `apps/playground/src/app.css` | Tailwind import + theme tokens (new) |
| `apps/playground/src/main.ts` | +`app.css` import |
| `apps/playground/src/App.svelte` | Shell → shadcn Tabs + Card + Slider |
| `apps/playground/src/PromptStudio.svelte` | Full migration |
| `apps/playground/src/KineticText.svelte` | Button migration |
| `apps/playground/src/lib/components/ui/*` | Generated shadcn components |
| `apps/playground/src/lib/utils.ts` | `cn()` helper |
| `apps/playground/src/lib/prompt-bus.svelte.ts` | Cross-tab prompt bus |

## Open items

- Response Map toolbar controls could be tightened further (the API-key
  field + mode select look fine, but the circle-canvas chrome is
  inconsistent with the rest of the tabs).
- `lucide-svelte` vs `@lucide/svelte` — both are installed; settle on one
  so we don't ship duplicate icon code.
- No visual regression tests exist. A screenshot-diff pass across tabs
  before the next big refactor would be worthwhile.
