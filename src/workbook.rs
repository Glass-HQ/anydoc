//! A spreadsheet as a viewer draws it: every sheet's cells with their
//! displayed text, the styles they use, merges, column widths, row heights
//! and frozen panes. [`to_workbook`](crate::to_workbook) reads it from the
//! same readers the Markdown conversion uses, so a value shows the same in
//! both.
//!
//! Formats that keep no presentation (CSV, OpenDocument spreadsheets) come
//! through with values and merges only.

/// One workbook, its sheets in tab order. Hidden sheets are left out, as
/// they are from Markdown.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Workbook {
    /// Visible sheets in tab order.
    pub sheets: Vec<Sheet>,
    /// Styles cells refer to by index. Index 0 is the default style.
    pub styles: Vec<CellStyle>,
}

/// One worksheet.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Sheet {
    /// The tab name.
    pub name: String,
    /// Cells with text or a non-default style, row by row.
    pub cells: Vec<SheetCell>,
    /// Inclusive merged regions, each covering more than one cell.
    pub merges: Vec<Region>,
    /// Column widths, in characters of the workbook's default font.
    pub columns: Axis,
    /// Row heights, in points.
    pub rows: Axis,
    /// Rows and columns kept in view while scrolling.
    pub frozen_rows: u32,
    /// Columns kept in view while scrolling sideways.
    pub frozen_columns: u32,
    /// Whether the sheet shows grid lines between cells.
    pub grid_lines: bool,
    /// Pictures and charts over the grid, in drawing order.
    pub drawings: Vec<Drawing>,
    /// List validations, shown as dropdowns.
    pub validations: Vec<Validation>,
    /// Tables and pivot tables.
    pub tables: Vec<SheetTable>,
}

/// A cell with something to show.
#[derive(Debug, Clone, PartialEq)]
pub struct SheetCell {
    /// Zero-based position.
    pub row: u32,
    /// Zero-based column.
    pub column: u32,
    /// The text the cell displays: its value through its number format.
    pub text: String,
    /// What the cell holds, for alignment and copying.
    pub kind: CellKind,
    /// Index into [`Workbook::styles`].
    pub style: u32,
    /// An external hyperlink target, already checked to be http(s) or mailto.
    pub link: Option<String>,
    /// A form control checkbox anchored in the cell: whether it's checked, and its caption.
    pub checkbox: Option<(bool, String)>,
    /// A conditional-format data bar drawn behind the value.
    pub bar: Option<DataBar>,
}

/// A data bar: how much of the cell's width it fills, and its color.
#[derive(Debug, Clone, PartialEq)]
pub struct DataBar {
    /// From 0 to 1.
    pub fraction: f64,
    /// `#rrggbb`.
    pub color: String,
}

/// Cells that take one of a list of values, which the viewer offers in a dropdown.
#[derive(Debug, Clone, PartialEq)]
pub struct Validation {
    /// The cells it covers.
    pub regions: Vec<Region>,
    /// The allowed values, in order.
    pub options: Vec<String>,
}

/// A table or pivot table on the sheet. Its look is already in the cells' styles.
#[derive(Debug, Clone, PartialEq)]
pub struct SheetTable {
    /// Its name in the workbook.
    pub name: String,
    /// The cells it covers, header included.
    pub region: Region,
    /// The header row shows filter buttons.
    pub filter: bool,
}

/// What a cell holds.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum CellKind {
    /// Nothing: the cell is listed for its style.
    #[default]
    Empty,
    /// A string.
    Text,
    /// A number, date or time, shown through its format.
    Number,
    /// TRUE or FALSE.
    Bool,
    /// An error literal such as `#DIV/0!`.
    Error,
}

/// An inclusive, zero-based cell range.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Region {
    /// First row.
    pub top: u32,
    /// First column.
    pub left: u32,
    /// Last row.
    pub bottom: u32,
    /// Last column.
    pub right: u32,
}

/// Sizes and visibility along one direction.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Axis {
    /// The size of any row or column not listed in `sizes`, when the file names one.
    pub default_size: Option<f64>,
    /// `(index, size)` overrides, sorted by index.
    pub sizes: Vec<(u32, f64)>,
    /// Hidden indexes, sorted.
    pub hidden: Vec<u32>,
}

/// How a cell looks. Colors are `#rrggbb`, with theme and indexed colors
/// already resolved.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct CellStyle {
    /// Bold text.
    pub bold: bool,
    /// Italic text.
    pub italic: bool,
    /// Underlined text.
    pub underline: bool,
    /// Struck-through text.
    pub strike: bool,
    /// A font other than the workbook's default.
    pub font_family: Option<String>,
    /// In points.
    pub font_size: Option<f64>,
    /// Text color.
    pub color: Option<String>,
    /// Background color.
    pub fill: Option<String>,
    /// Top edge.
    pub border_top: Option<Border>,
    /// Right edge.
    pub border_right: Option<Border>,
    /// Bottom edge.
    pub border_bottom: Option<Border>,
    /// Left edge.
    pub border_left: Option<Border>,
    /// Horizontal alignment; unset aligns by kind (numbers to the end).
    pub horizontal: Option<Align>,
    /// Vertical alignment; unset is the bottom.
    pub vertical: Option<Align>,
    /// Text wraps within the column instead of overflowing.
    pub wrap: bool,
    /// Indent level; each is about three characters wide.
    pub indent: u32,
}

/// One edge of a cell.
#[derive(Debug, Clone, PartialEq)]
pub struct Border {
    /// Unset is the text color.
    pub color: Option<String>,
    /// Line weight.
    pub width: BorderWidth,
    /// Dashed or dotted.
    pub dashed: bool,
    /// Two lines.
    pub double: bool,
}

/// A border's weight.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BorderWidth {
    /// 1px.
    Thin,
    /// 2px.
    Medium,
    /// 3px.
    Thick,
}

/// Alignment along one direction.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Align {
    /// Left or top.
    Start,
    /// Centered.
    Center,
    /// Right or bottom.
    End,
    /// Spread to both edges.
    Justify,
}

/// A picture or chart over the grid.
#[derive(Debug, Clone, PartialEq)]
pub struct Drawing {
    /// Where it sits.
    pub placement: Placement,
    /// What it shows.
    pub content: DrawingContent,
}

/// How a drawing is pinned to the grid.
#[derive(Debug, Clone, PartialEq)]
pub enum Placement {
    /// Stretched between two cell positions.
    Cells {
        /// Top-left corner.
        from: Anchor,
        /// Bottom-right corner.
        to: Anchor,
    },
    /// Starting at a cell position, with a fixed size in points.
    Sized {
        /// Top-left corner.
        from: Anchor,
        /// Width in points.
        width: f64,
        /// Height in points.
        height: f64,
    },
}

/// A position inside a cell.
#[derive(Debug, Clone, PartialEq)]
pub struct Anchor {
    /// Zero-based row.
    pub row: u32,
    /// Zero-based column.
    pub column: u32,
    /// Distance down from the row's top edge, in points.
    pub row_offset: f64,
    /// Distance across from the column's left edge, in points.
    pub column_offset: f64,
}

/// A drawing's content.
#[derive(Debug, Clone, PartialEq)]
pub enum DrawingContent {
    /// A picture in a format browsers show.
    Image {
        /// Such as `image/png`.
        media_type: String,
        /// The image file.
        data: Vec<u8>,
    },
    /// A chart, with the values it last showed.
    Chart(Chart),
}

/// A chart's data as its file cached it.
#[derive(Debug, Clone, PartialEq)]
pub struct Chart {
    /// The chart's title, when it shows one.
    pub title: Option<String>,
    /// Category labels along the axis, shared by every series.
    pub categories: Vec<String>,
    /// Data series, in plot order.
    pub series: Vec<ChartSeries>,
    /// Series stack on each other instead of sitting side by side.
    pub stacked: bool,
}

/// One series of values.
#[derive(Debug, Clone, PartialEq)]
pub struct ChartSeries {
    /// The legend name.
    pub name: Option<String>,
    /// How this series plots; a combo chart mixes kinds.
    pub kind: ChartKind,
    /// One value per category; gaps are `None`.
    pub values: Vec<Option<f64>>,
}

/// How a series is drawn.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ChartKind {
    /// Horizontal bars.
    Bar,
    /// Vertical bars.
    Column,
    /// Lines.
    Line,
    /// Filled areas.
    Area,
    /// A pie.
    Pie,
    /// A ring.
    Doughnut,
    /// Points.
    Scatter,
    /// A radar web.
    Radar,
}

use crate::model::{Block, CellSlot, Document, inlines_to_plain_text};

/// A workbook from a document's tables, for formats that keep values but no
/// presentation: each table is a sheet, named by the heading before it.
pub(crate) fn from_document(document: &Document) -> Workbook {
    let mut sheets = Vec::new();
    let mut name: Option<String> = None;
    for block in &document.blocks {
        match block {
            Block::Heading { content, .. } => name = Some(inlines_to_plain_text(content)),
            Block::Table(table) => {
                let mut sheet = Sheet {
                    name: name.take().unwrap_or_else(|| format!("Sheet{}", sheets.len() + 1)),
                    grid_lines: true,
                    ..Sheet::default()
                };
                for (row, slots) in table.grid.iter().enumerate() {
                    for (column, slot) in slots.iter().enumerate() {
                        let CellSlot::Origin(cell) = slot else { continue };
                        let (row, column) = (row as u32, column as u32);
                        if cell.col_span > 1 || cell.row_span > 1 {
                            sheet.merges.push(Region {
                                top: row,
                                left: column,
                                bottom: row + cell.row_span - 1,
                                right: column + cell.col_span - 1,
                            });
                        }
                        let text = blocks_text(&cell.blocks);
                        if text.is_empty() {
                            continue;
                        }
                        let kind = if text.trim().parse::<f64>().is_ok() {
                            CellKind::Number
                        } else {
                            CellKind::Text
                        };
                        sheet.cells.push(SheetCell {
                            row,
                            column,
                            text,
                            kind,
                            style: 0,
                            link: None,
                            checkbox: None,
                            bar: None,
                        });
                    }
                }
                sheets.push(sheet);
            }
            _ => {}
        }
    }
    Workbook { sheets, styles: vec![CellStyle::default()] }
}

fn blocks_text(blocks: &[Block]) -> String {
    let lines: Vec<String> = blocks
        .iter()
        .filter_map(|block| match block {
            Block::Paragraph(content) | Block::Heading { content, .. } => {
                Some(inlines_to_plain_text(content))
            }
            _ => None,
        })
        .collect();
    lines.join("\n")
}
