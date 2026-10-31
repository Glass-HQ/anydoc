//! What changes how cells look beyond their own style: conditional formats,
//! tables and pivot tables with their styles, and list validations. Each is
//! read from the worksheet and resolved into per-cell styles before the
//! viewer sees it, so the viewer never evaluates anything. Markdown never
//! reads this.
//!
//! Conditional rules are evaluated against the values the file stores, the
//! same values the cells display. Rules that need a formula engine
//! (`expression`, references to other sheets) are left out rather than
//! guessed.

use super::styles::{ViewStyles, parse_argb};
use crate::error::ConvertError;
use crate::package::Package;
use crate::package::path;
use crate::package::relationships::{TargetMode, read_rels, rels_part_for};
use crate::package::xml::{Element, ns};
use crate::workbook::{Border, BorderWidth, CellKind, CellStyle, DataBar, SheetCell};
use std::collections::{BTreeMap, HashMap};

const TABLE_REL: &str = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/table";
const PIVOT_REL: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/pivotTable";
/// Regions past this many cells are clipped: a rule over a whole column
/// should not cost a million evaluations.
const MAX_RULE_CELLS: u64 = 2_000_000;

type Area = (u32, u32, u32, u32);
/// A cell's displayed text, by sheet name and position.
pub(super) type SheetText<'a> = &'a dyn Fn(&str, (u32, u32)) -> Option<String>;
/// A cell a rule matched: its overlay style and its data bar.
type Match = ((u32, u32), Option<CellStyle>, Option<DataBar>);

/// Everything in a worksheet that shapes how its cells look.
#[derive(Default)]
pub(super) struct SheetRules {
    formats: Vec<(Vec<Area>, Vec<Rule>)>,
    pub(super) validations: Vec<(Vec<Area>, ListSource)>,
    tables: Vec<TableArea>,
}

impl SheetRules {
    pub(super) fn tables(&self) -> &[TableArea] {
        &self.tables
    }
}

pub(super) enum ListSource {
    Values(Vec<String>),
    /// A range, on this sheet or the one named.
    Range(Option<String>, Area),
}

struct Rule {
    priority: i64,
    stop: bool,
    dxf: Option<usize>,
    kind: RuleKind,
}

enum RuleKind {
    CellIs { operator: String, first: Operand, second: Option<Operand> },
    Text { operator: String, text: String },
    Blanks(bool),
    Errors(bool),
    Duplicates(bool),
    Top { rank: f64, percent: bool, bottom: bool },
    Average { above: bool, equal: bool },
    Scale(Vec<(Threshold, [u8; 3])>),
    Bar { min: Threshold, max: Threshold, color: String },
}

enum Operand {
    Number(f64),
    Text(String),
    Cell(u32, u32),
}

enum Threshold {
    Min,
    Max,
    Number(f64),
    Percent(f64),
    Percentile(f64),
}

pub(super) struct TableArea {
    pub(super) name: String,
    pub(super) area: Area,
    pub(super) header_rows: u32,
    pub(super) totals_row: bool,
    pub(super) style: String,
    pub(super) row_stripes: bool,
    pub(super) column_stripes: bool,
    pub(super) first_column: bool,
    pub(super) last_column: bool,
    pub(super) filter: bool,
}

/// Read a worksheet's rules, including the tables and pivot tables its part links to.
pub(super) fn read_rules(
    pkg: &mut Package,
    part: &str,
    worksheet: &Element,
    parse_region: impl Fn(&str) -> Option<Area>,
) -> Result<SheetRules, ConvertError> {
    let areas =
        |sqref: &str| -> Vec<Area> { sqref.split_whitespace().filter_map(&parse_region).collect() };
    let mut out = SheetRules::default();
    for block in worksheet.find_all(ns::SML, "conditionalFormatting") {
        let regions = areas(block.attr_unqualified("sqref").unwrap_or_default());
        let rules: Vec<Rule> =
            block.find_all(ns::SML, "cfRule").filter_map(|r| rule(r, &parse_region)).collect();
        if !regions.is_empty() && !rules.is_empty() {
            out.formats.push((regions, rules));
        }
    }
    for validation in worksheet
        .find_all(ns::SML, "dataValidations")
        .flat_map(|v| v.find_all(ns::SML, "dataValidation"))
    {
        // showDropDown="1" means the arrow is hidden, despite its name.
        if validation.attr_unqualified("type") != Some("list")
            || validation
                .attr_unqualified("showDropDown")
                .is_some_and(|v| matches!(v, "1" | "true"))
        {
            continue;
        }
        let Some(formula) = validation.find(ns::SML, "formula1").map(|f| f.text()) else {
            continue;
        };
        let formula = formula.trim();
        let source = if let Some(list) = formula.strip_prefix('"').and_then(|f| f.strip_suffix('"'))
        {
            ListSource::Values(
                list.split(',').map(|v| v.trim().to_string()).filter(|v| !v.is_empty()).collect(),
            )
        } else {
            let (sheet, range) = match formula.rsplit_once('!') {
                Some((sheet, range)) => (Some(sheet.trim_matches('\'').to_string()), range),
                None => (None, formula),
            };
            let Some(area) = parse_region(&range.replace('$', "")) else { continue };
            ListSource::Range(sheet, area)
        };
        let regions = areas(validation.attr_unqualified("sqref").unwrap_or_default());
        if !regions.is_empty() {
            out.validations.push((regions, source));
        }
    }
    let rels = read_rels(pkg, &rels_part_for(part))?;
    for (_, rel) in rels.iter() {
        if rel.mode == TargetMode::External
            || (rel.rel_type != TABLE_REL && rel.rel_type != PIVOT_REL)
        {
            continue;
        }
        let Ok(target) = path::resolve(part, &rel.target) else { continue };
        let Some(root) = pkg.optional_xml_part(&target.path)? else { continue };
        if let Some(table) = root.find(ns::SML, "table") {
            out.tables.extend(table_area(table, &parse_region));
        } else if let Some(pivot) = root.find(ns::SML, "pivotTableDefinition") {
            out.tables.extend(pivot_area(pivot, &parse_region));
        }
    }
    Ok(out)
}

fn flag(element: &Element, name: &str, default: bool) -> bool {
    element.attr_unqualified(name).map_or(default, |v| matches!(v, "1" | "true"))
}

fn table_area(table: &Element, parse_region: &impl Fn(&str) -> Option<Area>) -> Option<TableArea> {
    let area = parse_region(table.attr_unqualified("ref")?)?;
    let info = table.find(ns::SML, "tableStyleInfo");
    Some(TableArea {
        name: table
            .attr_unqualified("displayName")
            .or(table.attr_unqualified("name"))
            .unwrap_or_default()
            .to_string(),
        area,
        header_rows: table
            .attr_unqualified("headerRowCount")
            .and_then(|v| v.parse().ok())
            .unwrap_or(1),
        totals_row: table.attr_unqualified("totalsRowCount").is_some_and(|v| v != "0")
            || flag(table, "totalsRowShown", false)
                && table.attr_unqualified("totalsRowCount").is_some(),
        style: info
            .and_then(|i| i.attr_unqualified("name"))
            .unwrap_or("TableStyleMedium2")
            .to_string(),
        row_stripes: info.is_some_and(|i| flag(i, "showRowStripes", true)),
        column_stripes: info.is_some_and(|i| flag(i, "showColumnStripes", false)),
        first_column: info.is_some_and(|i| flag(i, "showFirstColumn", false)),
        last_column: info.is_some_and(|i| flag(i, "showLastColumn", false)),
        filter: table.find(ns::SML, "autoFilter").is_some(),
    })
}

fn pivot_area(pivot: &Element, parse_region: &impl Fn(&str) -> Option<Area>) -> Option<TableArea> {
    let location = pivot.find(ns::SML, "location")?;
    let area = parse_region(location.attr_unqualified("ref")?)?;
    let info = pivot.find(ns::SML, "pivotTableStyleInfo");
    let first_data_row =
        location.attr_unqualified("firstDataRow").and_then(|v| v.parse().ok()).unwrap_or(1u32);
    Some(TableArea {
        name: pivot.attr_unqualified("name").unwrap_or_default().to_string(),
        area,
        header_rows: first_data_row.max(1),
        // Pivot tables close with a grand total row unless it's turned off.
        totals_row: flag(pivot, "rowGrandTotals", true),
        style: info
            .and_then(|i| i.attr_unqualified("name"))
            .unwrap_or("PivotStyleLight16")
            .to_string(),
        row_stripes: info.is_some_and(|i| flag(i, "showRowStripes", false)),
        column_stripes: info.is_some_and(|i| flag(i, "showColStripes", false)),
        first_column: info.is_some_and(|i| flag(i, "showRowHeaders", true)),
        last_column: false,
        filter: false,
    })
}

fn rule(element: &Element, parse_region: &impl Fn(&str) -> Option<Area>) -> Option<Rule> {
    let attr = |name| element.attr_unqualified(name);
    let formulas: Vec<String> = element.find_all(ns::SML, "formula").map(|f| f.text()).collect();
    let operand = |text: &str| -> Option<Operand> {
        let text = text.trim();
        if let Ok(n) = text.parse::<f64>() {
            return Some(Operand::Number(n));
        }
        if let Some(s) = text.strip_prefix('"').and_then(|t| t.strip_suffix('"')) {
            return Some(Operand::Text(s.replace("\"\"", "\"")));
        }
        // A plain reference on the same sheet; anything else needs a formula engine.
        let (r, c, r2, c2) = parse_region(&text.replace('$', ""))?;
        (r == r2 && c == c2).then_some(Operand::Cell(r, c))
    };
    let threshold = |cfvo: &Element| -> Threshold {
        let value = cfvo.attr_unqualified("val").and_then(|v| v.parse::<f64>().ok()).unwrap_or(0.0);
        match cfvo.attr_unqualified("type") {
            Some("min") => Threshold::Min,
            Some("max") => Threshold::Max,
            Some("percent") => Threshold::Percent(value),
            Some("percentile") => Threshold::Percentile(value),
            _ => Threshold::Number(value),
        }
    };
    let color =
        |c: &Element| c.attr_unqualified("rgb").and_then(parse_argb).unwrap_or([0x63, 0x8e, 0xc6]);
    let kind = match attr("type")? {
        "cellIs" => RuleKind::CellIs {
            operator: attr("operator").unwrap_or("equal").to_string(),
            first: operand(formulas.first()?)?,
            second: formulas.get(1).and_then(|f| operand(f)),
        },
        "containsText" | "notContainsText" | "beginsWith" | "endsWith" => {
            RuleKind::Text { operator: attr("type")?.to_string(), text: attr("text")?.to_string() }
        }
        "containsBlanks" => RuleKind::Blanks(true),
        "notContainsBlanks" => RuleKind::Blanks(false),
        "containsErrors" => RuleKind::Errors(true),
        "notContainsErrors" => RuleKind::Errors(false),
        "duplicateValues" => RuleKind::Duplicates(true),
        "uniqueValues" => RuleKind::Duplicates(false),
        "top10" => RuleKind::Top {
            rank: attr("rank").and_then(|v| v.parse().ok()).unwrap_or(10.0),
            percent: flag(element, "percent", false),
            bottom: flag(element, "bottom", false),
        },
        "aboveAverage" => RuleKind::Average {
            above: flag(element, "aboveAverage", true),
            equal: flag(element, "equalAverage", false),
        },
        "colorScale" => {
            let scale = element.find(ns::SML, "colorScale")?;
            let stops: Vec<Threshold> = scale.find_all(ns::SML, "cfvo").map(threshold).collect();
            let colors: Vec<[u8; 3]> = scale.find_all(ns::SML, "color").map(color).collect();
            if stops.len() < 2 || stops.len() != colors.len() {
                return None;
            }
            RuleKind::Scale(stops.into_iter().zip(colors).collect())
        }
        "dataBar" => {
            let bar = element.find(ns::SML, "dataBar")?;
            let mut stops = bar.find_all(ns::SML, "cfvo").map(threshold);
            let [r, g, b] = bar.find(ns::SML, "color").map(color).unwrap_or([0x63, 0x8e, 0xc6]);
            RuleKind::Bar {
                min: stops.next().unwrap_or(Threshold::Min),
                max: stops.next().unwrap_or(Threshold::Max),
                color: format!("#{r:02x}{g:02x}{b:02x}"),
            }
        }
        _ => return None,
    };
    Some(Rule {
        priority: attr("priority").and_then(|v| v.parse().ok()).unwrap_or(i64::MAX),
        stop: flag(element, "stopIfTrue", false),
        dxf: attr("dxfId").and_then(|v| v.parse().ok()),
        kind,
    })
}

/// The cells of a set of regions that exist, clipped to the populated extent.
fn cells_in<'a>(
    areas: &'a [Area],
    cells: &'a BTreeMap<(u32, u32), SheetCell>,
) -> impl Iterator<Item = (u32, u32)> + 'a {
    let last_row = cells.keys().map(|&(r, _)| r).max().unwrap_or(0);
    let last_col = cells.keys().map(|&(_, c)| c).max().unwrap_or(0);
    let mut budget = MAX_RULE_CELLS;
    areas
        .iter()
        .flat_map(move |&(r1, c1, r2, c2)| {
            let rows = r1..=r2.min(last_row);
            rows.flat_map(move |r| (c1..=c2.min(last_col)).map(move |c| (r, c)))
        })
        .take_while(move |_| {
            budget = budget.saturating_sub(1);
            budget > 0
        })
}

/// Apply conditional formats, in Excel's order: rules of higher priority
/// (lower number) win where they disagree, and stop-if-true ends a cell's
/// evaluation.
pub(super) fn apply_formats(
    rules: &SheetRules,
    cells: &mut BTreeMap<(u32, u32), SheetCell>,
    numbers: &HashMap<(u32, u32), f64>,
    styles: &mut ViewStyles,
) {
    let mut all: Vec<(&[Area], &Rule)> = rules
        .formats
        .iter()
        .flat_map(|(areas, list)| list.iter().map(move |rule| (areas.as_slice(), rule)))
        .collect();
    all.sort_by_key(|(_, rule)| rule.priority);
    let mut stopped: std::collections::HashSet<(u32, u32)> = std::collections::HashSet::new();
    // Which overlays each cell gets, highest priority first.
    let mut overlays: HashMap<(u32, u32), Vec<CellStyle>> = HashMap::new();
    for (areas, rule) in all {
        let positions: Vec<(u32, u32)> =
            cells_in(areas, cells).filter(|p| !stopped.contains(p)).collect();
        let value = |p: &(u32, u32)| numbers.get(p).copied();
        let text = |p: &(u32, u32)| cells.get(p).map(|c| c.text.as_str()).unwrap_or("");
        let range_numbers: Vec<f64> = positions.iter().filter_map(value).collect();
        let resolve = |t: &Threshold, data: &[f64]| -> f64 {
            let (min, max) = data
                .iter()
                .fold((f64::INFINITY, f64::NEG_INFINITY), |(a, b), &v| (a.min(v), b.max(v)));
            match *t {
                Threshold::Min => min,
                Threshold::Max => max,
                Threshold::Number(n) => n,
                Threshold::Percent(p) => min + (max - min) * p / 100.0,
                Threshold::Percentile(p) => percentile(data, p),
            }
        };
        let mut matched: Vec<Match> = Vec::new();
        let dxf = rule.dxf.and_then(|i| styles.dxfs.get(i)).cloned();
        match &rule.kind {
            RuleKind::CellIs { operator, first, second } => {
                let operand_value = |o: &Operand| -> Option<Result<f64, String>> {
                    match o {
                        Operand::Number(n) => Some(Ok(*n)),
                        Operand::Text(t) => Some(Err(t.clone())),
                        Operand::Cell(r, c) => numbers
                            .get(&(*r, *c))
                            .map(|n| Ok(*n))
                            .or_else(|| cells.get(&(*r, *c)).map(|cell| Err(cell.text.clone()))),
                    }
                };
                let (Some(a), b) = (operand_value(first), second.as_ref().and_then(operand_value))
                else {
                    continue;
                };
                for p in &positions {
                    let hit = match (&a, value(p)) {
                        (Ok(a), Some(v)) => compare(
                            operator,
                            v,
                            *a,
                            b.as_ref().and_then(|b| b.as_ref().ok()).copied(),
                        ),
                        (Err(a), _) => {
                            let t = text(p).to_lowercase();
                            let a = a.to_lowercase();
                            match operator.as_str() {
                                "equal" => t == a,
                                "notEqual" => t != a,
                                _ => false,
                            }
                        }
                        _ => false,
                    };
                    if hit {
                        matched.push((*p, dxf.clone(), None));
                    }
                }
            }
            RuleKind::Text { operator, text: needle } => {
                let needle = needle.to_lowercase();
                for p in &positions {
                    let t = text(p).to_lowercase();
                    let hit = match operator.as_str() {
                        "containsText" => t.contains(&needle),
                        "notContainsText" => !t.contains(&needle),
                        "beginsWith" => t.starts_with(&needle),
                        _ => t.ends_with(&needle),
                    };
                    if hit {
                        matched.push((*p, dxf.clone(), None));
                    }
                }
            }
            RuleKind::Blanks(blank) => {
                for p in &positions {
                    if text(p).trim().is_empty() == *blank {
                        matched.push((*p, dxf.clone(), None));
                    }
                }
            }
            RuleKind::Errors(error) => {
                for p in &positions {
                    if cells.get(p).is_some_and(|c| c.kind == CellKind::Error) == *error {
                        matched.push((*p, dxf.clone(), None));
                    }
                }
            }
            RuleKind::Duplicates(duplicates) => {
                let mut counts: HashMap<String, u32> = HashMap::new();
                for p in &positions {
                    if !text(p).is_empty() {
                        *counts.entry(text(p).to_lowercase()).or_default() += 1;
                    }
                }
                for p in &positions {
                    let n = counts.get(&text(p).to_lowercase()).copied().unwrap_or(0);
                    if n > 0 && (n > 1) == *duplicates {
                        matched.push((*p, dxf.clone(), None));
                    }
                }
            }
            RuleKind::Top { rank, percent, bottom } => {
                let mut sorted = range_numbers.clone();
                sorted.sort_by(|a, b| if *bottom { a.total_cmp(b) } else { b.total_cmp(a) });
                let count = if *percent {
                    (sorted.len() as f64 * rank / 100.0).floor().max(1.0)
                } else {
                    *rank
                } as usize;
                let Some(&cutoff) = sorted.get(count.min(sorted.len()).saturating_sub(1)) else {
                    continue;
                };
                for p in &positions {
                    if let Some(v) = value(p)
                        && (if *bottom { v <= cutoff } else { v >= cutoff })
                    {
                        matched.push((*p, dxf.clone(), None));
                    }
                }
            }
            RuleKind::Average { above, equal } => {
                if range_numbers.is_empty() {
                    continue;
                }
                let mean = range_numbers.iter().sum::<f64>() / range_numbers.len() as f64;
                for p in &positions {
                    if let Some(v) = value(p) {
                        let hit =
                            (*above && v > mean) || (!*above && v < mean) || (*equal && v == mean);
                        if hit {
                            matched.push((*p, dxf.clone(), None));
                        }
                    }
                }
            }
            RuleKind::Scale(stops) => {
                let points: Vec<(f64, [u8; 3])> =
                    stops.iter().map(|(t, c)| (resolve(t, &range_numbers), *c)).collect();
                for p in &positions {
                    let Some(v) = value(p) else { continue };
                    let [r, g, b] = scale_color(&points, v);
                    let fill = CellStyle {
                        fill: Some(format!("#{r:02x}{g:02x}{b:02x}")),
                        ..CellStyle::default()
                    };
                    matched.push((*p, Some(fill), None));
                }
            }
            RuleKind::Bar { min, max, color } => {
                let (low, high) = (resolve(min, &range_numbers), resolve(max, &range_numbers));
                for p in &positions {
                    let Some(v) = value(p) else { continue };
                    let fraction =
                        if high > low { ((v - low) / (high - low)).clamp(0.0, 1.0) } else { 1.0 };
                    matched.push((*p, None, Some(DataBar { fraction, color: color.clone() })));
                }
            }
        }
        for (p, style, bar) in matched {
            if let Some(style) = style {
                overlays.entry(p).or_default().push(style);
            }
            if let Some(bar) = bar {
                cells.entry(p).or_insert_with(|| super::assemble::empty(p)).bar.get_or_insert(bar);
            }
            if rule.stop {
                stopped.insert(p);
            }
        }
    }
    for (p, list) in overlays {
        // Lowest priority first, so the highest priority is laid over the rest.
        let mut combined = CellStyle::default();
        for style in list.iter().rev() {
            super::styles::merge(&mut combined, style);
        }
        let cell = cells.entry(p).or_insert_with(|| super::assemble::empty(p));
        cell.style = styles.overlay(cell.style, &combined);
    }
}

fn compare(operator: &str, v: f64, a: f64, b: Option<f64>) -> bool {
    match operator {
        "between" => b.is_some_and(|b| v >= a.min(b) && v <= a.max(b)),
        "notBetween" => b.is_some_and(|b| v < a.min(b) || v > a.max(b)),
        "equal" => v == a,
        "notEqual" => v != a,
        "greaterThan" => v > a,
        "lessThan" => v < a,
        "greaterThanOrEqual" => v >= a,
        "lessThanOrEqual" => v <= a,
        _ => false,
    }
}

fn percentile(data: &[f64], p: f64) -> f64 {
    if data.is_empty() {
        return 0.0;
    }
    let mut sorted = data.to_vec();
    sorted.sort_by(f64::total_cmp);
    let rank = (p / 100.0).clamp(0.0, 1.0) * (sorted.len() - 1) as f64;
    let (lo, hi) = (rank.floor() as usize, rank.ceil() as usize);
    sorted[lo] + (sorted[hi] - sorted[lo]) * (rank - lo as f64)
}

fn scale_color(points: &[(f64, [u8; 3])], v: f64) -> [u8; 3] {
    let first = points[0];
    let last = points[points.len() - 1];
    if v <= first.0 {
        return first.1;
    }
    if v >= last.0 {
        return last.1;
    }
    for pair in points.windows(2) {
        let ((a, ca), (b, cb)) = (pair[0], pair[1]);
        if v >= a && v <= b {
            let t = if b > a { (v - a) / (b - a) } else { 0.0 };
            let mix =
                |x: u8, y: u8| (f64::from(x) + (f64::from(y) - f64::from(x)) * t).round() as u8;
            return [mix(ca[0], cb[0]), mix(ca[1], cb[1]), mix(ca[2], cb[2])];
        }
    }
    last.1
}

/// Lay each table's and pivot table's style under the cells it covers.
pub(super) fn apply_tables(
    rules: &SheetRules,
    cells: &mut BTreeMap<(u32, u32), SheetCell>,
    styles: &mut ViewStyles,
) {
    for table in &rules.tables {
        let look = table_look(&table.style, styles);
        let (r1, c1, r2, c2) = table.area;
        if u64::from(r2 - r1 + 1) * u64::from(c2 - c1 + 1) > MAX_RULE_CELLS {
            continue;
        }
        let body_start = r1 + table.header_rows;
        let body_end = if table.totals_row { r2.saturating_sub(1) } else { r2 };
        for r in r1..=r2 {
            for c in c1..=c2 {
                let mut style = look.whole.clone();
                if table.row_stripes
                    && r >= body_start
                    && r <= body_end
                    && (r - body_start) % 2 == 0
                {
                    super::styles::merge(&mut style, &look.row_stripe);
                }
                if table.column_stripes && r >= body_start && r <= body_end && (c - c1) % 2 == 0 {
                    super::styles::merge(&mut style, &look.column_stripe);
                }
                if table.first_column && c == c1 {
                    super::styles::merge(&mut style, &look.first_column);
                }
                if table.last_column && c == c2 {
                    super::styles::merge(&mut style, &look.first_column);
                }
                if r < body_start {
                    super::styles::merge(&mut style, &look.header);
                }
                if table.totals_row && r == r2 {
                    super::styles::merge(&mut style, &look.total);
                }
                if style == CellStyle::default() {
                    continue;
                }
                let cell = cells.entry((r, c)).or_insert_with(|| super::assemble::empty((r, c)));
                cell.style = styles.underlay(cell.style, &style);
            }
        }
    }
}

#[derive(Default)]
struct TableLook {
    whole: CellStyle,
    header: CellStyle,
    total: CellStyle,
    row_stripe: CellStyle,
    column_stripe: CellStyle,
    first_column: CellStyle,
}

fn thin(color: &str) -> Option<Border> {
    Some(Border {
        color: Some(color.to_string()),
        width: BorderWidth::Thin,
        dashed: false,
        double: false,
    })
}

/// A table style's look: the workbook's own custom style when it defines
/// one, else the built-in family it names, drawn from the theme's colors.
/// The built-ins follow Excel's gallery: Light, Medium and Dark, each in
/// rows of seven that cycle through black and the six accents.
fn table_look(name: &str, styles: &ViewStyles) -> TableLook {
    if let Some(parts) = styles.table_styles.get(name) {
        let part = |key: &str| {
            parts.get(key).and_then(|&i| styles.dxfs.get(i)).cloned().unwrap_or_default()
        };
        return TableLook {
            whole: part("wholeTable"),
            header: part("headerRow"),
            total: part("totalRow"),
            row_stripe: part("firstRowStripe"),
            column_stripe: part("firstColumnStripe"),
            first_column: part("firstColumn"),
        };
    }
    let lower = name.to_ascii_lowercase();
    let number: usize =
        lower.trim_start_matches(|c: char| !c.is_ascii_digit()).parse().unwrap_or(2);
    let family = if lower.contains("dark") {
        "dark"
    } else if lower.contains("light") {
        "light"
    } else {
        "medium"
    };
    let (group, accent) = ((number.saturating_sub(1)) / 7, (number.saturating_sub(1)) % 7);
    // Accent 0 is the text color; 1 to 6 are the theme accents (indexes 4 to 9).
    let color = |tint: f64| {
        if accent == 0 { styles.theme_color(1, tint) } else { styles.theme_color(accent + 3, tint) }
    };
    let white = Some("#ffffff".to_string());
    let bold = |fill: Option<String>, color: Option<String>| CellStyle {
        bold: true,
        fill,
        color,
        ..CellStyle::default()
    };
    let stripe = |tint: f64| CellStyle { fill: Some(color(tint)), ..CellStyle::default() };
    let underline_header =
        |c: String| CellStyle { bold: true, border_bottom: thin(&c), ..CellStyle::default() };
    let total = CellStyle {
        bold: true,
        border_top: Some(Border {
            color: Some(color(0.0)),
            width: BorderWidth::Thick,
            dashed: false,
            double: true,
        }),
        ..CellStyle::default()
    };
    let mut look = TableLook {
        total,
        first_column: CellStyle { bold: true, ..CellStyle::default() },
        ..TableLook::default()
    };
    match (family, group) {
        ("light", 0) => {
            look.header = underline_header(color(0.0));
            look.row_stripe = stripe(if accent == 0 { 0.85 } else { 0.8 });
            look.column_stripe = look.row_stripe.clone();
        }
        ("light", 1) => {
            look.header = bold(Some(color(0.0)), white);
            look.whole = CellStyle {
                border_top: thin(&color(0.0)),
                border_bottom: thin(&color(0.0)),
                ..CellStyle::default()
            };
        }
        ("light", _) => {
            let line = color(0.0);
            look.whole = CellStyle {
                border_top: thin(&line),
                border_bottom: thin(&line),
                border_left: thin(&line),
                border_right: thin(&line),
                ..CellStyle::default()
            };
            look.header = CellStyle { bold: true, ..CellStyle::default() };
            look.row_stripe = stripe(0.8);
            look.column_stripe = stripe(0.8);
        }
        ("medium", 0) => {
            look.header = bold(Some(color(0.0)), white);
            look.row_stripe = stripe(0.8);
            look.column_stripe = stripe(0.8);
            let line = color(0.4);
            look.whole = CellStyle {
                border_top: thin(&line),
                border_bottom: thin(&line),
                ..CellStyle::default()
            };
        }
        ("medium", 1) | ("medium", 2) => {
            look.header = bold(Some(styles.theme_color(1, 0.0)), white);
            look.whole = CellStyle { fill: Some(color(0.8)), ..CellStyle::default() };
            look.row_stripe = stripe(0.6);
            look.column_stripe = stripe(0.6);
        }
        ("medium", _) => {
            let line = color(0.4);
            look.whole = CellStyle {
                fill: Some(color(0.8)),
                border_top: thin(&line),
                border_bottom: thin(&line),
                border_left: thin(&line),
                border_right: thin(&line),
                ..CellStyle::default()
            };
            look.header = CellStyle { bold: true, ..CellStyle::default() };
            look.row_stripe = stripe(0.6);
            look.column_stripe = stripe(0.6);
        }
        _ => {
            look.header = bold(Some(styles.theme_color(1, 0.0)), white.clone());
            look.whole = CellStyle {
                fill: Some(color(-0.25)),
                color: white.clone(),
                ..CellStyle::default()
            };
            look.row_stripe = stripe(-0.5);
            look.column_stripe = stripe(-0.5);
            look.total = bold(Some(color(-0.5)), white);
        }
    }
    look
}

/// A list validation's options, resolved against the sheets' displayed values.
pub(super) fn list_options(
    source: &ListSource,
    own: &str,
    sheet_text: SheetText<'_>,
) -> Vec<String> {
    match source {
        ListSource::Values(values) => values.clone(),
        ListSource::Range(sheet, (r1, c1, r2, c2)) => {
            let sheet = sheet.as_deref().unwrap_or(own);
            let mut out = Vec::new();
            for r in *r1..=(*r2).min(r1 + 1_000) {
                for c in *c1..=(*c2).min(c1 + 50) {
                    if let Some(text) = sheet_text(sheet, (r, c)).filter(|t| !t.is_empty()) {
                        out.push(text);
                    }
                }
            }
            out
        }
    }
}
