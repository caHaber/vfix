use serde::Serialize;

#[derive(Serialize, Default)]
pub struct TrendResult {
	pub slope: f64,
	pub direction: String, // "up" | "down" | "flat"
	pub strength: f64,     // |r| 0..1
}

#[derive(Serialize, Default)]
pub struct SeasonalityResult {
	pub period: usize,
	pub strength: f64,
}

#[derive(Serialize)]
pub struct ChangePoint {
	pub index: u32,
	pub confidence: f64,
	pub before_mean: f64,
	pub after_mean: f64,
}

pub fn detect_trend(values: &[f64]) -> TrendResult {
	let n = values.len();
	if n < 2 {
		return TrendResult { slope: 0.0, direction: "flat".into(), strength: 0.0 };
	}
	let nf = n as f64;
	let xs: Vec<f64> = (0..n).map(|i| i as f64).collect();
	let mean_x = xs.iter().sum::<f64>() / nf;
	let mean_y = values.iter().sum::<f64>() / nf;
	let mut sxx = 0.0;
	let mut sxy = 0.0;
	let mut syy = 0.0;
	for i in 0..n {
		let dx = xs[i] - mean_x;
		let dy = values[i] - mean_y;
		sxx += dx * dx;
		sxy += dx * dy;
		syy += dy * dy;
	}
	if sxx.abs() < f64::EPSILON {
		return TrendResult { slope: 0.0, direction: "flat".into(), strength: 0.0 };
	}
	let slope = sxy / sxx;
	let r = if syy.abs() < f64::EPSILON { 0.0 } else { sxy / (sxx * syy).sqrt() };
	let strength = r.abs();
	let direction = if strength < 0.1 {
		"flat".into()
	} else if slope > 0.0 {
		"up".into()
	} else {
		"down".into()
	};
	TrendResult { slope, direction, strength }
}

pub fn detect_seasonality(values: &[f64], max_period: usize) -> SeasonalityResult {
	let n = values.len();
	let max_period = max_period.min(n / 2).max(2);
	if n < 4 {
		return SeasonalityResult::default();
	}
	let mean = values.iter().sum::<f64>() / n as f64;
	let centered: Vec<f64> = values.iter().map(|v| v - mean).collect();
	let denom: f64 = centered.iter().map(|v| v * v).sum::<f64>().max(f64::EPSILON);
	let mut best_period = 0usize;
	let mut best_corr = 0.0f64;
	for lag in 2..=max_period {
		let mut num = 0.0;
		for i in 0..(n - lag) {
			num += centered[i] * centered[i + lag];
		}
		let r = num / denom;
		if r > best_corr {
			best_corr = r;
			best_period = lag;
		}
	}
	if best_corr < 0.3 {
		return SeasonalityResult::default();
	}
	SeasonalityResult { period: best_period, strength: best_corr }
}

pub fn change_points(values: &[f64], min_confidence: f64) -> Vec<ChangePoint> {
	let n = values.len();
	if n < 6 {
		return Vec::new();
	}
	let total_mean = values.iter().sum::<f64>() / n as f64;
	let total_var = values.iter().map(|v| (v - total_mean).powi(2)).sum::<f64>().max(f64::EPSILON);
	let mut points = Vec::new();
	let min_segment = (n / 10).max(3);
	for i in min_segment..(n - min_segment) {
		let (left, right) = values.split_at(i);
		let lm = left.iter().sum::<f64>() / left.len() as f64;
		let rm = right.iter().sum::<f64>() / right.len() as f64;
		let lvar = left.iter().map(|v| (v - lm).powi(2)).sum::<f64>();
		let rvar = right.iter().map(|v| (v - rm).powi(2)).sum::<f64>();
		let combined = lvar + rvar;
		let reduction = (total_var - combined) / total_var;
		if reduction > min_confidence && (lm - rm).abs() > 0.0 {
			points.push(ChangePoint {
				index: i as u32,
				confidence: reduction.min(1.0),
				before_mean: lm,
				after_mean: rm,
			});
		}
	}
	// keep only local maxima of confidence to avoid clusters of adjacent points
	let mut filtered = Vec::new();
	let window = (n / 20).max(3) as i64;
	for (i, cp) in points.iter().enumerate() {
		let is_peak = points.iter().enumerate().all(|(j, other)| {
			if i == j { return true; }
			((other.index as i64 - cp.index as i64).abs() > window) || other.confidence <= cp.confidence
		});
		if is_peak {
			filtered.push(ChangePoint {
				index: cp.index,
				confidence: cp.confidence,
				before_mean: cp.before_mean,
				after_mean: cp.after_mean,
			});
		}
	}
	filtered
}
