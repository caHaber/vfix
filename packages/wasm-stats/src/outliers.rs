use crate::descriptive::quantile_sorted;

pub fn zscore(column: &[f64], threshold: f64) -> Vec<u32> {
	if column.is_empty() {
		return Vec::new();
	}
	let n = column.len() as f64;
	let mean = column.iter().sum::<f64>() / n;
	let var = column.iter().map(|v| (v - mean).powi(2)).sum::<f64>() / n;
	let std = var.sqrt();
	if std < f64::EPSILON {
		return Vec::new();
	}
	column.iter().enumerate()
		.filter_map(|(i, &v)| {
			if ((v - mean) / std).abs() > threshold {
				Some(i as u32)
			} else {
				None
			}
		})
		.collect()
}

pub fn iqr(column: &[f64], factor: f64) -> Vec<u32> {
	if column.is_empty() {
		return Vec::new();
	}
	let mut sorted: Vec<f64> = column.iter().copied().filter(|v| v.is_finite()).collect();
	sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
	let q1 = quantile_sorted(&sorted, 0.25);
	let q3 = quantile_sorted(&sorted, 0.75);
	let iqr = q3 - q1;
	let lo = q1 - factor * iqr;
	let hi = q3 + factor * iqr;
	column.iter().enumerate()
		.filter_map(|(i, &v)| if v < lo || v > hi { Some(i as u32) } else { None })
		.collect()
}
