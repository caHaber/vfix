use wasm_bindgen::prelude::*;

// ----- Existing exports -----

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
    from.iter().zip(to.iter()).map(|(a, b)| a + (b - a) * t_eased).collect()
}

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
        if x < t { lo = mid; } else { hi = mid; }
    }
    bezier_val((lo + hi) / 2.0, y1, y2)
}

fn bezier_val(t: f32, p1: f32, p2: f32) -> f32 {
    3.0 * (1.0 - t).powi(2) * t * p1 + 3.0 * (1.0 - t) * t.powi(2) * p2 + t.powi(3)
}

// ----- New: cartographer layout primitives -----

/// One step of a force-directed simulation on N rectangular blocks.
///
/// Inputs (all length N):
///   x, y              current center positions
///   w, h              block dimensions
///   importance        0-1; higher = stronger pull to center
///   vx, vy            current velocities
///   center_x, center_y container center
///   repulsion         pairwise repulsion strength (e.g. 4000.0)
///   centering         importance-weighted pull strength (e.g. 0.02)
///   damping           velocity damping per step (e.g. 0.85)
///   dt                time step (e.g. 1.0)
///
/// Returns flat Vec<f32> of length 4N: [x0, y0, vx0, vy0, x1, y1, vx1, vy1, ...]
#[wasm_bindgen]
pub fn force_step(
    x: &[f32], y: &[f32], w: &[f32], h: &[f32],
    importance: &[f32], vx: &[f32], vy: &[f32],
    center_x: f32, center_y: f32,
    repulsion: f32, centering: f32, damping: f32, dt: f32,
) -> Vec<f32> {
    let n = x.len();
    let mut nx = vec![0f32; n];
    let mut ny = vec![0f32; n];
    let mut nvx = vec![0f32; n];
    let mut nvy = vec![0f32; n];

    for i in 0..n {
        let mut fx = (center_x - x[i]) * centering * importance[i];
        let mut fy = (center_y - y[i]) * centering * importance[i];

        for j in 0..n {
            if i == j { continue; }
            let dx = x[i] - x[j];
            let dy = y[i] - y[j];
            let overlap_x = (w[i] + w[j]) * 0.5 + 8.0 - dx.abs();
            let overlap_y = (h[i] + h[j]) * 0.5 + 8.0 - dy.abs();
            if overlap_x > 0.0 && overlap_y > 0.0 {
                let push = overlap_x.min(overlap_y);
                let dist2 = dx * dx + dy * dy + 1.0;
                fx += (dx / dist2.sqrt()) * repulsion * push * 0.001;
                fy += (dy / dist2.sqrt()) * repulsion * push * 0.001;
            }
        }

        nvx[i] = (vx[i] + fx * dt) * damping;
        nvy[i] = (vy[i] + fy * dt) * damping;
        nx[i] = x[i] + nvx[i] * dt;
        ny[i] = y[i] + nvy[i] * dt;
    }

    let mut out = Vec::with_capacity(n * 4);
    for i in 0..n {
        out.push(nx[i]);
        out.push(ny[i]);
        out.push(nvx[i]);
        out.push(nvy[i]);
    }
    out
}

/// Clamp each block center so its AABB fits inside [0, bounds_w] x [0, bounds_h].
/// Returns flat [x0, y0, x1, y1, ...] of length 2N.
#[wasm_bindgen]
pub fn clamp_to_bounds(
    x: &[f32], y: &[f32], w: &[f32], h: &[f32],
    bounds_w: f32, bounds_h: f32,
) -> Vec<f32> {
    let n = x.len();
    let mut out = Vec::with_capacity(n * 2);
    for i in 0..n {
        let hw = w[i] * 0.5;
        let hh = h[i] * 0.5;
        let cx = x[i].max(hw).min(bounds_w - hw);
        let cy = y[i].max(hh).min(bounds_h - hh);
        out.push(cx);
        out.push(cy);
    }
    out
}
