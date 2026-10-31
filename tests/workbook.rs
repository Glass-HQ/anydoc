//! The viewer's workbook: every spreadsheet format reads into it, and the
//! xlsx reader brings styles, sizes and charts along.

use anydoc::workbook::{CellKind, ChartKind, DrawingContent};
use anydoc::{Format, to_workbook};

fn fixture(path: &str) -> Vec<u8> {
    std::fs::read(format!("{}/tests/fixtures/{path}", env!("CARGO_MANIFEST_DIR"))).unwrap()
}

#[test]
fn every_spreadsheet_format_reads_into_a_workbook() {
    for (path, format) in [
        ("xlsx/sheet.xlsx", Format::Excel),
        ("xls/sheet.xls", Format::Excel),
        ("xlsb/handmade-sheet.xlsb", Format::Excel),
        ("ods/sheet.ods", Format::Ods),
        ("csv/sheet.csv", Format::Csv),
    ] {
        let workbook = to_workbook(&fixture(path), format).unwrap();
        assert!(!workbook.sheets.is_empty(), "{path}");
        assert!(workbook.sheets.iter().any(|s| !s.cells.is_empty()), "{path}");
        assert_eq!(workbook.styles[0], Default::default(), "{path}: style 0 is the default");
        for sheet in &workbook.sheets {
            for cell in &sheet.cells {
                assert!((cell.style as usize) < workbook.styles.len(), "{path}");
            }
        }
    }
}

#[test]
fn xlsx_values_match_markdown() {
    let bytes = fixture("xlsx/sheet.xlsx");
    let markdown = anydoc::to_markdown_bytes(&bytes, Format::Excel).unwrap();
    let workbook = to_workbook(&bytes, Format::Excel).unwrap();
    for cell in workbook.sheets.iter().flat_map(|s| &s.cells).filter(|c| c.kind != CellKind::Empty)
    {
        assert!(
            markdown.contains(cell.text.trim()),
            "{:?} is missing from the Markdown",
            cell.text
        );
    }
}

#[test]
fn merges_survive() {
    let workbook = to_workbook(&fixture("xlsx/handmade-merged.xlsx"), Format::Excel).unwrap();
    assert_eq!(workbook.sheets[0].merges.len(), 2);
}

#[test]
fn charts_carry_their_cached_values() {
    let bytes = std::fs::read(format!(
        "{}/wasm/www/public/samples/workbook.xlsx",
        env!("CARGO_MANIFEST_DIR")
    ));
    let Ok(bytes) = bytes else { return };
    let workbook = to_workbook(&bytes, Format::Excel).unwrap();
    let charts: Vec<_> = workbook.sheets[0]
        .drawings
        .iter()
        .filter_map(|d| match &d.content {
            DrawingContent::Chart(chart) => Some(chart),
            DrawingContent::Image { .. } => None,
        })
        .collect();
    assert_eq!(charts.len(), 2);
    assert_eq!(charts[0].series[0].kind, ChartKind::Column);
    assert_eq!(charts[1].series[0].kind, ChartKind::Pie);
    assert_eq!(charts[1].series[0].values.len(), charts[1].categories.len());
}

#[test]
fn rules_tables_and_validations_resolve_into_cells() {
    let bytes =
        std::fs::read(format!("{}/tests/workbook/rules.xlsx", env!("CARGO_MANIFEST_DIR"))).unwrap();
    let workbook = to_workbook(&bytes, Format::Excel).unwrap();
    let sheet = &workbook.sheets[0];
    let cell = |row: u32, column: u32| {
        sheet.cells.iter().find(|c| c.row == row && c.column == column).unwrap()
    };
    let style = |row, column| &workbook.styles[cell(row, column).style as usize];

    // The table's header: TableStyleMedium2 is accent 1 (this theme: Office 2007) with white bold text.
    assert!(style(0, 0).bold);
    assert_eq!(style(0, 0).fill.as_deref(), Some("#4f81bd"));
    // cellIs > 70 turns Ada's 92 green and bold; Alan's 45 keeps the table's stripe.
    assert_eq!(style(1, 1).fill.as_deref(), Some("#c6efce"));
    assert_ne!(style(2, 1).fill.as_deref(), Some("#c6efce"));
    // containsText "Late" is red.
    assert_eq!(style(2, 2).fill.as_deref(), Some("#ffc7ce"));
    // The color scale runs red to green: lowest heat is the start color.
    assert_eq!(style(1, 3).fill.as_deref(), Some("#f8696b"));
    assert_eq!(style(3, 3).fill.as_deref(), Some("#63be7b"));
    // Data bars scale from min to max.
    assert_eq!(cell(1, 4).bar.as_ref().unwrap().fraction, 0.0);
    assert_eq!(cell(4, 4).bar.as_ref().unwrap().fraction, 1.0);
    // Duplicate names are italic.
    assert!(style(1, 0).italic && style(5, 0).italic && !style(2, 0).italic);

    assert_eq!(sheet.tables.len(), 1);
    assert!(sheet.tables[0].filter);
    let options: Vec<&Vec<String>> = sheet.validations.iter().map(|v| &v.options).collect();
    assert!(options.contains(&&vec!["Done".to_string(), "Late".into(), "Open".into()]));
    assert!(options.contains(&&vec!["Red".to_string(), "Green".into(), "Blue".into()]));
}
