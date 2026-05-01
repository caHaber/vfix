use serde::Serialize;

#[derive(Serialize, Default)]
pub struct ClusterResult {
	pub labels: Vec<u32>,
	pub centroids: Vec<Vec<f64>>, // shape: [k][dims]
	pub inertia: f64,
	pub iterations: u32,
}

/// Column-major input: columns[d] is the d-th feature, all of length n.
pub fn kmeans(columns: &[&[f64]], k: usize, max_iter: usize) -> ClusterResult {
	let dims = columns.len();
	if dims == 0 {
		return ClusterResult::default();
	}
	let n = columns[0].len();
	if n == 0 || k == 0 {
		return ClusterResult::default();
	}
	let k = k.min(n);

	// Deterministic init: pick k evenly-spaced points as initial centroids.
	let mut centroids: Vec<Vec<f64>> = (0..k)
		.map(|i| {
			let idx = (i * n) / k;
			(0..dims).map(|d| columns[d][idx]).collect()
		})
		.collect();

	let mut labels = vec![0u32; n];
	let mut iterations = 0u32;

	for iter in 0..max_iter {
		iterations = (iter + 1) as u32;
		let mut changed = false;

		// Assign
		for i in 0..n {
			let mut best = 0usize;
			let mut best_dist = f64::INFINITY;
			for c in 0..k {
				let mut d2 = 0.0;
				for d in 0..dims {
					let diff = columns[d][i] - centroids[c][d];
					d2 += diff * diff;
				}
				if d2 < best_dist {
					best_dist = d2;
					best = c;
				}
			}
			let new_label = best as u32;
			if labels[i] != new_label {
				changed = true;
				labels[i] = new_label;
			}
		}

		// Update
		let mut sums = vec![vec![0.0; dims]; k];
		let mut counts = vec![0usize; k];
		for i in 0..n {
			let c = labels[i] as usize;
			counts[c] += 1;
			for d in 0..dims {
				sums[c][d] += columns[d][i];
			}
		}
		for c in 0..k {
			if counts[c] > 0 {
				for d in 0..dims {
					centroids[c][d] = sums[c][d] / counts[c] as f64;
				}
			}
		}

		if !changed {
			break;
		}
	}

	let mut inertia = 0.0;
	for i in 0..n {
		let c = labels[i] as usize;
		for d in 0..dims {
			let diff = columns[d][i] - centroids[c][d];
			inertia += diff * diff;
		}
	}

	ClusterResult { labels, centroids, inertia, iterations }
}
