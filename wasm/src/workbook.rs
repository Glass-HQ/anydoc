//! `toWorkbook`: a spreadsheet as a viewer draws it, serialized to plain JS
//! objects. Optional fields are left out rather than sent as null, so a large
//! sheet of plain cells stays small.

use serde::Serialize;
use wasm_bindgen::prelude::*;

use anydoc::workbook as wb;

use crate::Format;

/// Read a spreadsheet (`xlsx`, which also covers xls and xlsb, `ods` or
/// `csv`) for display: cells with their displayed text and styles, merges,
/// sizes, frozen panes, pictures and charts. Without a format, it is
/// detected from the content.
///
/// Throws an `Error` carrying a `ConvertErrorCode` on `code`.
#[wasm_bindgen(js_name = toWorkbook, unchecked_return_type = "Workbook")]
pub fn to_workbook(bytes: &[u8], format: Option<Format>) -> Result<JsValue, JsValue> {
    let workbook = anydoc::to_workbook(bytes, format.map(anydoc::Format::from))
        .map_err(crate::convert_error)?;
    serde_wasm_bindgen::to_value(&Workbook::from(workbook))
        .map_err(|error| js_sys::Error::new(&error.to_string()).into())
}

#[wasm_bindgen(typescript_custom_section)]
const TYPESCRIPT: &str = r#"
/** A spreadsheet as a viewer draws it. Hidden sheets are left out. */
export interface Workbook {
  sheets: Sheet[]
  /** Styles cells refer to by index. Index 0 is the default style. */
  styles: CellStyle[]
}

export interface Sheet {
  name: string
  /** Cells with text or a non-default style, row by row. */
  cells: SheetCell[]
  /** Inclusive merged regions. */
  merges: Region[]
  /** Column widths in characters of the default font. */
  columns: Axis
  /** Row heights in points. */
  rows: Axis
  frozenRows: number
  frozenColumns: number
  gridLines: boolean
  drawings: Drawing[]
  /** List validations, shown as dropdowns. */
  validations: { regions: Region[]; options: string[] }[]
  /** Tables and pivot tables; their look is already in the cells' styles. */
  tables: { name: string; region: Region; filter: boolean }[]
}

export interface SheetCell {
  /** Zero-based. */
  row: number
  column: number
  /** The displayed text: the value through its number format. */
  text: string
  kind: 'empty' | 'text' | 'number' | 'bool' | 'error'
  /** Index into `Workbook.styles`; absent is 0. */
  style?: number
  /** An http(s) or mailto hyperlink. */
  link?: string
  checkbox?: { checked: boolean; caption: string }
  /** A conditional-format data bar: the share of the width it fills, and its color. */
  bar?: { fraction: number; color: string }
}

export interface Region { top: number; left: number; bottom: number; right: number }

export interface Axis {
  defaultSize?: number
  /** `[index, size]` overrides, sorted by index. */
  sizes: [number, number][]
  /** Hidden indexes, sorted. */
  hidden: number[]
}

/** Colors are `#rrggbb`. */
export interface CellStyle {
  bold?: true
  italic?: true
  underline?: true
  strike?: true
  fontFamily?: string
  /** In points. */
  fontSize?: number
  color?: string
  fill?: string
  borderTop?: Border
  borderRight?: Border
  borderBottom?: Border
  borderLeft?: Border
  horizontal?: Align
  vertical?: Align
  wrap?: true
  indent?: number
}

export interface Border { color?: string; width: 'thin' | 'medium' | 'thick'; dashed?: true; double?: true }

export type Align = 'start' | 'center' | 'end' | 'justify'

export interface Drawing {
  placement:
    | { kind: 'cells'; from: Anchor; to: Anchor }
    | { kind: 'sized'; from: Anchor; width: number; height: number }
  content:
    | { kind: 'image'; mediaType: string; data: Uint8Array }
    | ({ kind: 'chart' } & Chart)
}

/** A position inside a cell; offsets in points. */
export interface Anchor { row: number; column: number; rowOffset: number; columnOffset: number }

export interface Chart {
  title?: string
  categories: string[]
  series: ChartSeries[]
  stacked: boolean
}

export interface ChartSeries {
  name?: string
  kind: 'bar' | 'column' | 'line' | 'area' | 'pie' | 'doughnut' | 'scatter' | 'radar'
  /** One per category; gaps are null. */
  values: (number | null)[]
}
"#;

const fn is_false(value: &bool) -> bool {
    !*value
}

const fn is_zero(value: &u32) -> bool {
    *value == 0
}

#[derive(Serialize)]
struct Workbook {
    sheets: Vec<Sheet>,
    styles: Vec<CellStyle>,
}

impl From<wb::Workbook> for Workbook {
    fn from(workbook: wb::Workbook) -> Self {
        Workbook {
            sheets: workbook.sheets.into_iter().map(Sheet::from).collect(),
            styles: workbook.styles.into_iter().map(CellStyle::from).collect(),
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Sheet {
    name: String,
    cells: Vec<SheetCell>,
    merges: Vec<Region>,
    columns: Axis,
    rows: Axis,
    frozen_rows: u32,
    frozen_columns: u32,
    grid_lines: bool,
    drawings: Vec<Drawing>,
    validations: Vec<Validation>,
    tables: Vec<SheetTable>,
}

#[derive(Serialize)]
struct Validation {
    regions: Vec<Region>,
    options: Vec<String>,
}

#[derive(Serialize)]
struct SheetTable {
    name: String,
    region: Region,
    filter: bool,
}

#[derive(Serialize)]
struct DataBar {
    fraction: f64,
    color: String,
}

impl From<wb::Sheet> for Sheet {
    fn from(sheet: wb::Sheet) -> Self {
        Sheet {
            name: sheet.name,
            cells: sheet.cells.into_iter().map(SheetCell::from).collect(),
            merges: sheet.merges.into_iter().map(Region::from).collect(),
            columns: sheet.columns.into(),
            rows: sheet.rows.into(),
            frozen_rows: sheet.frozen_rows,
            frozen_columns: sheet.frozen_columns,
            grid_lines: sheet.grid_lines,
            drawings: sheet.drawings.into_iter().map(Drawing::from).collect(),
            validations: sheet
                .validations
                .into_iter()
                .map(|v| Validation {
                    regions: v.regions.into_iter().map(Region::from).collect(),
                    options: v.options,
                })
                .collect(),
            tables: sheet
                .tables
                .into_iter()
                .map(|t| SheetTable { name: t.name, region: t.region.into(), filter: t.filter })
                .collect(),
        }
    }
}

#[derive(Serialize)]
struct SheetCell {
    row: u32,
    column: u32,
    text: String,
    kind: &'static str,
    #[serde(skip_serializing_if = "is_zero")]
    style: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    link: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    checkbox: Option<Checkbox>,
    #[serde(skip_serializing_if = "Option::is_none")]
    bar: Option<DataBar>,
}

#[derive(Serialize)]
struct Checkbox {
    checked: bool,
    caption: String,
}

impl From<wb::SheetCell> for SheetCell {
    fn from(cell: wb::SheetCell) -> Self {
        SheetCell {
            row: cell.row,
            column: cell.column,
            text: cell.text,
            kind: match cell.kind {
                wb::CellKind::Empty => "empty",
                wb::CellKind::Text => "text",
                wb::CellKind::Number => "number",
                wb::CellKind::Bool => "bool",
                wb::CellKind::Error => "error",
            },
            style: cell.style,
            link: cell.link,
            checkbox: cell.checkbox.map(|(checked, caption)| Checkbox { checked, caption }),
            bar: cell.bar.map(|b| DataBar { fraction: b.fraction, color: b.color }),
        }
    }
}

#[derive(Serialize)]
struct Region {
    top: u32,
    left: u32,
    bottom: u32,
    right: u32,
}

impl From<wb::Region> for Region {
    fn from(r: wb::Region) -> Self {
        Region { top: r.top, left: r.left, bottom: r.bottom, right: r.right }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Axis {
    #[serde(skip_serializing_if = "Option::is_none")]
    default_size: Option<f64>,
    sizes: Vec<(u32, f64)>,
    hidden: Vec<u32>,
}

impl From<wb::Axis> for Axis {
    fn from(axis: wb::Axis) -> Self {
        Axis { default_size: axis.default_size, sizes: axis.sizes, hidden: axis.hidden }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CellStyle {
    #[serde(skip_serializing_if = "is_false")]
    bold: bool,
    #[serde(skip_serializing_if = "is_false")]
    italic: bool,
    #[serde(skip_serializing_if = "is_false")]
    underline: bool,
    #[serde(skip_serializing_if = "is_false")]
    strike: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    font_family: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    font_size: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    fill: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    border_top: Option<Border>,
    #[serde(skip_serializing_if = "Option::is_none")]
    border_right: Option<Border>,
    #[serde(skip_serializing_if = "Option::is_none")]
    border_bottom: Option<Border>,
    #[serde(skip_serializing_if = "Option::is_none")]
    border_left: Option<Border>,
    #[serde(skip_serializing_if = "Option::is_none")]
    horizontal: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    vertical: Option<&'static str>,
    #[serde(skip_serializing_if = "is_false")]
    wrap: bool,
    #[serde(skip_serializing_if = "is_zero")]
    indent: u32,
}

fn align(align: wb::Align) -> &'static str {
    match align {
        wb::Align::Start => "start",
        wb::Align::Center => "center",
        wb::Align::End => "end",
        wb::Align::Justify => "justify",
    }
}

impl From<wb::CellStyle> for CellStyle {
    fn from(s: wb::CellStyle) -> Self {
        CellStyle {
            bold: s.bold,
            italic: s.italic,
            underline: s.underline,
            strike: s.strike,
            font_family: s.font_family,
            font_size: s.font_size,
            color: s.color,
            fill: s.fill,
            border_top: s.border_top.map(Border::from),
            border_right: s.border_right.map(Border::from),
            border_bottom: s.border_bottom.map(Border::from),
            border_left: s.border_left.map(Border::from),
            horizontal: s.horizontal.map(align),
            vertical: s.vertical.map(align),
            wrap: s.wrap,
            indent: s.indent,
        }
    }
}

#[derive(Serialize)]
struct Border {
    #[serde(skip_serializing_if = "Option::is_none")]
    color: Option<String>,
    width: &'static str,
    #[serde(skip_serializing_if = "is_false")]
    dashed: bool,
    #[serde(skip_serializing_if = "is_false")]
    double: bool,
}

impl From<wb::Border> for Border {
    fn from(b: wb::Border) -> Self {
        Border {
            color: b.color,
            width: match b.width {
                wb::BorderWidth::Thin => "thin",
                wb::BorderWidth::Medium => "medium",
                wb::BorderWidth::Thick => "thick",
            },
            dashed: b.dashed,
            double: b.double,
        }
    }
}

#[derive(Serialize)]
struct Drawing {
    placement: Placement,
    content: DrawingContent,
}

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum Placement {
    Cells { from: Anchor, to: Anchor },
    Sized { from: Anchor, width: f64, height: f64 },
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Anchor {
    row: u32,
    column: u32,
    row_offset: f64,
    column_offset: f64,
}

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum DrawingContent {
    #[serde(rename_all = "camelCase")]
    Image {
        media_type: String,
        data: serde_bytes::ByteBuf,
    },
    Chart(Chart),
}

#[derive(Serialize)]
struct Chart {
    #[serde(skip_serializing_if = "Option::is_none")]
    title: Option<String>,
    categories: Vec<String>,
    series: Vec<ChartSeries>,
    stacked: bool,
}

#[derive(Serialize)]
struct ChartSeries {
    #[serde(skip_serializing_if = "Option::is_none")]
    name: Option<String>,
    kind: &'static str,
    values: Vec<Option<f64>>,
}

impl From<wb::Anchor> for Anchor {
    fn from(a: wb::Anchor) -> Self {
        Anchor {
            row: a.row,
            column: a.column,
            row_offset: a.row_offset,
            column_offset: a.column_offset,
        }
    }
}

impl From<wb::Drawing> for Drawing {
    fn from(drawing: wb::Drawing) -> Self {
        Drawing {
            placement: match drawing.placement {
                wb::Placement::Cells { from, to } => {
                    Placement::Cells { from: from.into(), to: to.into() }
                }
                wb::Placement::Sized { from, width, height } => {
                    Placement::Sized { from: from.into(), width, height }
                }
            },
            content: match drawing.content {
                wb::DrawingContent::Image { media_type, data } => {
                    DrawingContent::Image { media_type, data: serde_bytes::ByteBuf::from(data) }
                }
                wb::DrawingContent::Chart(chart) => DrawingContent::Chart(Chart {
                    title: chart.title,
                    categories: chart.categories,
                    stacked: chart.stacked,
                    series: chart
                        .series
                        .into_iter()
                        .map(|s| ChartSeries {
                            name: s.name,
                            kind: match s.kind {
                                wb::ChartKind::Bar => "bar",
                                wb::ChartKind::Column => "column",
                                wb::ChartKind::Line => "line",
                                wb::ChartKind::Area => "area",
                                wb::ChartKind::Pie => "pie",
                                wb::ChartKind::Doughnut => "doughnut",
                                wb::ChartKind::Scatter => "scatter",
                                wb::ChartKind::Radar => "radar",
                            },
                            values: s.values,
                        })
                        .collect(),
                }),
            },
        }
    }
}
