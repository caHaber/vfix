use std::cell::RefCell;
use wasm_bindgen::prelude::*;

// ----- Variable-font glyph rasterization (swash) -----
//
// Owned font bytes live in thread-local storage so JS can pass a TTF in once
// and reuse it across many rasterize_glyph calls. swash's FontRef is a thin
// borrow over those bytes; we rebuild it per call (it's just a couple of
// pointers — cheap).

thread_local! {
    static FONT_BYTES: RefCell<Option<Vec<u8>>> = const { RefCell::new(None) };
    static SCALE_CTX: RefCell<swash::scale::ScaleContext> =
        RefCell::new(swash::scale::ScaleContext::new());
}

fn with_font<R>(f: impl FnOnce(swash::FontRef<'_>) -> R) -> Option<R> {
    FONT_BYTES.with(|cell| {
        let bytes = cell.borrow();
        let bytes = bytes.as_deref()?;
        let font = swash::FontRef::from_index(bytes, 0)?;
        Some(f(font))
    })
}

const TAG_WGHT: swash::Tag = swash::tag_from_bytes(b"wght");
const TAG_CASL: swash::Tag = swash::tag_from_bytes(b"CASL");
const TAG_SLNT: swash::Tag = swash::tag_from_bytes(b"slnt");
const TAG_MONO: swash::Tag = swash::tag_from_bytes(b"MONO");
const TAG_CRSV: swash::Tag = swash::tag_from_bytes(b"CRSV");

fn settings(wght: f32, casl: f32, slnt: f32, mono: f32, crsv: f32) -> [swash::Setting<f32>; 5] {
    [
        swash::Setting { tag: TAG_WGHT, value: wght },
        swash::Setting { tag: TAG_CASL, value: casl },
        swash::Setting { tag: TAG_SLNT, value: slnt },
        swash::Setting { tag: TAG_MONO, value: mono },
        swash::Setting { tag: TAG_CRSV, value: crsv },
    ]
}

/// Load a TTF/OTF font into the rasterizer. Returns 1 on success, 0 on
/// failure. Pass the raw font bytes — woff2 must be decoded by the caller
/// first (use a JS woff2 decoder, or vendor an unpacked TTF directly).
#[wasm_bindgen]
pub fn init_font(bytes: &[u8]) -> u32 {
    if swash::FontRef::from_index(bytes, 0).is_none() {
        return 0;
    }
    FONT_BYTES.with(|cell| {
        *cell.borrow_mut() = Some(bytes.to_vec());
    });
    1
}

/// Returns true if a font has been loaded. Useful for debug pills.
#[wasm_bindgen]
pub fn font_loaded() -> u32 {
    FONT_BYTES.with(|cell| if cell.borrow().is_some() { 1 } else { 0 })
}

/// Map a Unicode codepoint to a glyph id. Returns 0 if the font has no glyph
/// for that codepoint or no font is loaded.
#[wasm_bindgen]
pub fn glyph_id_for_codepoint(codepoint: u32) -> u32 {
    let Some(c) = char::from_u32(codepoint) else { return 0; };
    with_font(|font| font.charmap().map(c) as u32).unwrap_or(0)
}

fn normalized(font: &swash::FontRef<'_>, s: &[swash::Setting<f32>]) -> Vec<swash::NormalizedCoord> {
    font.variations().normalized_coords(s.iter().copied()).collect()
}

/// Pixel advance for a glyph at a given axis tuple and size.
#[wasm_bindgen]
pub fn glyph_advance(
    glyph_id: u32,
    wght: f32,
    casl: f32,
    slnt: f32,
    mono: f32,
    crsv: f32,
    size_px: f32,
) -> f32 {
    with_font(|font| {
        let s = settings(wght, casl, slnt, mono, crsv);
        let coords = normalized(&font, &s);
        font.glyph_metrics(&coords)
            .scale(size_px)
            .advance_width(glyph_id as u16)
    })
    .unwrap_or(0.0)
}

/// Rasterize a glyph at a given axis tuple and size. Returns a flat Vec<u8>
/// laid out as:
///
///   bytes 0..2   width  (u16 LE)
///   bytes 2..4   height (u16 LE)
///   bytes 4..6   bearing_x (i16 LE)  — distance from pen origin to bitmap left
///   bytes 6..8   bearing_y (i16 LE)  — distance from baseline up to bitmap top
///   bytes 8..12  advance   (f32 LE)
///   bytes 12..   R8 alpha pixels, row-major, top-to-bottom, width*height bytes
///
/// Returns an empty Vec if the font isn't loaded or the glyph has no outline
/// (e.g. whitespace). The caller treats an empty atlas entry as "skip render
/// but still advance the pen by `glyph_advance`".
#[wasm_bindgen]
pub fn rasterize_glyph(
    glyph_id: u32,
    wght: f32,
    casl: f32,
    slnt: f32,
    mono: f32,
    crsv: f32,
    size_px: f32,
) -> Vec<u8> {
    let Some(result) = with_font(|font| {
        let s = settings(wght, casl, slnt, mono, crsv);
        let coords = normalized(&font, &s);
        let advance = font
            .glyph_metrics(&coords)
            .scale(size_px)
            .advance_width(glyph_id as u16);

        let image = SCALE_CTX.with(|ctx| {
            let mut ctx = ctx.borrow_mut();
            let mut scaler = ctx
                .builder(font)
                .size(size_px)
                .variations(s.iter().copied())
                .hint(false)
                .build();
            swash::scale::Render::new(&[swash::scale::Source::Outline])
                .format(swash::zeno::Format::Alpha)
                .render(&mut scaler, glyph_id as u16)
        });

        (image, advance)
    }) else {
        return Vec::new();
    };
    let (image, advance) = result;

    let Some(image) = image else {
        // Whitespace / no outline. Return a "metrics-only" header with 0×0
        // dims so JS can record advance and skip the GPU upload.
        let mut out = Vec::with_capacity(12);
        out.extend_from_slice(&0u16.to_le_bytes());
        out.extend_from_slice(&0u16.to_le_bytes());
        out.extend_from_slice(&0i16.to_le_bytes());
        out.extend_from_slice(&0i16.to_le_bytes());
        out.extend_from_slice(&advance.to_le_bytes());
        return out;
    };

    let w = image.placement.width as u16;
    let h = image.placement.height as u16;
    let bx = image.placement.left as i16;
    let by = image.placement.top as i16;

    let mut out = Vec::with_capacity(12 + image.data.len());
    out.extend_from_slice(&w.to_le_bytes());
    out.extend_from_slice(&h.to_le_bytes());
    out.extend_from_slice(&bx.to_le_bytes());
    out.extend_from_slice(&by.to_le_bytes());
    out.extend_from_slice(&advance.to_le_bytes());
    // swash returns the alpha plane directly when format is Alpha.
    out.extend_from_slice(&image.data);
    out
}

/// Font-level metrics (ascent / descent / line_gap / units_per_em) at a given
/// axis tuple. Returns [ascent, descent, line_gap, units_per_em] in font
/// units. The renderer needs these to position lines.
#[wasm_bindgen]
pub fn font_metrics(wght: f32, casl: f32, slnt: f32, mono: f32, crsv: f32) -> Vec<f32> {
    with_font(|font| {
        let s = settings(wght, casl, slnt, mono, crsv);
        let coords = normalized(&font, &s);
        let m = font.metrics(&coords);
        vec![m.ascent, m.descent, m.leading, m.units_per_em as f32]
    })
    .unwrap_or_else(|| vec![0.0, 0.0, 0.0, 1000.0])
}

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
    let t_eased = ease_t(t, curve_type);
    from.iter().zip(to.iter()).map(|(a, b)| a + (b - a) * t_eased).collect()
}

fn ease_t(t: f32, curve_type: u8) -> f32 {
    match curve_type {
        1 => {
            let t1 = t - 1.0;
            t1 * t1 * t1 + 1.0
        }
        2 => {
            let decay = (-5.0 * t).exp();
            1.0 - decay * (1.0 - t)
        }
        _ => t,
    }
}

/// Batched spring step for N groups × K axes.
///
/// `from`, `to` are flat arrays of length N*K (group-major: g0a0, g0a1, ..., g1a0, ...).
/// `stiffness` is per-group (length N).
/// Returns a flat Vec<f32> of length N*K + 1; the trailing element is 1.0 if any
/// component is still > epsilon from its target, else 0.0.
#[wasm_bindgen]
pub fn interpolate_batch(
    from: &[f32],
    to: &[f32],
    stiffness: &[f32],
    epsilon: f32,
    axes_per_group: u32,
    curve_type: u8,
) -> Vec<f32> {
    let n = from.len();
    let k = axes_per_group as usize;
    let groups = if k == 0 { 0 } else { n / k };
    let mut out = Vec::with_capacity(n + 1);
    let mut any_moving = 0.0f32;
    for g in 0..groups {
        let s = stiffness.get(g).copied().unwrap_or(0.08);
        let s_eased = ease_t(s, curve_type);
        for kk in 0..k {
            let i = g * k + kk;
            let a = from[i];
            let b = to[i];
            let delta = b - a;
            if delta.abs() < epsilon {
                out.push(b);
            } else {
                out.push(a + delta * s_eased);
                any_moving = 1.0;
            }
        }
    }
    out.push(any_moving);
    out
}

/// Radial bloom shaping for kinetic typography.
///
/// For each word with center (cx[i], cy[i]) and a mouse at (mouse_x, mouse_y),
/// compute target axis values via a smoothstep falloff (wider, smoother bloom
/// than a raw cubic):
///   raw  = max(0, 1 - dist/radius)
///   p    = smoothstep(raw)        // 3raw^2 - 2raw^3
///   wght = wght_min + p * wght_range
///   CASL = raw^2
///   slnt = -p * slnt_range
///   MONO = max(0, raw - 0.5) * 2  // engages from half-radius inward
///   CRSV = p
///
/// Returns a flat Vec<f32> of length N*5, ordered [wght, CASL, slnt, MONO, CRSV] per word.
#[wasm_bindgen]
pub fn compute_radial_targets(
    cx: &[f32],
    cy: &[f32],
    mouse_x: f32,
    mouse_y: f32,
    radius: f32,
    wght_min: f32,
    wght_range: f32,
    slnt_range: f32,
) -> Vec<f32> {
    let n = cx.len();
    let mut out = Vec::with_capacity(n * 5);
    let inv_r = if radius > 0.0 { 1.0 / radius } else { 0.0 };
    for i in 0..n {
        let dx = mouse_x - cx[i];
        let dy = mouse_y - cy[i];
        let dist = (dx * dx + dy * dy).sqrt();
        let raw = (1.0 - dist * inv_r).max(0.0);
        let p = raw * raw * (3.0 - 2.0 * raw);
        out.push(wght_min + p * wght_range);
        out.push(raw * raw);
        out.push(-p * slnt_range);
        out.push((raw - 0.5).max(0.0) * 2.0);
        out.push(p);
    }
    out
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

// ----- Plan-refinement layout primitive -----

/// Plan-refinement layout step: pairwise AABB rectangle separation + bounds
/// clamp, no group attraction or centering. Used by both the overview sim
/// (groups as rigid bodies in canvas bounds) and the drill sim (children in
/// a parent's content rect).
///
/// Inputs:
///   x, y              center coordinates (mutable on output)
///   w, h              block dimensions
///   vx, vy            current velocities
///   bounds_x/y/w/h    rectangular bounds the centers' AABBs must stay inside
///   repulsion         pairwise repulsion strength (e.g. 800.0)
///   damping           velocity damping per step (e.g. 0.85)
///   dt                time step (e.g. 1.0)
///
/// Returns flat Vec<f32> of length 4N: [x0, y0, vx0, vy0, x1, y1, vx1, vy1, ...]
#[wasm_bindgen]
pub fn rect_step(
    x: &[f32], y: &[f32], w: &[f32], h: &[f32],
    vx: &[f32], vy: &[f32],
    bounds_x: f32, bounds_y: f32, bounds_w: f32, bounds_h: f32,
    repulsion: f32, damping: f32, dt: f32,
) -> Vec<f32> {
    let n = x.len();
    let mut nx = vec![0f32; n];
    let mut ny = vec![0f32; n];
    let mut nvx = vec![0f32; n];
    let mut nvy = vec![0f32; n];

    // Margin between rectangles when at rest. Keeps a visible gap so adjacent
    // groups/blocks don't touch.
    const GAP: f32 = 12.0;

    for i in 0..n {
        let mut fx = 0f32;
        let mut fy = 0f32;

        for j in 0..n {
            if i == j { continue; }
            let dx = x[i] - x[j];
            let dy = y[i] - y[j];
            let overlap_x = (w[i] + w[j]) * 0.5 + GAP - dx.abs();
            let overlap_y = (h[i] + h[j]) * 0.5 + GAP - dy.abs();
            if overlap_x > 0.0 && overlap_y > 0.0 {
                // Push along the axis with the smaller overlap (minimum
                // translation vector) — separates rects cleanly along one
                // axis instead of diagonal sliding.
                if overlap_x < overlap_y {
                    let dir = if dx >= 0.0 { 1.0 } else { -1.0 };
                    fx += dir * overlap_x * repulsion * 0.001;
                } else {
                    let dir = if dy >= 0.0 { 1.0 } else { -1.0 };
                    fy += dir * overlap_y * repulsion * 0.001;
                }
            }
        }

        nvx[i] = (vx[i] + fx * dt) * damping;
        nvy[i] = (vy[i] + fy * dt) * damping;
        let cx = x[i] + nvx[i] * dt;
        let cy = y[i] + nvy[i] * dt;

        // Bounds clamp: keep the rect's AABB inside the bounds rect.
        // Velocity is preserved (just clamped to non-outward) so the rect can
        // still slide along a wall when peers push it sideways. Killing
        // velocity here would freeze rects against the wall before pairwise
        // separation finishes.
        let hw = w[i] * 0.5;
        let hh = h[i] * 0.5;
        let min_x = bounds_x + hw;
        let max_x = bounds_x + bounds_w - hw;
        let min_y = bounds_y + hh;
        let max_y = bounds_y + bounds_h - hh;
        if min_x <= max_x {
            if cx < min_x { nx[i] = min_x; if nvx[i] < 0.0 { nvx[i] = 0.0; } }
            else if cx > max_x { nx[i] = max_x; if nvx[i] > 0.0 { nvx[i] = 0.0; } }
            else { nx[i] = cx; }
        } else {
            nx[i] = (bounds_x + bounds_w) * 0.5;
            nvx[i] = 0.0;
        }
        if min_y <= max_y {
            if cy < min_y { ny[i] = min_y; if nvy[i] < 0.0 { nvy[i] = 0.0; } }
            else if cy > max_y { ny[i] = max_y; if nvy[i] > 0.0 { nvy[i] = 0.0; } }
            else { ny[i] = cy; }
        } else {
            ny[i] = (bounds_y + bounds_h) * 0.5;
            nvy[i] = 0.0;
        }
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
