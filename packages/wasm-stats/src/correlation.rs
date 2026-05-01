pub fn pearson(a: &[f64], b: &[f64]) -> f64 {
	let n = a.len().min(b.len());
	if n < 2 {
		return 0.0;
	}
	let nf = n as f64;
	let mean_a = a[..n].iter().sum::<f64>() / nf;
	let mean_b = b[..n].iter().sum::<f64>() / nf;
	let mut saa = 0.0;
	let mut sbb = 0.0;
	let mut sab = 0.0;
	for i in 0..n {
		let da = a[i] - mean_a;
		let db = b[i] - mean_b;
		saa += da * da;
		sbb += db * db;
		sab += da * db;
	}
	let denom = (saa * sbb).sqrt();
	if denom < f64::EPSILON { 0.0 } else { sab / denom }
}

pub fn matrix(columns: &[&[f64]]) -> Vec<Vec<f64>> {
	let n = columns.len();
	let mut out = vec![vec![0.0; n]; n];
	for i in 0..n {
		out[i][i] = 1.0;
		for j in (i + 1)..n {
			let r = pearson(columns[i], columns[j]);
			out[i][j] = r;
			out[j][i] = r;
		}
	}
	out
}
