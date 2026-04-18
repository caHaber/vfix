use wasm_bindgen::prelude::*;

/// Compute line breaks given glyph advances and available width.
/// Returns an array of line-break indices.
#[wasm_bindgen]
pub fn compute_layout(advances: &[f32], available_width: f32, break_points: &[u32]) -> Vec<u32> {
    let mut breaks = Vec::new();
    let mut line_width: f32 = 0.0;
    let mut last_break: usize = 0;

    for &bp in break_points {
        let bp = bp as usize;
        let end = (bp + 1).min(advances.len());
        let segment_width: f32 = advances[last_break..end].iter().sum();

        if line_width + segment_width > available_width && line_width > 0.0 {
            breaks.push(last_break as u32);
            line_width = segment_width;
        } else {
            line_width += segment_width;
        }
        last_break = bp + 1;
    }

    breaks
}

/// Interpolate between two sets of axis values.
/// `from` and `to` must have the same length.
/// `t` is progress from 0.0 to 1.0.
/// `curve_type`: 0 = linear, 1 = ease-out cubic, 2 = spring
#[wasm_bindgen]
pub fn interpolate_axes(from: &[f32], to: &[f32], t: f32, curve_type: u8) -> Vec<f32> {
    let t_eased = match curve_type {
        1 => {
            let t1 = t - 1.0;
            t1 * t1 * t1 + 1.0
        }
        2 => {
            let decay = (-5.0 * t).exp();
            1.0 - decay * (1.0 - t)
        }
        _ => t,
    };

    from.iter()
        .zip(to.iter())
        .map(|(a, b)| a + (b - a) * t_eased)
        .collect()
}

/// Cubic bezier interpolation for arbitrary control points.
#[wasm_bindgen]
pub fn cubic_bezier_interpolate(x1: f32, y1: f32, x2: f32, y2: f32, t: f32) -> f32 {
    let mut lo: f32 = 0.0;
    let mut hi: f32 = 1.0;
    for _ in 0..20 {
        let mid = (lo + hi) / 2.0;
        let x = bezier_val(mid, x1, x2);
        if (x - t).abs() < 0.0001 {
            return bezier_val(mid, y1, y2);
        }
        if x < t {
            lo = mid;
        } else {
            hi = mid;
        }
    }
    bezier_val((lo + hi) / 2.0, y1, y2)
}

fn bezier_val(t: f32, p1: f32, p2: f32) -> f32 {
    3.0 * (1.0 - t).powi(2) * t * p1 + 3.0 * (1.0 - t) * t.powi(2) * p2 + t.powi(3)
}
