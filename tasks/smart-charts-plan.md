# Smart Charts — Project Plan

A client-side, WASM-powered chart library with built-in statistical intelligence and LLM-driven enhancements. Built on DuckDB-WASM for data handling, with a custom Rust/WASM stats module for analysis that SQL can't express, and an LLM layer that turns statistical insights into smart annotations, chart type selection, and narrative captions.

---

## 1. Core Idea

Most chart libraries draw pixels. This one **thinks about the data first**.

```
Raw data → DuckDB-WASM → Stats (WASM) → LLM enhancement → Smart chart
```

The killer feature: a `question` prop. Pass data and a question in natural language, get back a chart that actually answers the question — with relevant annotations, the right chart type, and a caption explaining what it shows.

```tsx
<SmartChart data={salesData} question="what drove Q3 growth?" />
```

---

## 2. Goals

**v1.0 goals:**

- Embed DuckDB-WASM for client-side SQL and data ingestion (CSV, Parquet, JSON)
- Custom Rust/WASM statistical module for regression, outliers, change points, correlation, seasonality, clustering
- LLM enhancement pipeline that turns stats into chart specs, annotations, and captions
- Framework adapters for React and Svelte
- Default to Vega-Lite rendering (clean JSON specs, pluggable)
- Privacy-first: raw data never leaves the browser; LLM only sees aggregated statistical profiles

**Non-goals:**

- Building a custom query engine (DuckDB already does this better than we could)
- LLM inference in the browser (too slow, user brings their own API key)
- Being a "dashboard platform" — this is a library, not a SaaS

---

## 3. Architecture

```
┌──────────────────────────────────────────────────────────────┐
│              @smart-charts/react | /svelte | /vanilla         │
│                                                               │
│   <SmartChart data={data} question="..." />                  │
│   <SmartDashboard datasets={[...]} />                        │
└──────────────────────┬───────────────────────────────────────┘
                       │
┌──────────────────────▼───────────────────────────────────────┐
│                    @smart-charts/core                         │
│                                                               │
│   Session → DataAdapter → StatsEngine → Enhancer → Renderer  │
└──────┬───────────────┬─────────────┬────────────┬────────────┘
       │               │             │            │
       ▼               ▼             ▼            ▼
  ┌─────────┐   ┌─────────────┐  ┌────────┐  ┌──────────┐
  │ DuckDB- │   │ @smart-     │  │  LLM   │  │Vega-Lite │
  │ WASM    │   │ charts/     │  │  API   │  │renderer  │
  │         │   │ wasm-stats  │  │ (user- │  │(or custom│
  │ SQL +   │   │ (Rust)      │  │ bring- │  │ target)  │
  │ data    │   │             │  │ your-  │  │          │
  │ ingest  │   │ regression, │  │ own)   │  │          │
  │         │   │ outliers,   │  │        │  │          │
  │         │   │ time series,│  │        │  │          │
  │         │   │ clustering  │  │        │  │          │
  └─────────┘   └─────────────┘  └────────┘  └──────────┘
```

### Data flow (single chart)

1. User passes data (array, CSV, Parquet, or File) and optional question
2. `DataAdapter` loads data into DuckDB-WASM (skipped for small arrays — threshold ~10K rows)
3. `StatsEngine` runs SQL aggregations via DuckDB + advanced stats via Rust/WASM module
4. Produces a compact **statistical profile** (~500 tokens, no raw data)
5. `Enhancer` sends profile + question to LLM, gets back an **enhancement spec**
6. `Renderer` combines spec with data and produces the final chart

### Why DuckDB-WASM as the base

- Already handles CSV/Parquet/JSON ingestion, SQL queries, joins, aggregations on millions of rows
- Battle-tested in production (Evidence, Count, lakeFS)
- Saves months of building our own columnar engine
- Our custom WASM module stays small and focused on what SQL can't express (regression, outlier detection, change points, etc.)

---

## 4. Package Structure

```
smart-charts/
├── packages/
│   ├── core/                  # Pipeline orchestrator
│   │   ├── session.ts
│   │   ├── data-adapter.ts    # Routes data to DuckDB or memory
│   │   ├── stats-engine.ts    # Orchestrates DuckDB + WASM stats
│   │   ├── enhancer.ts        # LLM integration
│   │   ├── profile-builder.ts # Stats → compact profile
│   │   └── types.ts
│   ├── wasm-stats/            # Rust statistical engine
│   │   ├── src/
│   │   │   ├── lib.rs
│   │   │   ├── regression.rs
│   │   │   ├── outliers.rs
│   │   │   ├── timeseries.rs  # Trend, seasonality, change points
│   │   │   ├── correlation.rs
│   │   │   └── clustering.rs
│   │   └── Cargo.toml
│   ├── renderers/
│   │   └── vega-lite/         # Default renderer
│   ├── react/
│   ├── svelte/
│   └── vanilla/
├── apps/
│   ├── playground/            # Upload data, see smart charts
│   └── docs/
└── examples/
    ├── sales-dashboard/
    ├── anomaly-detection/
    └── question-driven/
```

---

## 5. Key Interfaces

### Statistical profile (what the LLM sees — never raw data)

```typescript
interface StatisticalProfile {
  shape: { rows: number; columns: number };
  columns: Record<string, ColumnProfile>;
  correlations: Correlation[];
  timeseries?: TimeseriesInsights;  // if temporal column detected
  anomalies: Anomaly[];
  clusters?: ClusterInsight;
}

interface ColumnProfile {
  type: 'numeric' | 'categorical' | 'temporal' | 'boolean';
  cardinality: number;
  summary: { mean?: number; median?: number; std?: number; mode?: string; ... };
  distribution?: 'normal' | 'skewed' | 'bimodal' | 'uniform';
}
```

### Enhancement spec (what the LLM returns)

```typescript
interface EnhancementSpec {
  chartType: 'line' | 'bar' | 'scatter' | 'heatmap' | 'area' | 'histogram';
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
// Core
const chart = createChart({ data, llm: { provider, model } });
const spec = await chart.enhance({ question: 'what drove Q3 growth?' });
const stats = chart.analyze();  // stats only, no LLM

// React
<SmartChart data={salesData} question="compare regions" />
<SmartDashboard datasets={{ sales, costs }} question="where is profit highest?" />

// Svelte
<SmartChart data={salesData} question="show me anomalies" />
```

---

## 6. The Rust/WASM Stats Module

Small, focused module for operations DuckDB's SQL can't express cleanly:

```rust
pub fn linear_regression(x: &[f64], y: &[f64]) -> RegressionResult;
pub fn polynomial_regression(x: &[f64], y: &[f64], degree: u8) -> RegressionResult;
pub fn outliers_zscore(column: &[f64], threshold: f64) -> Vec<usize>;
pub fn outliers_iqr(column: &[f64], factor: f64) -> Vec<usize>;
pub fn detect_trend(values: &[f64]) -> TrendResult;
pub fn detect_seasonality(values: &[f64], max_period: usize) -> SeasonalityResult;
pub fn change_points(values: &[f64], min_confidence: f64) -> Vec<ChangePoint>;
pub fn correlation_matrix(columns: &[&[f64]]) -> Vec<Vec<f64>>;
pub fn kmeans(data: &[&[f64]], k: usize, max_iter: usize) -> ClusterResult;
```

**Why WASM and not pure JS:** for datasets above ~10K rows, these operations are 5–15x faster in WASM. For a 100K-row correlation matrix or change point detection on a long time series, the difference is "instant" vs. "janky."

---

## 7. LLM Prompt Strategy

The LLM never sees raw data — only aggregated statistics. This means:

- **Privacy**: sensitive row-level data never leaves the browser
- **Token efficiency**: 100K rows becomes a ~500-token profile
- **Better outputs**: LLMs reason better about summaries than raw numbers

```
You are a data visualization expert. Given this statistical profile, 
generate an enhancement specification as JSON.

Dataset: {shape info}
User question: {question}
Profile: {JSON}

Respond with an EnhancementSpec (schema attached)...
```

---

## 8. Build and Tooling

- **pnpm workspaces + Turborepo** for the monorepo
- **wasm-pack** for the Rust stats module
- **DuckDB-WASM** loaded lazily (it's ~4MB — only load for large datasets)
- **tsup** for package builds
- **Vite** for playground and docs
- **Vitest** for unit tests, **Playwright** for browser tests
- **Changesets** for versioning

---

## 9. Development Phases

**Phase 1 — Foundations (2–3 weeks)**
- Monorepo + build pipeline
- Core `Session` with direct-array path (no DuckDB yet)
- Simple stats (mean, median, variance) in Rust/WASM

**Phase 2 — DuckDB integration (2 weeks)**
- DataAdapter that routes to DuckDB for large data
- SQL-based aggregation pipeline
- Parquet/CSV ingestion working end-to-end

**Phase 3 — Stats engine (3 weeks)**
- Full Rust/WASM stats module: regression, outliers, change points, correlation
- Profile builder that combines DuckDB aggregates + WASM stats

**Phase 4 — LLM enhancement (2 weeks)**
- Prompt engineering, structured output parsing
- EnhancementSpec → Vega-Lite translator
- Question-driven rendering

**Phase 5 — Adapters + polish (3 weeks)**
- React adapter + components
- Svelte adapter + components
- Playground + docs
- Benchmarks, accessibility, visual polish

**Phase 6 — Launch**
- v1.0 to npm
- Launch post, demo video

**Total to v1.0: ~12–13 weeks**

---

## 10. Why This Is Novel

Nobody has built this combination as an open-source library:

- **DuckDB-WASM** does data, but has no charts or intelligence
- **Chart libraries** (Recharts, Chart.js, Vega) do rendering, no intelligence or stats
- **LIDA** (Microsoft) does LLM chart generation, but server-side Python only
- **Highcharts** has an AI editor, but it's proprietary SaaS and chart *creation*, not *enhancement*
- **JQWidgets** markets "AI-enhanced" charts, but it's rule-based highlighting, not real LLM integration

The novel contribution: **a privacy-first, client-side pipeline where WASM does the computation, LLM does the interpretation, and developers get an embeddable component with a `question` prop.**

---

## 11. Risks

- **LLM output quality**: bad annotations are worse than no annotations. Need strong prompt engineering and fallback modes.
- **Latency**: LLM calls add 1–3s. Show basic chart immediately; enhance when ready.
- **DuckDB bundle size**: ~4MB is significant. Lazy-load, make optional.
- **Renderer abstraction**: pick one renderer (Vega-Lite) for v1, don't over-abstract.
