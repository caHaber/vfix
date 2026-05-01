pub fn group_by_sum(group_keys: &[u32], values: &[f64], group_count: usize) -> Vec<f64> {
	let mut out = vec![0.0; group_count];
	let n = group_keys.len().min(values.len());
	for i in 0..n {
		let g = group_keys[i] as usize;
		if g < group_count {
			out[g] += values[i];
		}
	}
	out
}

pub fn group_by_mean(group_keys: &[u32], values: &[f64], group_count: usize) -> Vec<f64> {
	let mut sums = vec![0.0; group_count];
	let mut counts = vec![0u32; group_count];
	let n = group_keys.len().min(values.len());
	for i in 0..n {
		let g = group_keys[i] as usize;
		if g < group_count {
			sums[g] += values[i];
			counts[g] += 1;
		}
	}
	sums.iter().zip(counts.iter())
		.map(|(s, &c)| if c == 0 { 0.0 } else { s / c as f64 })
		.collect()
}

pub fn group_by_count(group_keys: &[u32], group_count: usize) -> Vec<u32> {
	let mut out = vec![0u32; group_count];
	for &g in group_keys {
		let g = g as usize;
		if g < group_count {
			out[g] += 1;
		}
	}
	out
}
