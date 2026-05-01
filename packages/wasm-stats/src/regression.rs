use serde::Serialize;

#[derive(Serialize, Default)]
pub struct RegressionResult {
	pub coefficients: Vec<f64>, // [intercept, c1, c2, ...]
	pub r_squared: f64,
	pub residual_std: f64,
}

pub fn linear(x: &[f64], y: &[f64]) -> RegressionResult {
	let n = x.len().min(y.len());
	if n < 2 {
		return RegressionResult::default();
	}
	let nf = n as f64;
	let mean_x = x[..n].iter().sum::<f64>() / nf;
	let mean_y = y[..n].iter().sum::<f64>() / nf;
	let mut sxx = 0.0;
	let mut sxy = 0.0;
	let mut syy = 0.0;
	for i in 0..n {
		let dx = x[i] - mean_x;
		let dy = y[i] - mean_y;
		sxx += dx * dx;
		sxy += dx * dy;
		syy += dy * dy;
	}
	if sxx.abs() < f64::EPSILON {
		return RegressionResult::default();
	}
	let slope = sxy / sxx;
	let intercept = mean_y - slope * mean_x;
	let ss_res = (0..n).map(|i| {
		let pred = intercept + slope * x[i];
		(y[i] - pred).powi(2)
	}).sum::<f64>();
	let r_squared = if syy.abs() < f64::EPSILON { 0.0 } else { 1.0 - ss_res / syy };
	let residual_std = (ss_res / nf).sqrt();
	RegressionResult { coefficients: vec![intercept, slope], r_squared, residual_std }
}

pub fn polynomial(x: &[f64], y: &[f64], degree: usize) -> RegressionResult {
	let n = x.len().min(y.len());
	let degree = degree.max(1).min(6);
	if n < degree + 1 {
		return linear(x, y);
	}
	let cols = degree + 1;
	// Build the normal equations: (X^T X) β = X^T y
	let mut a = vec![0.0_f64; cols * cols];
	let mut b = vec![0.0_f64; cols];
	for i in 0..n {
		let xi = x[i];
		let yi = y[i];
		let mut row_pow = vec![1.0_f64; cols];
		for j in 1..cols {
			row_pow[j] = row_pow[j - 1] * xi;
		}
		for r in 0..cols {
			for c in 0..cols {
				a[r * cols + c] += row_pow[r] * row_pow[c];
			}
			b[r] += row_pow[r] * yi;
		}
	}
	let coeffs = match gauss_solve(&mut a, &mut b, cols) {
		Some(c) => c,
		None => return linear(x, y),
	};
	let mean_y = y[..n].iter().sum::<f64>() / n as f64;
	let mut ss_res = 0.0;
	let mut ss_tot = 0.0;
	for i in 0..n {
		let mut pred = 0.0;
		let mut p = 1.0;
		for &c in &coeffs {
			pred += c * p;
			p *= x[i];
		}
		ss_res += (y[i] - pred).powi(2);
		ss_tot += (y[i] - mean_y).powi(2);
	}
	let r_squared = if ss_tot.abs() < f64::EPSILON { 0.0 } else { 1.0 - ss_res / ss_tot };
	let residual_std = (ss_res / n as f64).sqrt();
	RegressionResult { coefficients: coeffs, r_squared, residual_std }
}

fn gauss_solve(a: &mut [f64], b: &mut [f64], n: usize) -> Option<Vec<f64>> {
	for i in 0..n {
		let mut max_row = i;
		let mut max_val = a[i * n + i].abs();
		for r in (i + 1)..n {
			let v = a[r * n + i].abs();
			if v > max_val {
				max_val = v;
				max_row = r;
			}
		}
		if max_val < 1e-12 {
			return None;
		}
		if max_row != i {
			for c in 0..n {
				a.swap(i * n + c, max_row * n + c);
			}
			b.swap(i, max_row);
		}
		for r in (i + 1)..n {
			let factor = a[r * n + i] / a[i * n + i];
			for c in i..n {
				a[r * n + c] -= factor * a[i * n + c];
			}
			b[r] -= factor * b[i];
		}
	}
	let mut x = vec![0.0; n];
	for i in (0..n).rev() {
		let mut sum = b[i];
		for c in (i + 1)..n {
			sum -= a[i * n + c] * x[c];
		}
		x[i] = sum / a[i * n + i];
	}
	Some(x)
}
