// JS-only fallback for @vfir/wasm-stats. Used by Vite when pnpm build:wasm-stats
// hasn't been run yet. Shapes match the Rust exports.

const STOPWORDS = new Set([
	'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'for', 'from', 'has', 'have', 'he',
	'her', 'his', 'i', 'if', 'in', 'into', 'is', 'it', 'its', 'me', 'my', 'no', 'not', 'of',
	'on', 'or', 'so', 'than', 'that', 'the', 'their', 'them', 'they', 'this', 'to', 'was',
	'we', 'were', 'what', 'when', 'which', 'who', 'will', 'with', 'you', 'your',
]);

const POSITIVE = new Set([
	'good', 'great', 'amazing', 'excellent', 'love', 'loved', 'wonderful', 'fantastic',
	'happy', 'best', 'awesome', 'perfect', 'nice', 'enjoy', 'enjoyed', 'fast', 'beautiful',
]);
const NEGATIVE = new Set([
	'bad', 'awful', 'terrible', 'hate', 'hated', 'horrible', 'worst', 'broken', 'slow',
	'disappoint', 'disappointed', 'disappointing', 'useless', 'poor', 'sad', 'angry', 'fail',
]);
const NEGATIONS = new Set(['not', 'no', "don't", 'dont', "doesn't", 'doesnt', 'never']);

function tokenizeRaw(input: string): string[] {
	const out: string[] = [];
	let cur = '';
	const lower = input.toLowerCase();
	for (let i = 0; i <= lower.length; i++) {
		const ch = i < lower.length ? lower[i] : '';
		if (/[a-z0-9']/.test(ch)) {
			cur += ch;
		} else {
			if (cur.length >= 2 && !STOPWORDS.has(cur)) out.push(cur);
			cur = '';
		}
	}
	return out;
}

export function tokenize(input: string): string[] {
	return tokenizeRaw(input);
}

export function summary(column: Float64Array) {
	const n = column.length;
	if (n === 0) return { count: 0, mean: 0, median: 0, std: 0, min: 0, max: 0, q1: 0, q3: 0 };
	const sorted = Array.from(column).filter(Number.isFinite).sort((a, b) => a - b);
	const mean = sorted.reduce((a, b) => a + b, 0) / sorted.length;
	const variance = sorted.reduce((a, b) => a + (b - mean) ** 2, 0) / sorted.length;
	const q = (p: number) => {
		const pos = p * (sorted.length - 1);
		const lo = Math.floor(pos);
		const hi = Math.ceil(pos);
		if (lo === hi) return sorted[lo];
		return sorted[lo] * (1 - (pos - lo)) + sorted[hi] * (pos - lo);
	};
	return { count: n, mean, median: q(0.5), std: Math.sqrt(variance), min: sorted[0], max: sorted[sorted.length - 1], q1: q(0.25), q3: q(0.75) };
}

export function histogram(column: Float64Array, binCount: number) {
	const filtered = Array.from(column).filter(Number.isFinite);
	if (filtered.length === 0) return { edges: [], counts: [] };
	const min = Math.min(...filtered);
	const max = Math.max(...filtered);
	if (max - min < 1e-12) return { edges: [min, max + 1], counts: [filtered.length] };
	const w = (max - min) / binCount;
	const edges = Array.from({ length: binCount + 1 }, (_, i) => min + w * i);
	const counts = new Array(binCount).fill(0);
	for (const v of filtered) {
		let idx = Math.floor((v - min) / w);
		if (idx >= binCount) idx = binCount - 1;
		counts[idx] += 1;
	}
	return { edges, counts };
}

export function linear_regression(x: Float64Array, y: Float64Array) {
	const n = Math.min(x.length, y.length);
	if (n < 2) return { coefficients: [], r_squared: 0, residual_std: 0 };
	const meanX = Array.from(x.subarray(0, n)).reduce((a, b) => a + b, 0) / n;
	const meanY = Array.from(y.subarray(0, n)).reduce((a, b) => a + b, 0) / n;
	let sxx = 0, sxy = 0, syy = 0;
	for (let i = 0; i < n; i++) {
		sxx += (x[i] - meanX) ** 2;
		sxy += (x[i] - meanX) * (y[i] - meanY);
		syy += (y[i] - meanY) ** 2;
	}
	if (sxx === 0) return { coefficients: [], r_squared: 0, residual_std: 0 };
	const slope = sxy / sxx;
	const intercept = meanY - slope * meanX;
	let ss = 0;
	for (let i = 0; i < n; i++) ss += (y[i] - (intercept + slope * x[i])) ** 2;
	return { coefficients: [intercept, slope], r_squared: syy ? 1 - ss / syy : 0, residual_std: Math.sqrt(ss / n) };
}

export function polynomial_regression(x: Float64Array, y: Float64Array, _degree: number) {
	return linear_regression(x, y);
}

export function outliers_zscore(column: Float64Array, threshold: number): Uint32Array {
	const n = column.length;
	if (n === 0) return new Uint32Array(0);
	const mean = Array.from(column).reduce((a, b) => a + b, 0) / n;
	const std = Math.sqrt(Array.from(column).reduce((a, b) => a + (b - mean) ** 2, 0) / n);
	if (std === 0) return new Uint32Array(0);
	const out: number[] = [];
	for (let i = 0; i < n; i++) {
		if (Math.abs((column[i] - mean) / std) > threshold) out.push(i);
	}
	return Uint32Array.from(out);
}

export function outliers_iqr(column: Float64Array, factor: number): Uint32Array {
	const sorted = Array.from(column).filter(Number.isFinite).sort((a, b) => a - b);
	if (sorted.length === 0) return new Uint32Array(0);
	const q = (p: number) => sorted[Math.floor(p * (sorted.length - 1))];
	const q1 = q(0.25), q3 = q(0.75);
	const iqr = q3 - q1;
	const lo = q1 - factor * iqr, hi = q3 + factor * iqr;
	const out: number[] = [];
	for (let i = 0; i < column.length; i++) {
		if (column[i] < lo || column[i] > hi) out.push(i);
	}
	return Uint32Array.from(out);
}

export function detect_trend(values: Float64Array) {
	const n = values.length;
	if (n < 2) return { slope: 0, direction: 'flat', strength: 0 };
	const xs = Array.from({ length: n }, (_, i) => i);
	const meanX = xs.reduce((a, b) => a + b, 0) / n;
	const meanY = Array.from(values).reduce((a, b) => a + b, 0) / n;
	let sxx = 0, sxy = 0, syy = 0;
	for (let i = 0; i < n; i++) {
		sxx += (xs[i] - meanX) ** 2;
		sxy += (xs[i] - meanX) * (values[i] - meanY);
		syy += (values[i] - meanY) ** 2;
	}
	if (sxx === 0) return { slope: 0, direction: 'flat', strength: 0 };
	const slope = sxy / sxx;
	const r = syy > 0 ? sxy / Math.sqrt(sxx * syy) : 0;
	const strength = Math.abs(r);
	const direction = strength < 0.1 ? 'flat' : slope > 0 ? 'up' : 'down';
	return { slope, direction, strength };
}

export function detect_seasonality(values: Float64Array, maxPeriod: number) {
	const n = values.length;
	const lim = Math.min(maxPeriod, Math.floor(n / 2));
	if (n < 4) return { period: 0, strength: 0 };
	const mean = Array.from(values).reduce((a, b) => a + b, 0) / n;
	const c = Array.from(values).map((v) => v - mean);
	const denom = Math.max(1e-9, c.reduce((a, b) => a + b * b, 0));
	let bestP = 0, bestR = 0;
	for (let lag = 2; lag <= lim; lag++) {
		let num = 0;
		for (let i = 0; i + lag < n; i++) num += c[i] * c[i + lag];
		const r = num / denom;
		if (r > bestR) { bestR = r; bestP = lag; }
	}
	if (bestR < 0.3) return { period: 0, strength: 0 };
	return { period: bestP, strength: bestR };
}

export function change_points(values: Float64Array, minConfidence: number) {
	const n = values.length;
	if (n < 6) return [];
	const totalMean = Array.from(values).reduce((a, b) => a + b, 0) / n;
	const totalVar = Math.max(1e-9, Array.from(values).reduce((a, b) => a + (b - totalMean) ** 2, 0));
	const minSeg = Math.max(3, Math.floor(n / 10));
	const out: { index: number; confidence: number; before_mean: number; after_mean: number }[] = [];
	for (let i = minSeg; i < n - minSeg; i++) {
		const left = Array.from(values.subarray(0, i));
		const right = Array.from(values.subarray(i));
		const lm = left.reduce((a, b) => a + b, 0) / left.length;
		const rm = right.reduce((a, b) => a + b, 0) / right.length;
		const lv = left.reduce((a, b) => a + (b - lm) ** 2, 0);
		const rv = right.reduce((a, b) => a + (b - rm) ** 2, 0);
		const reduction = (totalVar - (lv + rv)) / totalVar;
		if (reduction > minConfidence && lm !== rm) {
			out.push({ index: i, confidence: Math.min(1, reduction), before_mean: lm, after_mean: rm });
		}
	}
	return out;
}

export function correlation_pearson(a: Float64Array, b: Float64Array): number {
	const n = Math.min(a.length, b.length);
	if (n < 2) return 0;
	const ma = Array.from(a.subarray(0, n)).reduce((s, v) => s + v, 0) / n;
	const mb = Array.from(b.subarray(0, n)).reduce((s, v) => s + v, 0) / n;
	let saa = 0, sbb = 0, sab = 0;
	for (let i = 0; i < n; i++) {
		saa += (a[i] - ma) ** 2;
		sbb += (b[i] - mb) ** 2;
		sab += (a[i] - ma) * (b[i] - mb);
	}
	const denom = Math.sqrt(saa * sbb);
	return denom < 1e-12 ? 0 : sab / denom;
}

export function correlation_matrix(columns: number[][]): number[][] {
	const n = columns.length;
	const out: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
	for (let i = 0; i < n; i++) {
		out[i][i] = 1;
		for (let j = i + 1; j < n; j++) {
			const r = correlation_pearson(Float64Array.from(columns[i]), Float64Array.from(columns[j]));
			out[i][j] = r;
			out[j][i] = r;
		}
	}
	return out;
}

export function kmeans(data: number[][], k: number, maxIter: number) {
	const dims = data.length;
	const n = data[0]?.length ?? 0;
	if (n === 0 || k === 0) return { labels: [], centroids: [], inertia: 0, iterations: 0 };
	const kk = Math.min(k, n);
	const centroids = Array.from({ length: kk }, (_, i) => {
		const idx = Math.floor((i * n) / kk);
		return data.map((col) => col[idx]);
	});
	const labels = new Array<number>(n).fill(0);
	let iter = 0;
	for (; iter < maxIter; iter++) {
		let changed = false;
		for (let i = 0; i < n; i++) {
			let best = 0, bestD = Infinity;
			for (let c = 0; c < kk; c++) {
				let d = 0;
				for (let j = 0; j < dims; j++) d += (data[j][i] - centroids[c][j]) ** 2;
				if (d < bestD) { bestD = d; best = c; }
			}
			if (labels[i] !== best) { changed = true; labels[i] = best; }
		}
		const sums = Array.from({ length: kk }, () => new Array(dims).fill(0));
		const counts = new Array(kk).fill(0);
		for (let i = 0; i < n; i++) {
			counts[labels[i]] += 1;
			for (let j = 0; j < dims; j++) sums[labels[i]][j] += data[j][i];
		}
		for (let c = 0; c < kk; c++) {
			if (counts[c] > 0) for (let j = 0; j < dims; j++) centroids[c][j] = sums[c][j] / counts[c];
		}
		if (!changed) break;
	}
	let inertia = 0;
	for (let i = 0; i < n; i++) {
		for (let j = 0; j < dims; j++) inertia += (data[j][i] - centroids[labels[i]][j]) ** 2;
	}
	return { labels, centroids, inertia, iterations: iter + 1 };
}

export function group_by_sum(groupKeys: Uint32Array, values: Float64Array, groupCount: number): Float64Array {
	const out = new Float64Array(groupCount);
	const n = Math.min(groupKeys.length, values.length);
	for (let i = 0; i < n; i++) {
		const g = groupKeys[i];
		if (g < groupCount) out[g] += values[i];
	}
	return out;
}

export function group_by_mean(groupKeys: Uint32Array, values: Float64Array, groupCount: number): Float64Array {
	const sums = new Float64Array(groupCount);
	const counts = new Uint32Array(groupCount);
	const n = Math.min(groupKeys.length, values.length);
	for (let i = 0; i < n; i++) {
		const g = groupKeys[i];
		if (g < groupCount) { sums[g] += values[i]; counts[g] += 1; }
	}
	const out = new Float64Array(groupCount);
	for (let i = 0; i < groupCount; i++) out[i] = counts[i] === 0 ? 0 : sums[i] / counts[i];
	return out;
}

export function group_by_count(groupKeys: Uint32Array, groupCount: number): Uint32Array {
	const out = new Uint32Array(groupCount);
	for (const g of groupKeys) if (g < groupCount) out[g] += 1;
	return out;
}

export function term_frequency(docs: string[], topN: number) {
	const counts = new Map<string, number>();
	for (const doc of docs) for (const tok of tokenizeRaw(doc)) counts.set(tok, (counts.get(tok) ?? 0) + 1);
	return Array.from(counts.entries())
		.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
		.slice(0, topN)
		.map(([term, count]) => ({ term, score: count, count }));
}

export function tf_idf(docs: string[], topN: number) {
	const N = docs.length;
	if (N === 0) return [];
	const tokenized = docs.map(tokenizeRaw);
	const df = new Map<string, number>();
	for (const tokens of tokenized) {
		for (const t of new Set(tokens)) df.set(t, (df.get(t) ?? 0) + 1);
	}
	const scores = new Map<string, { score: number; count: number }>();
	for (const tokens of tokenized) {
		if (tokens.length === 0) continue;
		const local = new Map<string, number>();
		for (const t of tokens) local.set(t, (local.get(t) ?? 0) + 1);
		for (const [t, c] of local) {
			const tf = c / tokens.length;
			const idf = Math.log((N + 1) / ((df.get(t) ?? 1) + 1)) + 1;
			const cur = scores.get(t) ?? { score: 0, count: 0 };
			cur.score += tf * idf;
			cur.count += c;
			scores.set(t, cur);
		}
	}
	return Array.from(scores.entries())
		.sort((a, b) => b[1].score - a[1].score || a[0].localeCompare(b[0]))
		.slice(0, topN)
		.map(([term, v]) => ({ term, score: v.score, count: v.count }));
}

export function rake_keywords(docs: string[], topN: number) {
	const phraseScores = new Map<string, { score: number; count: number }>();
	for (const doc of docs) {
		const lower = doc.toLowerCase();
		let cur: string[] = [];
		let buf = '';
		for (let i = 0; i <= lower.length; i++) {
			const ch = i < lower.length ? lower[i] : '';
			const isWord = /[a-z0-9']/.test(ch);
			if (isWord) buf += ch;
			if (!isWord || i === lower.length) {
				const word = buf;
				buf = '';
				const isStop = word.length < 2 || STOPWORDS.has(word);
				const isPunctBreak = ch === '.' || ch === ',' || ch === ';' || ch === ':' || ch === '!' || ch === '?' || ch === '\n';
				if (word && !isStop) cur.push(word);
				if ((isStop || isPunctBreak || i === lower.length) && cur.length > 0) {
					const phrase = cur.join(' ');
					const wc = cur.length;
					const score = (wc - 1 + wc) / Math.max(1, wc);
					const e = phraseScores.get(phrase) ?? { score: 0, count: 0 };
					e.score += score;
					e.count += 1;
					phraseScores.set(phrase, e);
					cur = [];
				}
			}
		}
	}
	return Array.from(phraseScores.entries())
		.filter(([p]) => p.includes(' ') || p.length > 3)
		.map(([p, v]) => ({ term: p, score: v.score * Math.sqrt(v.count), count: v.count }))
		.sort((a, b) => b.score - a.score || a.term.localeCompare(b.term))
		.slice(0, topN);
}

export function sentiment_score(input: string): number {
	const tokens = input.toLowerCase().split(/[^a-z0-9']+/).filter(Boolean);
	let total = 0, count = 0, negate = false;
	for (const t of tokens) {
		count += 1;
		if (NEGATIONS.has(t)) { negate = true; continue; }
		let score = 0;
		if (POSITIVE.has(t)) score = 2;
		else if (NEGATIVE.has(t)) score = -2;
		if (negate) score = -score;
		total += score;
		negate = false;
	}
	if (count === 0) return 0;
	return Math.max(-1, Math.min(1, total / Math.sqrt(count) / 5));
}

export function sentiment_batch(docs: string[]): Float64Array {
	const out = new Float64Array(docs.length);
	for (let i = 0; i < docs.length; i++) out[i] = sentiment_score(docs[i]);
	return out;
}

export function sentiment_summary(scores: Float64Array, binCount: number) {
	const n = scores.length;
	if (n === 0) return { mean: 0, positive_ratio: 0, negative_ratio: 0, neutral_ratio: 0, bins: [], counts: [] };
	const arr = Array.from(scores);
	const mean = arr.reduce((a, b) => a + b, 0) / n;
	const pos = arr.filter((s) => s > 0.05).length / n;
	const neg = arr.filter((s) => s < -0.05).length / n;
	const neu = 1 - pos - neg;
	const bins: number[] = Array.from({ length: binCount + 1 }, (_, i) => -1 + (2 * i) / binCount);
	const counts = new Array<number>(binCount).fill(0);
	for (const s of arr) {
		const clamped = Math.max(-1, Math.min(1, s));
		let idx = Math.floor(((clamped + 1) / 2) * binCount);
		if (idx >= binCount) idx = binCount - 1;
		counts[idx] += 1;
	}
	return { mean, positive_ratio: pos, negative_ratio: neg, neutral_ratio: neu, bins, counts };
}

export default async function init(): Promise<void> {
	// no-op stub
}
