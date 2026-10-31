//! What floats over a worksheet: pictures and charts in its DrawingML part,
//! each anchored to cells. Charts come with the values their caches hold,
//! which is what the file last showed, so nothing has to be recalculated.
//! Markdown never reads this; it only feeds [`crate::workbook`].

use crate::error::ConvertError;
use crate::package::Package;
use crate::package::path;
use crate::package::relationships::{Relationships, TargetMode, read_rels, rels_part_for};
use crate::package::xml::{Element, ns};
use crate::workbook::{Anchor, Chart, ChartKind, ChartSeries, Drawing, DrawingContent, Placement};

const DRAWING_REL: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing";
const XDR: &str = "http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing";
const EMU_PER_POINT: f64 = 12_700.0;
/// A sheet with more drawings than this is not one anybody looks at.
const MAX_DRAWINGS: usize = 1_000;

/// A worksheet's pictures and charts, in drawing order.
pub(super) fn read_drawings(
    pkg: &mut Package,
    sheet_part: &str,
) -> Result<Vec<Drawing>, ConvertError> {
    let sheet_rels = read_rels(pkg, &rels_part_for(sheet_part))?;
    let mut out = Vec::new();
    for (_, rel) in sheet_rels.iter() {
        if rel.rel_type != DRAWING_REL || rel.mode == TargetMode::External {
            continue;
        }
        let Ok(target) = path::resolve(sheet_part, &rel.target) else { continue };
        let Some(root) = pkg.optional_xml_part(&target.path)? else { continue };
        let Some(drawing) = root.find(XDR, "wsDr") else { continue };
        let rels = read_rels(pkg, &rels_part_for(&target.path))?;
        for anchor in drawing.child_elems() {
            if out.len() >= MAX_DRAWINGS {
                return Ok(out);
            }
            let Some(placement) = placement(anchor) else { continue };
            for item in anchor.child_elems() {
                if let Some(content) = content(pkg, item, &target.path, &rels)? {
                    out.push(Drawing { placement: placement.clone(), content });
                }
            }
        }
    }
    Ok(out)
}

fn placement(anchor: &Element) -> Option<Placement> {
    let point = |name: &str| -> Option<Anchor> {
        let at = anchor.find(XDR, name)?;
        let number =
            |child: &str| at.find(XDR, child).and_then(|e| e.text().trim().parse::<f64>().ok());
        Some(Anchor {
            row: number("row")? as u32,
            column: number("col")? as u32,
            row_offset: number("rowOff").unwrap_or(0.0) / EMU_PER_POINT,
            column_offset: number("colOff").unwrap_or(0.0) / EMU_PER_POINT,
        })
    };
    let size = |ext: &Element| {
        let emu =
            |name| ext.attr_unqualified(name).and_then(|v| v.parse::<f64>().ok()).unwrap_or(0.0);
        (emu("cx") / EMU_PER_POINT, emu("cy") / EMU_PER_POINT)
    };
    if anchor.is(XDR, "twoCellAnchor") {
        Some(Placement::Cells { from: point("from")?, to: point("to")? })
    } else if anchor.is(XDR, "oneCellAnchor") {
        let (width, height) = size(anchor.find(XDR, "ext")?);
        Some(Placement::Sized { from: point("from")?, width, height })
    } else {
        None
    }
}

fn content(
    pkg: &mut Package,
    item: &Element,
    drawing_part: &str,
    rels: &Relationships,
) -> Result<Option<DrawingContent>, ConvertError> {
    let internal = |id: &str| {
        rels.internal_target(id).and_then(|t| path::resolve(drawing_part, t).ok()).map(|t| t.path)
    };
    if item.is(XDR, "pic") {
        let Some(part) = item
            .first_descendant(ns::A, "blip")
            .and_then(|b| b.attr_qualified(ns::R, "embed"))
            .and_then(internal)
        else {
            return Ok(None);
        };
        let Some(media_type) = image_type(&part) else { return Ok(None) };
        let Some(data) = pkg.optional_part(&part)? else { return Ok(None) };
        return Ok(Some(DrawingContent::Image {
            media_type: media_type.to_string(),
            data: data.to_vec(),
        }));
    }
    if item.is(XDR, "graphicFrame") {
        let Some(part) = item
            .first_descendant(ns::CHART, "chart")
            .and_then(|c| c.attr_qualified(ns::R, "id"))
            .and_then(internal)
        else {
            return Ok(None);
        };
        let Some(root) = pkg.optional_xml_part(&part)? else { return Ok(None) };
        return Ok(root.find(ns::CHART, "chartSpace").and_then(chart).map(DrawingContent::Chart));
    }
    Ok(None)
}

/// Only formats a browser shows natively; EMF and WMF have no web renderer.
fn image_type(part: &str) -> Option<&'static str> {
    let extension = part.rsplit_once('.')?.1.to_ascii_lowercase();
    Some(match extension.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "bmp" => "image/bmp",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        _ => return None,
    })
}

fn chart(space: &Element) -> Option<Chart> {
    let chart = space.find(ns::CHART, "chart")?;
    let plot = chart.find(ns::CHART, "plotArea")?;
    let mut out = Chart {
        title: chart.find(ns::CHART, "title").map(rich_text).filter(|t| !t.is_empty()),
        categories: Vec::new(),
        series: Vec::new(),
        stacked: false,
    };
    for group in plot.child_elems() {
        let Some(kind) = chart_kind(group) else { continue };
        let grouping = group.find(ns::CHART, "grouping").and_then(|g| g.attr_unqualified("val"));
        out.stacked |= matches!(grouping, Some("stacked" | "percentStacked"));
        for series in group.find_all(ns::CHART, "ser") {
            let categories =
                series.find(ns::CHART, "cat").or_else(|| series.find(ns::CHART, "xVal"));
            if out.categories.is_empty()
                && let Some(categories) = categories
            {
                out.categories =
                    cached(categories).into_iter().map(Option::unwrap_or_default).collect();
            }
            let Some(values) =
                series.find(ns::CHART, "val").or_else(|| series.find(ns::CHART, "yVal"))
            else {
                continue;
            };
            out.series.push(ChartSeries {
                name: series
                    .find(ns::CHART, "tx")
                    .map(|tx| cached(tx).into_iter().flatten().collect::<Vec<_>>().join(" "))
                    .filter(|n| !n.is_empty()),
                kind,
                values: cached(values)
                    .into_iter()
                    .map(|v| v.and_then(|v| v.trim().parse::<f64>().ok()))
                    .collect(),
            });
        }
    }
    (!out.series.is_empty()).then_some(out)
}

fn chart_kind(group: &Element) -> Option<ChartKind> {
    if group.ns.as_deref() != Some(ns::CHART) {
        return None;
    }
    Some(match group.local.as_str() {
        "barChart" | "bar3DChart" => {
            match group.find(ns::CHART, "barDir").and_then(|d| d.attr_unqualified("val")) {
                Some("bar") => ChartKind::Bar,
                _ => ChartKind::Column,
            }
        }
        "lineChart" | "line3DChart" | "stockChart" => ChartKind::Line,
        "areaChart" | "area3DChart" => ChartKind::Area,
        "pieChart" | "pie3DChart" | "ofPieChart" => ChartKind::Pie,
        "doughnutChart" => ChartKind::Doughnut,
        "scatterChart" | "bubbleChart" => ChartKind::Scatter,
        "radarChart" => ChartKind::Radar,
        _ => return None,
    })
}

/// A data source's cached points by index, from a reference's cache or a literal.
fn cached(source: &Element) -> Vec<Option<String>> {
    if let Some(v) = source.find(ns::CHART, "v") {
        return vec![Some(v.text())];
    }
    let Some(cache) = source.descendant_elems().find(|e| {
        e.ns.as_deref() == Some(ns::CHART)
            && matches!(e.local.as_str(), "strCache" | "numCache" | "strLit" | "numLit")
    }) else {
        return Vec::new();
    };
    let count = cache
        .find(ns::CHART, "ptCount")
        .and_then(|c| c.attr_unqualified("val"))
        .and_then(|v| v.parse::<usize>().ok());
    let points: Vec<(usize, String)> = cache
        .find_all(ns::CHART, "pt")
        .filter_map(|pt| {
            Some((pt.attr_unqualified("idx")?.parse().ok()?, pt.find(ns::CHART, "v")?.text()))
        })
        .collect();
    let len =
        count.unwrap_or_else(|| points.iter().map(|(i, _)| i + 1).max().unwrap_or(0)).min(100_000);
    let mut out = vec![None; len];
    for (index, value) in points {
        if let Some(slot) = out.get_mut(index) {
            *slot = Some(value);
        }
    }
    out
}

fn rich_text(title: &Element) -> String {
    let paragraphs: Vec<String> = title
        .descendants(ns::A, "p")
        .map(|p| p.descendants(ns::A, "t").map(|t| t.text()).collect::<String>())
        .filter(|p| !p.is_empty())
        .collect();
    if !paragraphs.is_empty() {
        return paragraphs.join(" ");
    }
    title
        .find(ns::CHART, "tx")
        .map(|tx| cached(tx).into_iter().flatten().collect::<Vec<_>>().join(" "))
        .unwrap_or_default()
}
