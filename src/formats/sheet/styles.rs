//! SpreadsheetML presentation for the viewer: each `cellXfs` entry's font,
//! fill, borders and alignment, with theme and indexed colors resolved.
//! Markdown never reads this; it only feeds [`crate::workbook`].

use crate::package::xml::{Element, ns};
use crate::workbook::{Align, Border, BorderWidth, CellStyle};
use std::collections::HashMap;

/// The workbook's distinct cell styles, and which of them each `cellXfs`
/// entry uses. Style 0 is always the default, so unstyled cells cost nothing.
pub(super) struct ViewStyles {
    pub(super) styles: Vec<CellStyle>,
    pub(super) by_xf: Vec<u32>,
    /// Differential formats: the partial styles conditional formats and table styles apply.
    pub(super) dxfs: Vec<CellStyle>,
    /// Custom table styles by name: each element's dxf, such as `headerRow` or `firstRowStripe`.
    pub(super) table_styles: HashMap<String, HashMap<String, usize>>,
    /// Dark 1, light 1, dark 2, light 2, then accents 1 to 6.
    pub(super) theme: Vec<[u8; 3]>,
    seen: HashMap<StyleKey, u32>,
}

impl ViewStyles {
    pub(super) fn plain() -> ViewStyles {
        ViewStyles {
            styles: vec![CellStyle::default()],
            by_xf: Vec::new(),
            dxfs: Vec::new(),
            table_styles: HashMap::new(),
            theme: DEFAULT_THEME.to_vec(),
            seen: HashMap::from([(StyleKey::of(&CellStyle::default()), 0)]),
        }
    }

    pub(super) fn for_xf(&self, xf: usize) -> u32 {
        self.by_xf.get(xf).copied().unwrap_or(0)
    }

    /// A style's index, adding it when it's new.
    pub(super) fn intern(&mut self, style: CellStyle) -> u32 {
        let key = StyleKey::of(&style);
        if let Some(&id) = self.seen.get(&key) {
            return id;
        }
        self.styles.push(style);
        let id = (self.styles.len() - 1) as u32;
        self.seen.insert(key, id);
        id
    }

    /// `base` with whatever `overlay` sets laid over it.
    pub(super) fn overlay(&mut self, base: u32, overlay: &CellStyle) -> u32 {
        let mut style = self.styles.get(base as usize).cloned().unwrap_or_default();
        merge(&mut style, overlay);
        self.intern(style)
    }

    /// `base` with only the parts it doesn't set itself filled from `under`:
    /// a table style never covers a cell's own formatting.
    pub(super) fn underlay(&mut self, base: u32, under: &CellStyle) -> u32 {
        let mut style = under.clone();
        let own = self.styles.get(base as usize).cloned().unwrap_or_default();
        merge(&mut style, &own);
        self.intern(style)
    }

    /// A theme color by its index in cell XML order (light 1 first), with a tint.
    pub(super) fn theme_color(&self, index: usize, tint: f64) -> String {
        let slot = match index {
            0 => 1,
            1 => 0,
            2 => 3,
            3 => 2,
            n => n,
        };
        let [r, g, b] = apply_tint(self.theme.get(slot).copied().unwrap_or([0, 0, 0]), tint);
        format!("#{r:02x}{g:02x}{b:02x}")
    }

    pub(super) fn read(root: Option<&Element>, theme: Option<&Element>) -> ViewStyles {
        let Some(root) = root.and_then(|r| r.find(ns::SML, "styleSheet")) else {
            return ViewStyles::plain();
        };
        let palette = Palette::read(root, theme);
        let list = |parent: &str, child: &'static str| -> Vec<&Element> {
            root.find(ns::SML, parent)
                .map(|p| p.find_all(ns::SML, child).collect())
                .unwrap_or_default()
        };
        let fonts = list("fonts", "font");
        let fills = list("fills", "fill");
        let borders = list("borders", "border");
        // The default font sets no style of its own: cells show in the viewer's font unless they differ.
        let base_font = fonts.first().map(|f| font_parts(f, &palette)).unwrap_or_default();

        let mut out = ViewStyles::plain();
        out.theme = palette.theme.clone();
        out.dxfs = list("dxfs", "dxf").into_iter().map(|dxf| dxf_style(dxf, &palette)).collect();
        for table in list("tableStyles", "tableStyle") {
            let Some(name) = table.attr_unqualified("name") else { continue };
            let parts = table
                .find_all(ns::SML, "tableStyleElement")
                .filter_map(|e| {
                    Some((
                        e.attr_unqualified("type")?.to_string(),
                        e.attr_unqualified("dxfId")?.parse().ok()?,
                    ))
                })
                .collect();
            out.table_styles.insert(name.to_string(), parts);
        }
        for xf in list("cellXfs", "xf") {
            let index =
                |name| xf.attr_unqualified(name).and_then(|v| v.parse::<usize>().ok()).unwrap_or(0);
            let mut style = CellStyle::default();
            if let Some(font) = fonts.get(index("fontId")) {
                let font = font_parts(font, &palette);
                style.bold = font.bold;
                style.italic = font.italic;
                style.underline = font.underline;
                style.strike = font.strike;
                style.color = font.color.filter(|c| c != "#000000");
                style.font_family = font.family.filter(|f| Some(f) != base_font.family.as_ref());
                style.font_size = font.size.filter(|s| Some(*s) != base_font.size);
            }
            style.fill = fills.get(index("fillId")).and_then(|f| fill_color(f, &palette));
            if let Some(border) = borders.get(index("borderId")) {
                let side = |name| border.find(ns::SML, name).and_then(|e| border_side(e, &palette));
                style.border_top = side("top");
                style.border_bottom = side("bottom");
                style.border_left = side("left").or_else(|| side("start"));
                style.border_right = side("right").or_else(|| side("end"));
            }
            if let Some(alignment) = xf.find(ns::SML, "alignment") {
                style.horizontal = alignment.attr_unqualified("horizontal").and_then(align);
                // Bottom is where cells sit anyway.
                style.vertical = alignment
                    .attr_unqualified("vertical")
                    .filter(|v| *v != "bottom")
                    .and_then(align);
                style.wrap = alignment
                    .attr_unqualified("wrapText")
                    .is_some_and(|v| matches!(v, "1" | "true"));
                style.indent =
                    alignment.attr_unqualified("indent").and_then(|v| v.parse().ok()).unwrap_or(0);
            }
            let id = out.intern(style);
            out.by_xf.push(id);
        }
        out
    }
}

/// Lay everything `overlay` sets over `style`.
pub(super) fn merge(style: &mut CellStyle, overlay: &CellStyle) {
    style.bold |= overlay.bold;
    style.italic |= overlay.italic;
    style.underline |= overlay.underline;
    style.strike |= overlay.strike;
    style.wrap |= overlay.wrap;
    let take = |into: &mut Option<String>, from: &Option<String>| {
        if from.is_some() {
            into.clone_from(from);
        }
    };
    take(&mut style.font_family, &overlay.font_family);
    take(&mut style.color, &overlay.color);
    take(&mut style.fill, &overlay.fill);
    if overlay.font_size.is_some() {
        style.font_size = overlay.font_size;
    }
    for (into, from) in [
        (&mut style.border_top, &overlay.border_top),
        (&mut style.border_right, &overlay.border_right),
        (&mut style.border_bottom, &overlay.border_bottom),
        (&mut style.border_left, &overlay.border_left),
    ] {
        if from.is_some() {
            into.clone_from(from);
        }
    }
    if overlay.horizontal.is_some() {
        style.horizontal = overlay.horizontal;
    }
    if overlay.vertical.is_some() {
        style.vertical = overlay.vertical;
    }
    if overlay.indent != 0 {
        style.indent = overlay.indent;
    }
}

/// A differential format. Its fill names the color in `bgColor`, unlike a cell's own.
fn dxf_style(dxf: &Element, palette: &Palette) -> CellStyle {
    let mut style = CellStyle::default();
    if let Some(font) = dxf.find(ns::SML, "font") {
        let font = font_parts(font, palette);
        style.bold = font.bold;
        style.italic = font.italic;
        style.underline = font.underline;
        style.strike = font.strike;
        style.color = font.color;
    }
    if let Some(pattern) = dxf.find(ns::SML, "fill").and_then(|f| f.find(ns::SML, "patternFill")) {
        style.fill = pattern
            .find(ns::SML, "bgColor")
            .or_else(|| pattern.find(ns::SML, "fgColor"))
            .and_then(|c| palette.resolve(c));
    }
    if let Some(border) = dxf.find(ns::SML, "border") {
        let side = |name| border.find(ns::SML, name).and_then(|e| border_side(e, palette));
        style.border_top = side("top");
        style.border_bottom = side("bottom");
        style.border_left = side("left").or_else(|| side("start"));
        style.border_right = side("right").or_else(|| side("end"));
    }
    style
}

/// CellStyle holds floats, so it can't be a map key itself.
#[derive(PartialEq, Eq, Hash)]
struct StyleKey(String);

impl StyleKey {
    fn of(style: &CellStyle) -> StyleKey {
        StyleKey(format!("{style:?}"))
    }
}

#[derive(Default)]
struct FontParts {
    bold: bool,
    italic: bool,
    underline: bool,
    strike: bool,
    color: Option<String>,
    family: Option<String>,
    size: Option<f64>,
}

fn font_parts(font: &Element, palette: &Palette) -> FontParts {
    // A flag element is on unless its val says otherwise.
    let flag = |name| {
        font.find(ns::SML, name)
            .is_some_and(|e| !matches!(e.attr_unqualified("val"), Some("0" | "false" | "none")))
    };
    FontParts {
        bold: flag("b"),
        italic: flag("i"),
        underline: flag("u"),
        strike: flag("strike"),
        color: font.find(ns::SML, "color").and_then(|c| palette.resolve(c)),
        family: font
            .find(ns::SML, "name")
            .and_then(|e| e.attr_unqualified("val"))
            .map(str::to_string),
        size: font
            .find(ns::SML, "sz")
            .and_then(|e| e.attr_unqualified("val"))
            .and_then(|v| v.parse().ok()),
    }
}

fn fill_color(fill: &Element, palette: &Palette) -> Option<String> {
    let pattern = fill.find(ns::SML, "patternFill")?;
    match pattern.attr_unqualified("patternType") {
        None | Some("none") => None,
        // A solid fill paints its foreground; other patterns are approximated by it too.
        Some(_) => pattern
            .find(ns::SML, "fgColor")
            .and_then(|c| palette.resolve(c))
            .or_else(|| pattern.find(ns::SML, "bgColor").and_then(|c| palette.resolve(c))),
    }
}

fn border_side(side: &Element, palette: &Palette) -> Option<Border> {
    let style = side.attr_unqualified("style")?;
    let (width, dashed, double) = match style {
        "none" => return None,
        "thin" | "hair" => (BorderWidth::Thin, false, false),
        "dashed" | "dotted" | "dashDot" | "dashDotDot" => (BorderWidth::Thin, true, false),
        "medium" => (BorderWidth::Medium, false, false),
        "mediumDashed" | "mediumDashDot" | "mediumDashDotDot" | "slantDashDot" => {
            (BorderWidth::Medium, true, false)
        }
        "thick" => (BorderWidth::Thick, false, false),
        "double" => (BorderWidth::Thick, false, true),
        _ => (BorderWidth::Thin, false, false),
    };
    Some(Border {
        color: side.find(ns::SML, "color").and_then(|c| palette.resolve(c)),
        width,
        dashed,
        double,
    })
}

fn align(value: &str) -> Option<Align> {
    Some(match value {
        "left" | "top" => Align::Start,
        "center" | "centerContinuous" => Align::Center,
        "right" | "bottom" => Align::End,
        "justify" | "distributed" => Align::Justify,
        _ => return None,
    })
}

/// The colors a workbook can name: its theme's, and the indexed palette,
/// which the file may override.
pub(super) struct Palette {
    theme: Vec<[u8; 3]>,
    indexed: Vec<[u8; 3]>,
}

impl Palette {
    fn read(styles: &Element, theme: Option<&Element>) -> Palette {
        let mut indexed: Vec<[u8; 3]> = DEFAULT_INDEXED.to_vec();
        if let Some(custom) = styles.first_descendant(ns::SML, "indexedColors") {
            let colors: Vec<[u8; 3]> = custom
                .find_all(ns::SML, "rgbColor")
                .filter_map(|c| c.attr_unqualified("rgb").and_then(parse_argb))
                .collect();
            if !colors.is_empty() {
                indexed = colors;
            }
        }
        Palette {
            theme: theme.map(theme_colors).unwrap_or_else(|| DEFAULT_THEME.to_vec()),
            indexed,
        }
    }

    pub(super) fn resolve(&self, color: &Element) -> Option<String> {
        if color.attr_unqualified("auto").is_some_and(|v| matches!(v, "1" | "true")) {
            return None;
        }
        let base = if let Some(rgb) = color.attr_unqualified("rgb") {
            parse_argb(rgb)?
        } else if let Some(theme) =
            color.attr_unqualified("theme").and_then(|v| v.parse::<usize>().ok())
        {
            // The theme lists dark 1, light 1, dark 2, light 2; cells index them light first.
            let slot = match theme {
                0 => 1,
                1 => 0,
                2 => 3,
                3 => 2,
                n => n,
            };
            *self.theme.get(slot)?
        } else if let Some(index) =
            color.attr_unqualified("indexed").and_then(|v| v.parse::<usize>().ok())
        {
            // 64 is the system foreground and 65 the background: the viewer's own colors.
            *self.indexed.get(index)?
        } else {
            return None;
        };
        let tint =
            color.attr_unqualified("tint").and_then(|v| v.parse::<f64>().ok()).unwrap_or(0.0);
        let [r, g, b] = apply_tint(base, tint);
        Some(format!("#{r:02x}{g:02x}{b:02x}"))
    }
}

pub(super) fn parse_argb(value: &str) -> Option<[u8; 3]> {
    let hex = value.trim();
    let hex = if hex.len() == 8 { &hex[2..] } else { hex };
    if hex.len() != 6 {
        return None;
    }
    let byte = |i: usize| u8::from_str_radix(&hex[i..i + 2], 16).ok();
    Some([byte(0)?, byte(2)?, byte(4)?])
}

/// The twelve theme colors in the order `clrScheme` lists them.
fn theme_colors(theme: &Element) -> Vec<[u8; 3]> {
    let Some(scheme) = theme.first_descendant(ns::A, "clrScheme") else {
        return DEFAULT_THEME.to_vec();
    };
    let colors: Vec<[u8; 3]> = scheme
        .child_elems()
        .map(|slot| {
            slot.child_elems()
                .find_map(|c| {
                    if c.is(ns::A, "srgbClr") {
                        c.attr_unqualified("val").and_then(parse_argb)
                    } else if c.is(ns::A, "sysClr") {
                        c.attr_unqualified("lastClr").and_then(parse_argb)
                    } else {
                        None
                    }
                })
                .unwrap_or([0, 0, 0])
        })
        .collect();
    if colors.len() < 10 { DEFAULT_THEME.to_vec() } else { colors }
}

/// Excel's tint: toward white when positive, toward black when negative,
/// applied to HSL lightness.
pub(super) fn apply_tint([r, g, b]: [u8; 3], tint: f64) -> [u8; 3] {
    if tint == 0.0 {
        return [r, g, b];
    }
    let (h, s, l) = rgb_to_hsl(r, g, b);
    let l = if tint < 0.0 { l * (1.0 + tint) } else { l * (1.0 - tint) + tint };
    hsl_to_rgb(h, s, l.clamp(0.0, 1.0))
}

fn rgb_to_hsl(r: u8, g: u8, b: u8) -> (f64, f64, f64) {
    let (r, g, b) = (f64::from(r) / 255.0, f64::from(g) / 255.0, f64::from(b) / 255.0);
    let max = r.max(g).max(b);
    let min = r.min(g).min(b);
    let l = (max + min) / 2.0;
    if max == min {
        return (0.0, 0.0, l);
    }
    let d = max - min;
    let s = if l > 0.5 { d / (2.0 - max - min) } else { d / (max + min) };
    let h = if max == r {
        (g - b) / d + if g < b { 6.0 } else { 0.0 }
    } else if max == g {
        (b - r) / d + 2.0
    } else {
        (r - g) / d + 4.0
    };
    (h / 6.0, s, l)
}

fn hsl_to_rgb(h: f64, s: f64, l: f64) -> [u8; 3] {
    if s == 0.0 {
        let v = (l * 255.0).round() as u8;
        return [v, v, v];
    }
    let q = if l < 0.5 { l * (1.0 + s) } else { l + s - l * s };
    let p = 2.0 * l - q;
    let channel = |mut t: f64| {
        if t < 0.0 {
            t += 1.0;
        }
        if t > 1.0 {
            t -= 1.0;
        }
        let v = if t < 1.0 / 6.0 {
            p + (q - p) * 6.0 * t
        } else if t < 0.5 {
            q
        } else if t < 2.0 / 3.0 {
            p + (q - p) * (2.0 / 3.0 - t) * 6.0
        } else {
            p
        };
        (v * 255.0).round() as u8
    };
    [channel(h + 1.0 / 3.0), channel(h), channel(h - 1.0 / 3.0)]
}

/// Office's default theme, for workbooks that carry none.
const DEFAULT_THEME: [[u8; 3]; 12] = [
    [0x00, 0x00, 0x00],
    [0xff, 0xff, 0xff],
    [0x44, 0x54, 0x6a],
    [0xe7, 0xe6, 0xe6],
    [0x44, 0x72, 0xc4],
    [0xed, 0x7d, 0x31],
    [0xa5, 0xa5, 0xa5],
    [0xff, 0xc0, 0x00],
    [0x5b, 0x9b, 0xd5],
    [0x70, 0xad, 0x47],
    [0x05, 0x63, 0xc1],
    [0x95, 0x4f, 0x72],
];

/// The legacy 64-color palette ([MS-OI29500] 2.1.590).
const DEFAULT_INDEXED: [[u8; 3]; 64] = [
    [0x00, 0x00, 0x00],
    [0xff, 0xff, 0xff],
    [0xff, 0x00, 0x00],
    [0x00, 0xff, 0x00],
    [0x00, 0x00, 0xff],
    [0xff, 0xff, 0x00],
    [0xff, 0x00, 0xff],
    [0x00, 0xff, 0xff],
    [0x00, 0x00, 0x00],
    [0xff, 0xff, 0xff],
    [0xff, 0x00, 0x00],
    [0x00, 0xff, 0x00],
    [0x00, 0x00, 0xff],
    [0xff, 0xff, 0x00],
    [0xff, 0x00, 0xff],
    [0x00, 0xff, 0xff],
    [0x80, 0x00, 0x00],
    [0x00, 0x80, 0x00],
    [0x00, 0x00, 0x80],
    [0x80, 0x80, 0x00],
    [0x80, 0x00, 0x80],
    [0x00, 0x80, 0x80],
    [0xc0, 0xc0, 0xc0],
    [0x80, 0x80, 0x80],
    [0x99, 0x99, 0xff],
    [0x99, 0x33, 0x66],
    [0xff, 0xff, 0xcc],
    [0xcc, 0xff, 0xff],
    [0x66, 0x00, 0x66],
    [0xff, 0x80, 0x80],
    [0x00, 0x66, 0xcc],
    [0xcc, 0xcc, 0xff],
    [0x00, 0x00, 0x80],
    [0xff, 0x00, 0xff],
    [0xff, 0xff, 0x00],
    [0x00, 0xff, 0xff],
    [0x80, 0x00, 0x80],
    [0x80, 0x00, 0x00],
    [0x00, 0x80, 0x80],
    [0x00, 0x00, 0xff],
    [0x00, 0xcc, 0xff],
    [0xcc, 0xff, 0xff],
    [0xcc, 0xff, 0xcc],
    [0xff, 0xff, 0x99],
    [0x99, 0xcc, 0xff],
    [0xff, 0x99, 0xcc],
    [0xcc, 0x99, 0xff],
    [0xff, 0xcc, 0x99],
    [0x33, 0x66, 0xff],
    [0x33, 0xcc, 0xcc],
    [0x99, 0xcc, 0x00],
    [0xff, 0xcc, 0x00],
    [0xff, 0x99, 0x00],
    [0xff, 0x66, 0x00],
    [0x66, 0x66, 0x99],
    [0x96, 0x96, 0x96],
    [0x00, 0x33, 0x66],
    [0x33, 0x99, 0x66],
    [0x00, 0x33, 0x00],
    [0x33, 0x33, 0x00],
    [0x99, 0x33, 0x00],
    [0x99, 0x33, 0x66],
    [0x33, 0x33, 0x99],
    [0x33, 0x33, 0x33],
];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tints_lighten_and_darken() {
        assert_eq!(apply_tint([0x44, 0x72, 0xc4], 0.0), [0x44, 0x72, 0xc4]);
        assert_eq!(apply_tint([0, 0, 0], 0.5), [0x80, 0x80, 0x80]);
        assert_eq!(apply_tint([0xff, 0xff, 0xff], -0.5), [0x80, 0x80, 0x80]);
    }

    #[test]
    fn argb_drops_alpha() {
        assert_eq!(parse_argb("FF4472C4"), Some([0x44, 0x72, 0xc4]));
        assert_eq!(parse_argb("4472C4"), Some([0x44, 0x72, 0xc4]));
        assert_eq!(parse_argb("nope"), None);
    }
}
