# Transcript → Prompt Studio — Plan

## Flow

User records a long video (brainstorm, voice memo, interview). Pastes the
transcript. Sees it laid out as a circle-cloud of ideas. Edits down to a
polished prompt by:

1. **Resizing** — bigger = more important; smaller = background
2. **Deleting** — individual ideas or entire off-topic groups
3. **Copying** — final prompt text to clipboard (or send to Prompt Studio)

Output is a clean prompt the user can paste into any model.

---

## Progress so far (as of 2026-04-23)

The cartographer substrate needed for this flow is built and working on the
Response Map tab. Everything below already exists in
[packages/cartographer](packages/cartographer) and
[apps/playground/src/ResponseMap.svelte](apps/playground/src/ResponseMap.svelte):

- **Circle-cloud rendering** — blocks render as circles sized to the text via
  pretext line-breaking + tight ink-height computation. Text fits snugly
  (diameter = `hypot(inkW, inkH) + 10px`, zero CSS padding).
- **Streaming force sim** — Rust/WASM AABB repulsion + centering + per-group
  centroid attraction + inter-group inverse-square push. Tuned soft
  (REPULSION 500, DAMPING 0.92, DT 0.8) so circles can touch without bouncing.
- **Settle behavior** — per-block velocity snap at 0.1 plus RMS freeze
  threshold at 0.15. Sim actually stops moving after ~1–2s of settling.
- **Smooth rendering** — physics target `(x,y)` decoupled from rendered
  `(rx,ry)` via lerp (SMOOTH_ALPHA 0.14). No visual jitter while solving.
- **Infinite canvas with pan/zoom** — CSS-transform viewport layer, wheel zoom
  around cursor, drag-to-pan with 3px threshold, reset view button.
- **Per-block resize** — `scaleBlock(id, factor)` clamped to [0.4, 4]; `+`/`-`
  keys while a block is selected. Recomputes baseDiam × scale, unfreezes the
  sim so neighbors make room.
- **Add/remove with growable buffers** — `ensureCapacity` + 1.5× growth,
  O(1) swap-remove. Safe to stream in blocks and delete mid-flight.
- **Grouping** — blocks sharing a `groupId` attract toward their centroid;
  distinct groups repel. Visually produces labeled clusters.

What this means for the video→prompt flow: **the entire canvas UI is already
done**. Phase 1 is a new annotator prompt, a new serializer, a copy of the
Svelte host component, and a tab wire-up. No new physics, no new measurer,
no new rendering work.

---

## Why this is a separate flow (not just Response Map)

Response Map decomposes **LLM output** into recommendation/alternatives/caveats.
A transcript is the opposite shape: raw speaker thought, rambling, self-
interrupting, full of filler, no markdown. The annotation prompt and the
serializer both need different logic:

| Dimension          | Response Map                       | Transcript Studio                    |
| ------------------ | ---------------------------------- | ------------------------------------ |
| Input              | Structured LLM response            | Unstructured spoken-word transcript  |
| Block types        | recommendation, alternative, pro…  | idea, example, aside, filler         |
| Grouping           | Semantic clusters the LLM implied  | Topics the speaker actually covered  |
| Importance signal  | LLM-assigned from rhetorical role  | Speaker emphasis + user scaling      |
| Serialization goal | Preserve the LLM's argument        | Distill into a *new* prompt          |

The UI (circles, pan/zoom, delete, scale) is identical — the plumbing differs.

---

## Architecture — reuse the cartographer package

Everything cartographer already does applies:

- `Annotator` streams NDJSON block events from the model
- `Measurer` + WASM force sim gives the circle cloud
- `StreamingLayout` handles add/remove/scale with smooth settle
- `serializeToPrompt` walks groups and emits ordered text

What's new is **one new system prompt** and **one new serializer** — both live
alongside the existing ones. No new sim, no new rendering, no new measurer.

### New files

```
packages/cartographer/src/
  transcript-annotator.ts     # TranscriptAnnotator — same stream(), different SYSTEM_PROMPT
  transcript-serialize.ts     # serializeTranscriptToPrompt()
apps/playground/src/
  TranscriptStudio.svelte     # mostly copy-paste of ResponseMap.svelte, different header + wiring
```

### Changes to existing files

- `apps/playground/src/App.svelte` — add "Transcript Studio" tab
- `packages/cartographer/src/index.ts` — export the new annotator + serializer

---

## Annotator prompt (transcript-specific)

Block types geared to spoken word:

```
idea        — a discrete point the speaker is making
example     — specific instance supporting an idea
question    — something the speaker asks or wonders
aside       — tangent or self-correction, low importance by default
filler      — throat-clearing, repetition, verbal hedges (skip entirely)
action      — a TODO or commitment the speaker states
```

Rules the new system prompt must enforce:

- Collapse filler — do NOT emit filler blocks. The user can't scale what's
  not there; dropping filler pre-annotation keeps the canvas clean.
- `block.text` should be a **lightly de-rambled paraphrase**, not verbatim.
  Transcripts contain "so, uh, I think maybe we should, you know, do X" —
  render as "We should do X". This is the biggest departure from Response
  Map, which mandates verbatim.
- Group by topic the speaker moved through, not by rhetorical role.
- Importance reflects **speaker emphasis** (repetition, pause-then-state,
  "the key thing is…") — user will adjust from there.

## Serializer (transcript-specific)

The Response Map serializer mirrors the structure back out as markdown
sections. The transcript serializer should produce a **prompt**, not an
outline. Importance + grouping drive the shape:

1. Sort groups by average member importance × average member scale.
2. For each surviving group, emit one paragraph:
   - Lead with the highest-importance block as the topic sentence.
   - Fold lower-importance blocks in as supporting clauses, sorted by
     in-group position (y then x) so the natural reading order is preserved.
3. Questions become imperative asks at the end: "Explain …", "Help me decide …".
4. Actions become a bulleted "Please address:" list if any remain.

No headers, no blockquotes — just a prompt a person would paste into a chat.

**Stretch (Phase 2): LLM-rewrite pass.** Instead of templating, send the
surviving blocks (with importance + scale values) to Haiku with a "rewrite
these ideas as a single coherent prompt, weighting importance as instructed"
system prompt. Produces much better output but adds latency + cost. Ship the
deterministic version first; gate the LLM rewrite behind a toggle.

---

## UI — what differs from Response Map

Mostly identical. The few deltas:

- **Header copy** — "Paste a transcript. Resize what matters, delete what
  doesn't. Copy the prompt." not "Map an LLM response".
- **Sample content** — a real rambling voice-memo transcript, not a
  decision-analysis response.
- **Importance legend** — small key in the corner mapping circle size →
  "more central to the prompt" so users understand what scaling does.
- **"Rewrite with AI" button** (Phase 2) alongside "Copy as prompt".

No new interactions. `+`/`-` to resize selected, `Delete`/`Backspace` to
remove, click empty space to deselect, drag to pan, wheel to zoom — all
already there.

---

## Phases

### Phase 1 — Ship the base flow (≤1 day)

1. `TranscriptAnnotator` — new file, copy `Annotator`, swap `SYSTEM_PROMPT`.
2. `serializeTranscriptToPrompt` — importance-ordered paragraph-per-group.
3. `TranscriptStudio.svelte` — copy `ResponseMap.svelte`, wire new annotator
   + serializer, new sample, new header copy.
4. Tab in `App.svelte`.

**Done when**: paste transcript → circles appear → resize + delete work →
copy produces a readable prompt.

### Phase 2 — LLM rewrite (optional, ≤half-day)

1. Add `rewriteAsPrompt()` in the new serialize module — calls Haiku with
   surviving blocks + importance weights.
2. Button in the toolbar. Async state, spinner, error path.

**Done when**: "Rewrite with AI" produces materially better prompts than the
deterministic serializer on a rambling test transcript.

### Phase 3 — Transcript ingest UX (optional)

Currently the user pastes text. If there's demand:

- Drop a `.vtt` / `.srt` / `.txt` file onto the textarea to parse timestamps.
- If timestamps exist, show them in block tooltips — useful for locating
  context back in the original recording, but don't put them in the prompt.
- **Not in scope**: recording audio/video in-app, running STT. User brings
  their own transcript.

---

## Non-goals

- Recording or transcription inside the app.
- Real-time streaming transcript (the user pastes a finished transcript).
- Multi-speaker attribution (out of scope; transcripts can contain speaker
  labels and the annotator can treat them as metadata, but no speaker UI).
- Preserving exact verbatim wording — this is a prompt-extraction tool, not
  a transcription editor. If verbatim matters, Response Map is the wrong
  model too; suggest a separate "Transcript Cleaner" tool later.

---

## Open questions to resolve before Phase 1

1. **De-ramble aggressiveness** — how much paraphrasing is too much? Start
   conservative ("light de-ramble: keep the speaker's phrasing, drop filler
   and false starts") and tune from real transcripts.
2. **Minimum block length** — one-word fragments are noise. Probably enforce
   `text.length >= 12` in the annotator prompt.
3. **Default importance distribution** — if the annotator paints everything
   ~0.5, the cloud is visually flat and the user has no starting signal.
   The prompt should push the model to use the full 0.1–1.0 range.

---

## Todos — the video-to-prompt journey

Concrete next work, ordered by where a user hits friction going from
"I just finished recording" → "I have a prompt I trust". Each item lists
what, why, and rough cost.

### 1. Ship Phase 1 end-to-end (core loop) — HIGH

The flow doesn't exist until someone can paste a transcript and get a prompt.

- [ ] **`TranscriptAnnotator`** in `packages/cartographer/src/transcript-annotator.ts`.
      Copy `Annotator`, swap `SYSTEM_PROMPT` to the transcript version
      (idea/example/question/aside/action block types; light de-ramble; drop
      filler; emphasis → importance; topic-based groups).
- [ ] **`serializeTranscriptToPrompt()`** in `packages/cartographer/src/transcript-serialize.ts`.
      Sort groups by `avg(importance × scale)`, emit one paragraph per
      surviving group with the highest-importance block as topic sentence.
      Questions → imperative asks at end. Actions → bullet list.
- [ ] **`TranscriptStudio.svelte`** — copy `ResponseMap.svelte`, swap annotator
      + serializer, replace sample text with a real rambling voice memo,
      update header copy.
- [ ] **Tab in `App.svelte`** — add "Transcript Studio" alongside Response Map.
- [ ] **Verify Delete/Backspace wiring** — summary says `+`/`-` is wired; need
      to confirm Delete/Backspace on selected block actually removes it and
      neighbors resettle. If not, add it (calls `streamingLayout.removeBlock`).
- [ ] **Copy-to-clipboard action** — "Copy as prompt" button runs
      `serializeTranscriptToPrompt` on current surviving state and writes to
      clipboard. Toast on success.

**Done when**: paste a 500+ word rambling transcript, edit via resize/delete,
copy, paste into chat — result reads like a prompt a person wrote.

### 2. Make importance legible — MEDIUM

Right now a user sees circles but doesn't know what "bigger" means in prompt
terms. Without a mental model the resize loop feels arbitrary.

- [ ] **Importance legend in corner** — small key: "Larger circle = more
      prominent in your prompt. Resize with +/−."
- [ ] **Selected-block footer** — when a block is selected, show its current
      scale × importance and its position in the output ("paragraph 2,
      clause 3") so users see how their edits reshape the prompt.
- [ ] **Live prompt preview pane** — collapsible side panel that re-runs the
      serializer on every edit. Debounced 150ms. Makes the cause → effect
      loop immediate.

### 3. Multi-speaker + timestamps — MEDIUM

Real recordings have speaker labels and timestamps. Dropping them loses
signal the user would want back.

- [ ] **Speaker-aware annotator prompt** — if transcript has `Speaker A:`
      prefixes or WebVTT `<v Name>`, pass them through and let the user
      filter by speaker. Store as `block.speaker?` metadata.
- [ ] **Speaker filter chip row** — click chip to dim that speaker's blocks.
      Useful for "distill my half of the conversation into a prompt".
- [ ] **Timestamp tooltip** — hover a block → shows `00:12:34` linking back
      to the source time. Out of the prompt output, but keeps the user
      anchored to the recording.
- [ ] **VTT/SRT drop target** — drag a subtitle file onto the textarea; parse
      cues into pre-annotated blocks so the LLM only has to classify, not
      segment. Big latency win on long recordings.

### 4. LLM rewrite pass (Phase 2) — MEDIUM

Template-serializer output is functional but stiff. Real prompts benefit from
a smoothing pass.

- [ ] **`rewriteAsPrompt()`** — call Haiku with surviving blocks + importance
      weights + "rewrite these ideas as a single coherent prompt, weighting
      importance as instructed".
- [ ] **"Rewrite with AI" toolbar button** — async state, spinner, error
      path. Preserves the deterministic output as a fallback.
- [ ] **Diff view** — show template-output vs LLM-output side-by-side so the
      user can pick which they trust this time. Builds intuition for when
      the rewrite helps.

### 5. Prompt-shape presets — MEDIUM

"Turn this rambling brainstorm into a [PRD | bug report | email | spec]" is
the actual ask most of the time. Right now the serializer always emits the
same shape.

- [ ] **Template picker** — dropdown with PRD, one-pager, bug report,
      standup update, interview summary, email. Each template is a different
      system prompt for the rewrite pass + different paragraph template for
      the deterministic serializer.
- [ ] **Custom template slot** — user saves their own "rewrite as…" prompt.
      Persists in localStorage.

### 6. Session persistence — LOW-MEDIUM

User spends 5 minutes editing a cloud and tab-crashes. Losing that state
erodes trust in the tool.

- [ ] **Autosave canvas state** — serialize `{blocks, groups, scales,
      deletedIds, panX, panY, zoom}` to localStorage on every edit,
      debounced. Restore on reload.
- [ ] **Named sessions** — sidebar list of saved clouds, rename, delete.
- [ ] **Export as JSON** — download canvas state; re-import later.

### 7. Undo/redo — LOW-MEDIUM

Delete-by-accident is inevitable on a dense cloud.

- [ ] **Undo stack for add/remove/scale** — Cmd+Z / Cmd+Shift+Z.
      StreamingLayout already knows how to add/remove/scale; stack is just
      recording of those ops.
- [ ] **Trash tray** — deleted blocks collect in a dimmed side tray, clickable
      to restore. Visible recovery beats opaque undo.

### 8. Recording inside the app — LOW (explicit non-goal in Phase 1-3)

Flagged here because it's the first thing users will ask for once the paste
flow works. Deferred, not forgotten.

- [ ] **MediaRecorder capture** — record mic (+ optional tab audio via
      getDisplayMedia) in browser, store the blob.
- [ ] **Browser STT** — whisper-wasm or cloud API. Big model-size question;
      probably cloud.
- [ ] **Live transcript streaming** — blocks appear on the canvas as the user
      is still talking. Pretty demo; genuinely useful for "dump a thought and
      immediately edit it down". Biggest UX win of anything in this list but
      also the most scope.

### 9. Group-level operations — LOW

Per-block edits work. Group-level is faster for big surgeries.

- [ ] **Click a group label → select all members**. Then +/−/Delete acts on
      the whole group.
- [ ] **Drag group label to reorder output** — manual override of
      importance-based ordering in the serializer.
- [ ] **Merge groups** — drag one label onto another.
- [ ] **Rename groups inline** — click label, edit, commit.

### 10. Before/after view — LOW

Users want proof the tool actually distilled something. A toggle showing
"here's what you started with, here's what you're shipping" makes the value
obvious.

- [ ] **Split view** — left pane: original transcript with dimmed lines for
      filtered/filler content, struck-through for deleted blocks. Right
      pane: live prompt output. Shows the compression ratio.
