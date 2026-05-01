use serde::Serialize;

#[derive(Serialize, Default)]
pub struct Summary {
	pub count: usize,
	pub mean: f64,
	pub median: f64,
	pub std: f64,
	pub min: f64,
	pub max: f64,
	pub q1: f64,
	pub q3: f64,
}

#[derive(Serialize, Default)]
pub struct Histogram {
	pub edges: Vec<f64>,
	pub counts: Vec<u32>,
}

pub fn summary(column: &[f64]) -> Summary {
	if column.is_empty() {
		return Summary::default();
	}
	let count = column.len();
	let mean = column.iter().sum::<f64>() / count as f64;
	let var = column.iter().map(|v| (v - mean).powi(2)).sum::<f64>() / count as f64;
	let std = var.sqrt();
	let mut sorted: Vec<f64> = column.iter().copied().filter(|v| v.is_finite()).collect();
	sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
	let median = quantile_sorted(&sorted, 0.5);
	let q1 = quantile_sorted(&sorted, 0.25);
	let q3 = quantile_sorted(&sorted, 0.75);
	let min = *sorted.first().unwrap_or(&0.0);
	let max = *sorted.last().unwrap_or(&0.0);
	Summary { count, mean, median, std, min, max, q1, q3 }
}

pub fn histogram(column: &[f64], bin_count: usize) -> Histogram {
	if column.is_empty() {
		return Histogram::default();
	}
	let mut min = f64::INFINITY;
	let mut max = f64::NEG_INFINITY;
	for &v in column {
		if v.is_finite() {
			if v < min { min = v; }
			if v > max { max = v; }
		}
	}
	if !min.is_finite() || !max.is_finite() {
		return Histogram::default();
	}
	if (max - min).abs() < f64::EPSILON {
		return Histogram { edges: vec![min, max + 1.0], counts: vec![column.len() as u32] };
	}
	let width = (max - min) / bin_count as f64;
	let mut edges = Vec::with_capacity(bin_count + 1);
	for i in 0..=bin_count {
		edges.push(min + width * i as f64);
	}
	let mut counts = vec![0u32; bin_count];
	for &v in column {
		if !v.is_finite() { continue; }
		let mut idx = ((v - min) / width).floor() as usize;
		if idx >= bin_count { idx = bin_count - 1; }
		counts[idx] += 1;
	}
	Histogram { edges, counts }
}

pub fn quantile_sorted(sorted: &[f64], q: f64) -> f64 {
	if sorted.is_empty() {
		return 0.0;
	}
	let pos = q * (sorted.len() - 1) as f64;
	let lo = pos.floor() as usize;
	let hi = pos.ceil() as usize;
	if lo == hi {
		sorted[lo]
	} else {
		let frac = pos - lo as f64;
		sorted[lo] * (1.0 - frac) + sorted[hi] * frac
	}
}
