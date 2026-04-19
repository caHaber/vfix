# Prompt Studio — Core Package + Playground Page

**Date:** 2026-04-18
**Status:** Complete

## Summary

Added `@prompt-studio/core` package and a "Prompt Studio" tab to the playground. Client-side prompt analysis with live tokenization, cost estimation, and token-level diffing.

## What was done

### Package: `@prompt-studio/core` (`packages/prompt-studio/`)

- **TokenizerRegistry** (`tokenizer-registry.ts`): Pluggable tokenizer system with lazy loading. Ships with `cl100k_base` and `o200k_base` via `js-tiktoken`. Architecture ready for WASM replacement.
- **Analyzer** (`analyzer.ts`): Tokenizes text, computes token count, cost estimation (per-model pricing), context window usage, section detection (markdown headers, XML tags), token density.
- **DiffEngine** (`diff.ts`): Myers diff algorithm on token ID arrays. Produces equal/insert/delete ops with token-level granularity. Cost delta calculation. Falls back to simpler diff for inputs >20K tokens.
- **Pricing** (`pricing.ts`): Hardcoded model pricing (per 1M tokens) for GPT-4o, GPT-4o-mini, GPT-4-turbo, GPT-3.5-turbo, Claude Opus/Sonnet/Haiku.
- **Types** (`types.ts`): Token, Analysis, TokenDiff, DiffOp, ModelPricing, TokenizerID, etc.

### Playground Page: "Prompt Studio" tab

- **Analyze view**: Textarea editor with live stats panel — token count, character count, density, estimated input/output cost, context window usage bar, section breakdown, warnings (context window exceeded/near, high density). Toggleable token boundary visualization with color-coded overlays.
- **Diff view**: Side-by-side before/after text editors with token-level diff rendering below. Green for insertions, red with strikethrough for deletions. Shows token delta and cost delta per call.
- Model and tokenizer selectors that stay in sync (changing model updates tokenizer and vice versa).

## Key decisions

- **JS-only tokenization** (no WASM): `js-tiktoken` handles BPE encoding. Sufficient for typical prompt sizes. WASM would matter for 100K+ token inputs at 60fps.
- **Single package**: Kept everything in `@prompt-studio/core` rather than splitting into many packages per the spec. Can split later if needed.

## Key files

| File | Purpose |
|------|---------|
| `packages/prompt-studio/src/tokenizer-registry.ts` | Pluggable tokenizer loading |
| `packages/prompt-studio/src/analyzer.ts` | Tokenization + analysis pipeline |
| `packages/prompt-studio/src/diff.ts` | Myers diff on token arrays |
| `packages/prompt-studio/src/pricing.ts` | Model pricing data |
| `apps/playground/src/PromptStudio.svelte` | Playground UI component |

## Open items

- WASM tokenizer modules (Rust BPE encoder for perf on large inputs)
- WASM diff engine
- Framework adapters (React, vanilla) — only Svelte playground exists now
- File parsing (PDF, markdown ingestion)
- Worker mode for large inputs
