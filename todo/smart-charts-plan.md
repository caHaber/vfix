# Smart Charts — Project Plan

A WASM-powered chart package for the **vfir** monorepo with built-in statistical intelligence and LLM-driven enhancements. Built on a custom Rust/WASM stats module for analysis the user's runtime can't express cheaply, an LLM layer that turns statistical insights into smart annotations and chart-type selection, and **Layercake** (https://layercake.graphics) as the Svelte-native rendering substrate.

This plan slots smart-charts in alongside the existing `@vfir/*` and `@prompt-studio/*` packages. It reuses repo conventions (pnpm workspaces, tsup for libs, wasm-pack for Rust, Svelte 5 runes, Biome, Vitest) and lands a tab in `apps/playground` so the feature is exercised end-to-end.

---

## 1. Core Idea

Most chart libraries draw pixels. This one **thinks about the data first**.

```
Raw data → wasm-stats → statistical profile → LLM enhancement → Layercake chart
```

The killer feature: a `question` prop. Pass data and a question in natural language, get back a Layercake chart that actually answers the question — with relevant annotations, the right chart type, and a caption explaining what it shows.

```svelte
<SmartChart data={salesData} question="what drove Q3 growth?" />
```

---

## 2. Goals & Non-goals

**v1.0 goals:**

- New `@vfir/smart-charts` Svelte package, plus a new `@vfir/wasm-stats` Rust/WASM crate
- Custom Rust/WASM statistical module for regression, outliers, change points, correlation, seasonality, clustering, simple group-by aggregation
- Lightweight **text aggregations** in the same crate: tokenization, keyword extraction (TF / TF-IDF / RAKE-lite), and lexicon-based sentiment (AFINN-style) — enough to surface key terms and a sentiment score for any text-bearing column without shipping an ML model
- LLM enhancement pipeline that turns stats into chart specs, annotations, and captions
- **Layercake** as the renderer — we compose Layercake's `<LayerCake>` + `<Svg>`/`<Canvas>` layers + a small set of chart-type components (Line, Bar, Scatter, Area, Histogram, Heatmap)
- Privacy-first: raw data never leaves the browser; the LLM only sees aggregated statistical profiles
- A "Smart Charts" tab in `apps/playground`

**Non-goals:**

- DuckDB-WASM or any SQL engine — out of scope for v1; wasm-stats handles aggregation directly on typed arrays
- React adapter — Layercake is Svelte-only and the playground is Svelte; revisit post-v1 with a web-component wrapper if needed
- LLM inference in the browser — user brings their own API key (OpenAI / Anthropic / OpenAI-compatible)
- Being a "dashboard platform" — this is a library, not a SaaS

---

## 3. Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                  @vfir/smart-charts (Svelte 5)                │
│                                                               │
│   <SmartChart data={data} question="..." />                  │
│   <SmartDashboard datasets={[...]} question="..." />         │
└──────────────────────┬───────────────────────────────────────┘
                       │
┌──────────────────────▼───────────────────────────────────────┐
│                 @vfir/smart-charts/core (TS)                  │
│                                                               │
│   Session → DataAdapter → StatsEngine → Enhancer → Renderer  │
└──────┬─────────────────┬─────────────────┬─────────────┬─────┘
       │                 │                 │             │
       ▼                 ▼                 ▼             ▼
  ┌─────────┐     ┌─────────────┐     ┌────────┐   ┌──────────┐
  │ JS data │     │ @vfir/      │     │  LLM   │   │layercake │
  │ adapter │     │ wasm-stats  │     │  API   │   │renderer  │
  │         │     │ (Rust/WASM) │     │ (BYOK) │   │(Svelte)  │
  │ array → │     │             │     │        │   │          │
  │ Float64 │     │ regression, │     │        │   │ Svg /    │
  │ + col   │     │ outliers,   │     │        │   │ Canvas   │
  │ schema  │     │ time series,│     │        │   │ layers + │
  │ infer   │     │ correlation,│     │        │   │ chart    │
  │         │     │ change pts, │     │        │   │ comps    │
  │ (incl.  │     │ clustering, │     │        │   │          │
  │ text    │     │ groupby agg,│     │        │   │          │
  │ cols)   │     │ text: tfidf │     │        │   │          │
  │         │     │ + sentiment │     │        │   │          │
  └─────────┘     └─────────────┘     └────────┘   └──────────┘
```

### Data flow (single chart)

1. User passes data (typed `Row[]`, JSON array, or `Float64Array` columns) and an optional `question`
2. `DataAdapter` infers a column schema and converts rows → column-major `Float64Array`s + categorical lookup tables
3. `StatsEngine` calls `@vfir/wasm-stats` for descriptive stats, correlation, time-series analysis, anomaly detection, clusters, group-by aggregations, and — for any column flagged as **text** — keyword extraction and sentiment scoring
4. `ProfileBuilder` produces a compact **statistical profile** (~500 tokens, no raw data)
5. `Enhancer` sends profile + question to the user's LLM, gets back a structured **enhancement spec**
6. `Renderer` picks the right Layercake composition and feeds it the spec + the original (or aggregated) data

### Why Layercake

- Svelte-native — drops into the existing playground with no impedance mismatch
- Layered SVG/Canvas/HTML/WebGL with a **shared scale + coordinate system** — exactly what we need to draw chart + annotations + interactive HUD on top of one another
- Scales, axes, and bounding logic are already solved
- Permissive license, well-documented examples per chart type — we don't have to redo Line/Bar/Scatter primitives
- Lets us focus on the *intelligence* layer (stats + LLM + spec → composition), not redrawing pixels

---

## 4. Package Structure (in this repo)

```
packages/
├── core/                  # @vfir/core — existing (unchanged)
├── wasm/                  # @vfir/wasm — existing font + cartographer math (unchanged)
├── wasm-stats/            # NEW @vfir/wasm-stats — Rust statistical engine
│   ├── src/
│   │   ├── lib.rs         # wasm-bindgen exports
│   │   ├── descriptive.rs # mean/median/std/quantiles/histogram bins
│   │   ├── regression.rs  # linear, polynomial
│   │   ├── outliers.rs    # zscore, iqr
│   │   ├── timeseries.rs  # trend, seasonality, change points
│   │   ├── correlation.rs # pearson, spearman, full matrix
│   │   ├── clustering.rs  # kmeans
│   │   ├── aggregate.rs   # group-by sum/mean/count/min/max
│   │   └── text.rs        # tokenize, stopwords, tf/tf-idf, RAKE-lite, AFINN sentiment
│   ├── Cargo.toml
│   └── package.json       # wasm-pack build → pkg/
├── smart-charts/          # NEW @vfir/smart-charts — Svelte renderer + components
│   ├── src/
│   │   ├── core/
│   │   │   ├── session.ts
│   │   │   ├── data-adapter.ts
│   │   │   ├── stats-engine.ts
│   │   │   ├── profile-builder.ts
│   │   │   ├── enhancer.ts
│   │   │   ├── llm/         # adapters: openai.ts, anthropic.ts, mock.ts
│   │   │   └── types.ts
│   │   ├── render/
│   │   │   ├── spec-to-layercake.ts # EnhancementSpec → component choice + props
│   │   │   ├── annotations.svelte
│   │   │   ├── trendline.svelte
│   │   │   └── charts/
│   │   │       ├── Line.svelte
│   │   │       ├── Bar.svelte
│   │   │       ├── Scatter.svelte
│   │   │       ├── Area.svelte
│   │   │       ├── Histogram.svelte
│   │   │       ├── Heatmap.svelte
│   │   │       ├── WordCloud.svelte    # top keywords sized by TF-IDF score
│   │   │       └── SentimentBar.svelte # diverging bar of sentiment by group
│   │   ├── lib/
│   │   │   ├── SmartChart.svelte
│   │   │   └── SmartDashboard.svelte
│   │   └── index.ts
│   ├── package.json       # peerDeps: layercake, svelte; deps: @vfir/wasm-stats
│   └── tsconfig.json
├── svelte/                # existing
├── vanilla/               # existing
├── prompt-studio/         # existing
└── cartographer/          # existing
apps/
└── playground/            # existing — gets a new "Smart Charts" tab
```

### WASM strategy: separate `@vfir/wasm-stats` crate

We considered extending the existing `@vfir/wasm` crate with stats modules. **Going with a separate crate instead.** Reasons:

- Different concern (statistics) than the existing crate (font/layout/cartographer math) — no shared code to reuse
- Different consumers — playground font tabs shouldn't pay for stats bytes; smart-charts shouldn't pay for `compute_layout`/`force_step`
- Build pipeline scales trivially: another `wasm-pack build` target, another `pnpm --filter` line in the root `package.json`
- Lazy-load policy stays clean — each tab loads only what it needs
- Mirrors the way `@vfir/wasm` is already structured, so contributors don't have to learn a new pattern

Net cost: one extra Cargo crate and one extra `package.json`. Net benefit: bundles stay small and focused.

### Dependencies to install

None of these are in the repo today — all need to be added in this work:

| Package | Where | Why |
|---|---|---|
| `layercake` | `packages/smart-charts` (peerDep) + `apps/playground` (dep) | renderer |
| `d3-scale`, `d3-shape` | `packages/smart-charts` | Layercake examples lean on these for scales/curves |
| `wasm-stats` Rust deps: `nalgebra`, `serde`, `serde-wasm-bindgen`, `wasm-bindgen`, `phf` | `packages/wasm-stats/Cargo.toml` | linear algebra + bindings + compile-time AFINN map |

LLM provider SDKs are **not** added as deps — `Enhancer` uses `fetch` directly against a configurable endpoint, so the package stays SDK-agnostic and zero-dep on that side. The playground tab can use the same env-var pattern as the Cartographer tab for an API key.

---

## 5. Key Interfaces

### Statistical profile (what the LLM sees — never raw data)

```typescript
interface StatisticalProfile {
  shape: { rows: number; columns: number };
  columns: Record<string, ColumnProfile>;
  correlations: Correlation[];
  timeseries?: TimeseriesInsights;  // if a temporal column was detected
  anomalies: Anomaly[];
  clusters?: ClusterInsight;
  // small set of group-by aggregates the heuristics chose to surface:
  aggregates?: AggregateInsight[];
  // per-text-column keyword + sentiment summary, only when text columns exist:
  text?: Record<string, TextInsights>;
}

interface ColumnProfile {
  type: 'numeric' | 'categorical' | 'temporal' | 'boolean' | 'text';
  cardinality: number;
  summary: { mean?: number; median?: number; std?: number; min?: number; max?: number; mode?: string };
  distribution?: 'normal' | 'skewed' | 'bimodal' | 'uniform';
  histogramBins?: { edges: number[]; counts: number[] };
  // populated when type === 'text':
  text?: { avgTokens: number; uniqueTokens: number; sampleSize: number };
}

interface TextInsights {
  topKeywords: { term: string; score: number; count: number }[];   // top 20 by TF-IDF
  topBigrams?: { term: string; score: number }[];                  // top 10 by RAKE-lite
  sentiment: {
    mean: number;        // -1..+1 (AFINN normalized)
    positiveRatio: number;
    negativeRatio: number;
    neutralRatio: number;
    distribution: { bins: number[]; counts: number[] }; // histogram of per-row scores
  };
  // optional cross with a category/temporal column the heuristics picked:
  byGroup?: { groupColumn: string; rows: { group: string; sentiment: number; topKeyword: string }[] };
}
```

### Enhancement spec (what the LLM returns)

```typescript
interface EnhancementSpec {
  chartType: 'line' | 'bar' | 'scatter' | 'area' | 'histogram' | 'heatmap' | 'wordCloud' | 'sentimentBar';
  encoding: { x: string; y: string; color?: string; size?: string };
  scales: { yScale?: 'linear' | 'log'; yDomain?: [number, number] };
  annotations: Annotation[];
  emphasis: { rows: number[]; reason: string };
  caption: string;
  followUpQuestions: string[];
}

type Annotation =
  | { type: 'callout'; target: RowRef; text: string }
  | { type: 'trendline'; method: 'linear' | 'polynomial'; label: string }
  | { type: 'region'; from: number; to: number; label: string }
  | { type: 'threshold'; value: number; label: string };
```

### Public API

```typescript
// Programmatic
import { createChart } from '@vfir/smart-charts';
const chart = createChart({ data, llm: { provider: 'openai', model: 'gpt-4o-mini', apiKey } });
const spec = await chart.enhance({ question: 'what drove Q3 growth?' });
const stats = await chart.analyze();  // stats only, no LLM

// Svelte (the only adapter for v1)
<SmartChart {data} question="compare regions" llm={llmConfig} />
<SmartDashboard {datasets} question="where is profit highest?" {llm} />
```

---

## 6. The Rust/WASM Stats Module

Focused crate for operations a JS implementation can't run smoothly on 10K+ rows:

```rust
// descriptive
pub fn summary(column: &[f64]) -> Summary;
pub fn histogram(column: &[f64], bin_count: usize) -> Histogram;

// regression
pub fn linear_regression(x: &[f64], y: &[f64]) -> RegressionResult;
pub fn polynomial_regression(x: &[f64], y: &[f64], degree: u8) -> RegressionResult;

// outliers
pub fn outliers_zscore(column: &[f64], threshold: f64) -> Vec<usize>;
pub fn outliers_iqr(column: &[f64], factor: f64) -> Vec<usize>;

// time series
pub fn detect_trend(values: &[f64]) -> TrendResult;
pub fn detect_seasonality(values: &[f64], max_period: usize) -> SeasonalityResult;
pub fn change_points(values: &[f64], min_confidence: f64) -> Vec<ChangePoint>;

// relationships
pub fn correlation_pearson(a: &[f64], b: &[f64]) -> f64;
pub fn correlation_matrix(columns: &[&[f64]]) -> Vec<Vec<f64>>;
pub fn kmeans(data: &[&[f64]], k: usize, max_iter: usize) -> ClusterResult;

// minimal aggregation (the shape DuckDB would have given us)
pub fn group_by_sum(group_keys: &[u32], values: &[f64], group_count: usize) -> Vec<f64>;
pub fn group_by_mean(group_keys: &[u32], values: &[f64], group_count: usize) -> Vec<f64>;
pub fn group_by_count(group_keys: &[u32], group_count: usize) -> Vec<u32>;

// text — kept deliberately small, no ML model, all data lives in the crate
pub fn tokenize(text: &str) -> Vec<String>;                          // lowercase, strip punct, drop stopwords
pub fn term_frequency(docs: &[&str], top_n: usize) -> Vec<TermScore>; // global TF across the column
pub fn tf_idf(docs: &[&str], top_n: usize) -> Vec<TermScore>;        // top terms by mean TF-IDF
pub fn rake_keywords(docs: &[&str], top_n: usize) -> Vec<TermScore>; // multi-word phrases (RAKE-lite)
pub fn sentiment_score(text: &str) -> f64;                            // AFINN-normalized, -1..+1
pub fn sentiment_batch(docs: &[&str]) -> Vec<f64>;                    // per-doc score, fast path
pub fn sentiment_summary(scores: &[f64], bin_count: usize) -> SentimentSummary;
```

The text path stays intentionally minimal:

- **Tokenizer**: lowercase, strip punctuation, split on whitespace, filter a small built-in English stopword list (~150 words). No stemming, no Unicode segmentation library — bytes through `char` iteration, ASCII-fast-path for the common case.
- **Keywords**: TF-IDF over the column treats each row as a doc. RAKE-lite reuses the stopword list as phrase delimiters and scores phrases by `degree(word) / freq(word)` — Rust port is < 100 lines.
- **Sentiment**: AFINN-165 wordlist (~2.5K terms with -5..+5 scores) embedded as a `phf` map. Per-row score = sum of matched word scores / sqrt(token count), clamped to [-1, +1]. No negation handling beyond a simple "not X" → flip-next-word rule for v1.
- **No external ML**: all data is in-crate, ships in the wasm bundle. Expected payload from this module: ~30KB gzipped (AFINN is the bulk).

Categorical columns are interned to `u32` group keys in `data-adapter.ts` before being handed to wasm — the existing `@vfir/wasm` crate uses the same pattern (typed-array-in, `Vec<f32>`-out), so this is consistent with house style.

**Why WASM and not pure JS:** above ~10K rows these operations are 5–15x faster in WASM. For a 100K-row correlation matrix or change-point detection on a long time series, the difference is "instant" vs. "janky." The existing `@vfir/wasm` `Cargo.toml` (`opt-level = "s"`, `lto = true`) is the template — copy it.

---

## 7. LLM Prompt Strategy

The LLM never sees raw data — only the aggregated `StatisticalProfile`. This means:

- **Privacy**: sensitive row-level data never leaves the browser
- **Token efficiency**: 100K rows becomes a ~500-token profile
- **Better outputs**: LLMs reason better about summaries than raw numbers

```
You are a data visualization expert. Given this statistical profile,
generate an EnhancementSpec as JSON.

Dataset: {shape info}
User question: {question}
Profile: {JSON}

Respond with an EnhancementSpec (schema attached)...
```

`Enhancer` uses structured-output / JSON-mode where supported and validates the response against a hand-rolled type guard (no Zod dep — keep the package light, mirroring how `@prompt-studio/core` stays narrow).

---

## 8. Build and Tooling (matches existing repo)

- pnpm workspaces (existing `pnpm-workspace.yaml` already covers `packages/*`)
- `wasm-pack build --target web --release --out-dir pkg` for `@vfir/wasm-stats` — same script as `@vfir/wasm`
- Root `package.json` gets a `build:wasm-stats` script alongside `build:wasm`
- `tsup src/index.ts --format esm --dts --clean` for `@vfir/smart-charts`
- Vite playground picks up the new package via the same alias trick used for `@vfir/wasm` — `vite.config.ts` falls back to a stub if `pkg/` isn't built yet
- Vitest for `core/` unit tests; Playwright is not added (out of scope; lint via Biome)
- ESM only, tabs, single quotes, semicolons, Svelte 5 runes — per `AGENTS.md`

---

## 9. Playground Integration

Add a fifth tab to `apps/playground/src/App.svelte`: **Smart Charts**.

The tab includes:

1. **Data picker** — four built-in sample datasets:
   - sales time series (line / change-point demo)
   - iris-like multivariate set (clustering / scatter)
   - server metrics with injected anomalies (outliers / threshold annotations)
   - **product reviews** — rows of `{ product, rating, review_text, date }` to exercise the text path (keywords + sentiment by product, sentiment over time)

   Plus a "Paste JSON" textarea. No CSV upload for v1; that's a follow-up.
2. **Question input** — single-line text field, e.g. *"what drove Q3 growth?"*, *"show me anomalies"*, *"are there clusters?"*, *"what are people complaining about?"*, *"which product has the most negative reviews?"*
3. **API key input** — same pattern as Response Map / Cartographer (localStorage-backed; never sent anywhere but the model endpoint)
4. **Output** —
   - the rendered `<SmartChart>` (Layercake)
   - the LLM's caption underneath
   - a collapsible "Profile" panel showing the JSON profile that was sent (privacy demo)
   - follow-up question chips that re-run with a new question

### Wiring

- `apps/playground/package.json` adds `@vfir/smart-charts` (workspace) and `layercake` (real dep — the playground actually renders)
- `apps/playground/vite.config.ts` adds an alias for `@vfir/wasm-stats` mirroring the existing `@vfir/wasm` alias (real `pkg/` if built, stub otherwise — `wasm-stats-stub.ts`)
- New file: `apps/playground/src/SmartCharts.svelte`
- `App.svelte` adds the `<Tabs.Trigger value="smart-charts">` and matching `<Tabs.Content>`; nothing else changes

### Verification (per repo `preview_*` workflow)

After wiring:
- `pnpm dev` → `preview_start`
- exercise each sample dataset + a couple of questions → `preview_snapshot` for content + `preview_console_logs` for errors
- `preview_screenshot` for the final demo

If the wasm-stats pkg isn't built (CI without Rust), the stub returns deterministic synthetic stats so the tab still loads — same pattern `wasm-stub.ts` uses today.

---

## 10. Development Phases

**Phase 1 — Skeleton + wasm-stats foundation (1 week)**
- New crate `packages/wasm-stats` with `summary`, `histogram`, `linear_regression`, `correlation_pearson`
- New package `@vfir/smart-charts` with empty exports + tsup build
- Root `build:wasm-stats` script; verified `pnpm build` passes

**Phase 2 — Numeric stats engine + profile (1.5 weeks)**
- Full wasm-stats numeric path: outliers, change points, seasonality, clusters, group-by aggregates
- `data-adapter.ts` (schema infer including text-column detection + categorical interning)
- `stats-engine.ts` + `profile-builder.ts`
- Vitest coverage for the JS side; Rust unit tests inline in each module

**Phase 2.5 — Text aggregations (~3 days)**
- `text.rs`: tokenizer + stopwords, TF / TF-IDF, RAKE-lite, AFINN-165 embedded as `phf` map, sentiment_score / batch / summary
- `data-adapter.ts` text-column detection heuristic (string column with avg length > N tokens and high cardinality → `text`)
- Profile builder: when a text column is present, attach `TextInsights` with top keywords and sentiment summary; if a categorical or temporal column also exists, compute `byGroup`
- Property tests against a JS reference for tokenization + sentiment on a fixed sample

**Phase 3 — Layercake renderer (1 week)**
- `render/charts/*.svelte` — Line, Bar, Scatter, Area, Histogram, Heatmap, **WordCloud, SentimentBar** composed from `<LayerCake>` + `<Svg>`/`<Canvas>`
- `spec-to-layercake.ts` — pure mapping from `EnhancementSpec` to component + props (incl. `wordCloud` / `sentimentBar` branches that read from `profile.text` rather than raw rows)
- Annotation overlays (trendline, callout, region, threshold) as their own Svg layer

**Phase 4 — LLM enhancer (1 week)**
- `enhancer.ts` with provider-pluggable `fetch`-based call (OpenAI + Anthropic + a `mock` provider for tests)
- Structured-output handling, response validation, retry with stricter prompt on shape failure
- `SmartChart.svelte` ties it together: data → stats → enhance → render, with progressive states (basic chart first, enhanced chart on resolve)

**Phase 5 — Playground tab + polish (1 week)**
- Smart Charts tab with three sample datasets + question UI
- Profile panel, follow-up chips, API key flow
- Loading/error states, accessibility pass on the rendered SVG
- Task log in `tasks/YYYY-MM-DD-smart-charts.md` per `AGENTS.md`

**Total: ~5.5–6.5 weeks** (down from the original 12–13 by dropping DuckDB ingestion, the React adapter, and a bespoke renderer; the text path adds ~3 days).

---

## 11. Risks

- **LLM output quality**: bad annotations are worse than no annotations. Mitigations: strict JSON-mode + schema validation, fallback to a heuristic spec when validation fails, "basic chart now, enhanced chart when ready" rendering.
- **Latency**: LLM calls add 1–3s. The `SmartChart` component renders a baseline chart immediately from the profile and swaps in the enhanced spec when it arrives.
- **WASM bundle size**: `nalgebra` is heavy; if the bundle creeps past ~300KB gzip, we drop it for a hand-rolled SVD/least-squares — the operations we need are narrow.
- **Layercake API stability**: it's a small Svelte library; if a breaking change lands, our renderer is thin enough that we can pin or fork. Pin a known-good minor version in `package.json`.
- **No DuckDB means no SQL**: users with millions of rows or wide joins will outgrow this. Documented limit for v1: ~500K rows in a single table; revisit ingestion if there's demand.
- **Aggregation correctness**: rolling our own group-by in Rust is small but easy to get wrong. Cover with property tests against a naive JS reference on random inputs.
- **Text path is intentionally dumb**: AFINN-style sentiment misses sarcasm, negation beyond one-word lookahead, and non-English text. Documented as such. If users push for better, the upgrade path is a small ONNX model loaded into the same wasm runtime — out of scope for v1, but the `TextInsights` shape is forward-compatible.
