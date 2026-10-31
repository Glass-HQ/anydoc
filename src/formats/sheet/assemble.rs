//! What the three readers hand back, and the two things made from it: the
//! document model (Markdown) and the viewer's [`Workbook`]. A workbook is
//! read once either way, so both show every value identically.

use super::rules::{self, SheetRules};
use super::styles::ViewStyles;
use super::xlsx::{SheetContent, build_table};
use crate::error::ConvertError;
use crate::model::{Block, Document, Inline};
use crate::workbook::{self, Axis, CellKind, Region, SheetCell, Workbook};
use std::collections::{BTreeMap, HashMap};

/// Presentation a reader collects alongside a sheet's values. Only the
/// SpreadsheetML reader fills it today; the binary readers leave it empty.
#[derive(Default)]
pub(super) struct SheetView {
    pub(super) kinds: HashMap<(u32, u32), CellKind>,
    /// The `cellXfs` index of every cell that names one, including empty styled cells.
    pub(super) xfs: HashMap<(u32, u32), u32>,
    /// Inclusive column ranges and their widths, in characters.
    pub(super) column_widths: Vec<(u32, u32, f64)>,
    pub(super) row_heights: Vec<(u32, f64)>,
    pub(super) default_column_width: Option<f64>,
    pub(super) default_row_height: Option<f64>,
    pub(super) frozen_rows: u32,
    pub(super) frozen_columns: u32,
    pub(super) hide_grid_lines: bool,
    pub(super) links: HashMap<(u32, u32), String>,
    pub(super) drawings: Vec<workbook::Drawing>,
    /// Stored numeric values, which conditional formats compare.
    pub(super) numbers: HashMap<(u32, u32), f64>,
    pub(super) rules: SheetRules,
}

/// A workbook as read: its visible sheets in order, and how many of them
/// couldn't be read at all.
pub(super) struct ReadWorkbook {
    pub(super) sheets: Vec<(String, SheetContent)>,
    pub(super) unreadable: usize,
    pub(super) styles: ViewStyles,
}

impl ReadWorkbook {
    fn check_readable(&self) -> Result<(), ConvertError> {
        if self.unreadable > 0 && self.sheets.is_empty() {
            return Err(ConvertError::malformed("no sheet in the workbook could be read"));
        }
        Ok(())
    }

    pub(super) fn into_document(self) -> Result<Document, ConvertError> {
        self.check_readable()?;
        let multi_sheet = self.sheets.len() + self.unreadable > 1;
        let mut doc = Document::default();
        // One budget for the workbook, so sheets cannot multiply the cap.
        let mut slots = 0u64;
        for (name, content) in self.sheets {
            let Some(table) = build_table(content, &mut slots)? else {
                continue;
            };
            if multi_sheet {
                doc.blocks.push(Block::heading(2, vec![Inline::plain(name)]));
            }
            doc.blocks.push(Block::Table(table));
        }
        Ok(doc)
    }

    pub(super) fn into_workbook(self) -> Result<Workbook, ConvertError> {
        self.check_readable()?;
        let mut styles = self.styles;
        // List validations may point at another sheet, so every sheet's values are read first.
        let texts: HashMap<String, HashMap<(u32, u32), String>> = self
            .sheets
            .iter()
            .map(|(name, content)| (name.clone(), content.cells.clone()))
            .collect();
        let lookup =
            |sheet: &str, at: (u32, u32)| texts.get(sheet).and_then(|t| t.get(&at)).cloned();
        let sheets = self
            .sheets
            .into_iter()
            .map(|(name, content)| sheet(name, content, &mut styles, &lookup))
            .collect();
        Ok(Workbook { sheets, styles: styles.styles })
    }
}

fn sheet(
    name: String,
    mut content: SheetContent,
    styles: &mut ViewStyles,
    lookup: rules::SheetText<'_>,
) -> workbook::Sheet {
    let view = std::mem::take(&mut content.view);
    let mut cells: BTreeMap<(u32, u32), SheetCell> = BTreeMap::new();
    for (at, text) in content.cells {
        let kind = view.kinds.get(&at).copied().unwrap_or(CellKind::Text);
        let entry = cells.entry(at).or_insert_with(|| empty(at));
        entry.text = text;
        entry.kind = kind;
    }
    for (&at, &xf) in &view.xfs {
        let style = styles.for_xf(xf as usize);
        if style != 0 {
            cells.entry(at).or_insert_with(|| empty(at)).style = style;
        }
    }
    for (at, link) in view.links {
        if let Some(entry) = cells.get_mut(&at) {
            entry.link = Some(link);
        }
    }
    for (at, boxes) in content.checkboxes {
        if let Some(first) = boxes.into_iter().next() {
            cells.entry(at).or_insert_with(|| empty(at)).checkbox =
                Some((first.checked, first.caption));
        }
    }

    rules::apply_tables(&view.rules, &mut cells, styles);
    rules::apply_formats(&view.rules, &mut cells, &view.numbers, styles);
    let region =
        |(top, left, bottom, right): (u32, u32, u32, u32)| Region { top, left, bottom, right };
    let validations = view
        .rules
        .validations
        .iter()
        .map(|(areas, source)| workbook::Validation {
            regions: areas.iter().copied().map(region).collect(),
            options: rules::list_options(source, &name, lookup),
        })
        .filter(|v| !v.options.is_empty())
        .collect();
    let tables = view
        .rules
        .tables()
        .iter()
        .map(|t| workbook::SheetTable {
            name: t.name.clone(),
            region: region(t.area),
            filter: t.filter,
        })
        .collect();

    let mut hidden_columns: Vec<u32> = Vec::new();
    for (lo, hi) in content.hidden_cols {
        hidden_columns.extend(lo..=hi.min(lo.saturating_add(16_384)));
    }
    hidden_columns.sort_unstable();
    hidden_columns.dedup();
    let mut hidden_rows: Vec<u32> = content.hidden_rows.into_iter().collect();
    hidden_rows.sort_unstable();

    let mut column_sizes: BTreeMap<u32, f64> = BTreeMap::new();
    for (lo, hi, width) in view.column_widths {
        // A range reaching the last column is a default for the rest of the sheet, not a list.
        for column in lo..=hi.min(lo.saturating_add(1024)) {
            column_sizes.insert(column, width);
        }
    }
    let mut row_heights = view.row_heights;
    row_heights.sort_unstable_by_key(|(row, _)| *row);
    row_heights.dedup_by_key(|(row, _)| *row);

    workbook::Sheet {
        name,
        cells: cells.into_values().collect(),
        merges: content
            .merges
            .into_iter()
            .map(|(top, left, bottom, right)| Region { top, left, bottom, right })
            .collect(),
        columns: Axis {
            default_size: view.default_column_width,
            sizes: column_sizes.into_iter().collect(),
            hidden: hidden_columns,
        },
        rows: Axis {
            default_size: view.default_row_height,
            sizes: row_heights,
            hidden: hidden_rows,
        },
        frozen_rows: view.frozen_rows,
        frozen_columns: view.frozen_columns,
        grid_lines: !view.hide_grid_lines,
        drawings: view.drawings,
        validations,
        tables,
    }
}

pub(super) fn empty((row, column): (u32, u32)) -> SheetCell {
    SheetCell {
        row,
        column,
        text: String::new(),
        kind: CellKind::Empty,
        style: 0,
        link: None,
        checkbox: None,
        bar: None,
    }
}
