#![deny(unsafe_op_in_unsafe_fn)]

use resvg::{tiny_skia, usvg};

fn render_svg(svg: &[u8], width: u32, height: u32, output: &mut [u8]) -> Result<(), ()> {
    let expected = (width as usize)
        .checked_mul(height as usize)
        .and_then(|pixels| pixels.checked_mul(4))
        .ok_or(())?;
    if width == 0 || height == 0 || width > 8192 || height > 8192 || output.len() != expected {
        return Err(());
    }
    let tree = usvg::Tree::from_data(svg, &usvg::Options::default()).map_err(|_| ())?;
    output.fill(0);
    let mut pixmap = tiny_skia::PixmapMut::from_bytes(output, width, height).ok_or(())?;
    resvg::render(&tree, tiny_skia::Transform::identity(), &mut pixmap);
    Ok(())
}

/// Renders one SVG frame into a caller-owned premultiplied RGBA8888 buffer.
/// Returns 0 on success. The caller owns both buffers for the entire call.
///
/// # Safety
/// `svg` must point to `svg_len` readable bytes and `output` to
/// `output_len` writable bytes. The two ranges must not overlap and must
/// remain valid for the duration of the call.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn flubber_svg_render(
    svg: *const u8,
    svg_len: usize,
    width: u32,
    height: u32,
    output: *mut u8,
    output_len: usize,
) -> i32 {
    if svg.is_null() || output.is_null() || svg_len == 0 || svg_len > 65536 {
        return -1;
    }
    let expected = (width as usize)
        .checked_mul(height as usize)
        .and_then(|pixels| pixels.checked_mul(4));
    if expected != Some(output_len) || output_len > 256 * 1024 * 1024 {
        return -1;
    }
    std::panic::catch_unwind(|| {
        // SAFETY: Pointer validity and non-aliasing are part of this C ABI's
        // caller contract; lengths and maximum allocation were checked above.
        let svg = unsafe { std::slice::from_raw_parts(svg, svg_len) };
        let output = unsafe { std::slice::from_raw_parts_mut(output, output_len) };
        render_svg(svg, width, height, output)
    })
    .map_or(-2, |result| if result.is_ok() { 0 } else { -1 })
}

#[cfg(test)]
mod tests {
    use super::render_svg;

    #[test]
    fn renders_svg_with_transparent_background_and_covered_center() {
        let svg = br#"<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><circle cx="16" cy="16" r="8" fill="red"/></svg>"#;
        let mut pixels = vec![0; 32 * 32 * 4];
        render_svg(svg, 32, 32, &mut pixels).unwrap();
        assert_eq!(pixels[3], 0);
        assert_eq!(pixels[(16 * 32 + 16) * 4], 255);
        assert_eq!(pixels[(16 * 32 + 16) * 4 + 3], 255);
    }
}
