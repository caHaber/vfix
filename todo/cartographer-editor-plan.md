# Cartographer → Spatial Prompt Editor

**Pivot:** The cartographer is no longer just a viewer for LLM responses. It's a **spatial editor** where the user prunes and restructures an annotated response into a better prompt. The edited map serializes back to text, feeding the next turn.

**Scope:** everything below stays inside `packages/cartographer/` + `apps/playground/src/ResponseMap.svelte`. No new packages, no framework adapters.

**What's already in place (don't rebuild):**
- Anthropic annotator → structured blocks
- Session with annotation caching
- Pure-TS decision-mode layout
- **WASM force-directed exploration layout** (`force_step` + `clamp_to_bounds` in `@vfir/wasm`, called from [layout-engine.ts:142](packages/cartographer/src/layout-engine.ts:142))
- Svelte canvas rendering with per-block Interpolator animation

---

## Phase 1 — Larger context

Today the annotator takes one string. The editor use case needs multi-turn conversations and longer inputs.

**1.1 Multi-turn input shape**
- Change `Session.map(responseText, opts)` → `Session.map(input, opts)` where `input: string | ConversationInput`.
- `ConversationInput = { turns: { role: 'user' | 'assistant', content: string }[] }`.
- Annotator prompt gets updated to preserve turn provenance; `ContentBlock` gains `turnIndex?: number` and `role?: 'user' | 'assistant'`.
- Assistant turns get fully annotated; user turns get one synthetic `question`-type block each (don't run the expensive annotator on user turns).

**1.2 Handle long inputs**
- Current limit: one annotator call → one LLM request → single context window. Once input passes ~30k tokens the call will fail or return garbage.
- Chunk by turn: annotate each assistant turn independently, merge results with unique `id`s (prefix by turn index: `t2-b3`).
- Cache per-turn annotation in `Session` — editing one turn doesn't re-annotate the others.

**1.3 Visual provenance**
- Add a thin left-edge color stripe per block: blue for user-turn, neutral for assistant-turn. Lets the user see where content came from in the conversation.

✅ Done when: paste a 4-turn Claude conversation, see blocks tagged by turn, no duplicate IDs, resize doesn't re-call the annotator.

---

## Phase 2 — Group IDs (prerequisite for section delete)

The `groupId` field already exists in [types.ts:27](packages/cartographer/src/types.ts:27) but the annotator doesn't populate it. Users can't delete "sections" until it does.

**2.1 Annotator prompt update**
- Ask the model to cluster related blocks into groups with stable `groupId`s (e.g. `g-tradeoffs`, `g-migration-steps`).
- Every block gets a `groupId` — singletons get their own unique group.
- Groups become the unit of "delete this section."

**2.2 Group-level metadata**
- New `ResponseStructure.groups: { id, label, summary }[]` — the model emits a one-line label per group.
- Renderer shows a soft bounding outline + floating label when hovering any block in a group.

✅ Done when: annotating the Postgres/DynamoDB sample produces 3–5 named groups, each with 2+ blocks, rendered with a shared outline on hover.

---

## Phase 3 — Edit primitives on the canvas

The canvas already positions blocks absolutely. Selection + delete is ~a day of work.

**3.1 Selection state**
- `ResponseMap.svelte` local state: `selectedIds: Set<string>`, `hiddenIds: Set<string>`.
- Click a block → select (replace). Shift-click → toggle in selection. Click empty canvas → clear.
- Keyboard: `Delete` / `Backspace` → add selection to `hiddenIds`. `Cmd+Z` → pop last hide off a stack.

**3.2 Group delete**
- Hover a group → group outline highlights, small × button appears on the label.
- Click × → add all group members to `hiddenIds`.
- Shift-click any block in the group to select the whole group.

**3.3 Rendering hidden blocks**
- Hidden blocks are *not removed from the layout* — they fade to `opacity: 0.08`, get a dashed outline, and become non-interactive. This keeps the layout stable during editing (no re-flow churn).
- A separate "Apply deletions" button commits: strips hidden blocks from `structure.blocks`, re-runs layout (re-runs wasm force_step in exploration mode with fewer blocks, which is fast — the expensive call was the annotator).
- Until apply, deletion is fully reversible with undo.

**3.4 Per-block controls on hover**
- Small floating toolbar: delete, pin (exclude from force sim + lock position), collapse (show only first line).
- Pinned blocks get `importance: 1` + frozen `(x, y)` passed into the wasm sim so they stay put while others re-arrange.

✅ Done when: click to select, shift-click multi-select, delete key hides, undo restores, group × button hides whole group, apply button re-layouts with just the kept blocks.

---

## Phase 4 — Export as prompt

This is what makes the editing *worth doing*.

**4.1 Serialization**
- New function `serializeToPrompt(blocks: ContentBlock[], groups: Group[], opts?): string`.
- Reading order: sort by `(turnIndex ?? 0, y, x)`. Tie-break by `id`. (We need a stable original ordering too — add `ContentBlock.order: number` from the annotator.)
- Output: plain markdown. Groups become `## {group.label}` headers. Code blocks preserve their language fence. Context blocks render as blockquotes.

**4.2 Export actions in the toolbar**
- "Copy as prompt" button → serializes kept blocks to clipboard.
- "Send to Prompt Studio" button → cross-tab pass via `localStorage`, switch tab, paste into textarea (playground already has both tabs in the same Svelte app — just set the Prompt Studio `text` state).
- Toggle "Preview prompt" → split-pane side view with the serialized text, live-updating as user deletes.

✅ Done when: delete half the blocks on the Postgres sample, click "Send to Prompt Studio," land on a refined prompt in Prompt Studio's analyze view.

---

## Phase 5 — Prompt diff (the v2 payoff)

Once editing produces a prompt, comparing two edited versions matters. This replaces the original plan's "revision diff."

**5.1 Snapshot state**
- Button: "Save as v1." Stores `{ structure, hiddenIds, pinnedIds, timestamp }` in localStorage.
- Button: "Compare to v1." Renders both layouts side by side. Blocks in both = faded neutral; only-in-current = green; only-in-v1 = red.

**5.2 Reuse Prompt Studio's diff**
- For the *serialized* prompt comparison, link to Prompt Studio's existing `tokenDiff` view — don't reimplement.

✅ Done when: save v1, delete some blocks, click compare, see a visual + token-level diff.

---

## What's explicitly dropped from the original plan

- **WASM migration for decision mode** — the exploration mode already uses wasm; decision mode is deterministic and doesn't benefit.
- **Tutorial / comparison / code-first modes** — not needed for the editor use case; exploration + decision cover it.
- **React adapter** — single-surface use case; only Svelte matters.
- **Click-to-copy code blocks, zoom slider, flatten toggle, search** — either replaced by the editor flow or not worth the complexity.
- **Relationship lines (caveat → recommendation)** — revisit after Phase 4 if users struggle to decide what to keep.

---

## Phase ordering rationale

Phases 1 → 2 are prerequisite data work; skipping them breaks the edit UX (can't delete sections without groupIds; can't edit a conversation without turns). Phase 3 is the interactive heart. Phase 4 is what makes the whole thing useful beyond "neat viewer." Phase 5 is optional polish.

**Minimum viable editor: Phases 2, 3, 4.** (Multi-turn from Phase 1 is additive — single-turn editing still works without it.)

---

## Open questions

- **Pin semantics with wasm:** pinning a block means forcing `vx = vy = 0` inside `force_step`. The wasm API doesn't currently accept a "fixed" mask. Options: (a) add a `fixed: Uint8Array` param to the wasm function (requires rebuild), or (b) post-process in JS by zeroing velocity for pinned blocks each iteration. Start with (b); migrate to (a) if iteration count needs to drop.
- **Annotation cost for long conversations:** per-turn annotation means N LLM calls for N assistant turns. At $3/M input tokens that's still cheap (~$0.01 per turn), but latency stacks. Parallelize the N calls.
- **What happens to block IDs across annotations:** if the user edits an assistant turn and re-annotates, block IDs change. Need to either (a) key the edit state by group label + text hash, or (b) accept that re-annotation resets the edit state. Start with (b).
