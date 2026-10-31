import { toWorkbook, type CellStyle, type Drawing, type Region, type Sheet, type SheetCell, type Workbook } from "../../core/parse.js";
import type { RenderFunction, Searchable } from "../renderer.js";
import { chartSvg } from "./chart.js";

const HEADER_HEIGHT = 22;
const HEADER_WIDTH = 46;
const DEFAULT_ROW = 20;
const DEFAULT_COLUMN = 64;
const MIN_ROWS = 100;
const MIN_COLUMNS = 26;
const OVERSCAN = 4;

/**
 * Every spreadsheet format in one grid. Only the cells in view exist in the
 * DOM; headers and frozen panes stay put through sticky positioning, so they
 * never lag behind a fast scroll. Values come from the core, already shown
 * through their number formats.
 */
export const render: RenderFunction = async ({ element, bytes, format, name, signal, options, onPosition }) => {
  const workbook = await toWorkbook({ bytes, format, name }, { signal });
  if (workbook.sheets.length === 0) workbook.sheets.push({ name: "Sheet1", cells: [], merges: [], columns: { sizes: [], hidden: [] }, rows: { sizes: [], hidden: [] }, frozenRows: 0, frozenColumns: 0, gridLines: true, drawings: [], validations: [], tables: [] });
  const grid = new Grid(element, workbook, options.onLink);
  grid.show(0);
  return {
    sheets: {
      names: workbook.sheets.map((sheet) => sheet.name),
      select: (index) => grid.show(index),
    },
    zoom: { min: 0.25, max: 4, apply: (value) => grid.setZoom(value) },
    search: gridSearch(grid, workbook, (sheet) => onPosition({ sheet })),
    destroy: () => grid.destroy(),
  };
};

/** Positions along one axis: prefix sums over sizes, with hidden entries at zero. */
class AxisLayout {
  readonly starts: Float64Array;

  constructor(count: number, size: (index: number) => number) {
    this.starts = new Float64Array(count + 1);
    for (let i = 0; i < count; i += 1) this.starts[i + 1] = this.starts[i]! + size(i);
  }

  get count() {
    return this.starts.length - 1;
  }

  start(index: number) {
    return this.starts[Math.min(index, this.count)]!;
  }

  size(index: number) {
    return this.start(index + 1) - this.start(index);
  }

  /** The index at a position. */
  at(position: number): number {
    let low = 0;
    let high = this.count - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if (this.starts[mid]! <= position) low = mid;
      else high = mid - 1;
    }
    return low;
  }
}

/** Excel's own width conversion: characters of the default font to pixels. */
const columnPixels = (characters: number) => Math.round(characters * 7 + 5);
const pointPixels = (points: number) => Math.round((points * 4) / 3);

interface SheetLayout {
  readonly sheet: Sheet;
  readonly rows: AxisLayout;
  readonly columns: AxisLayout;
  /** Cells by row, each row sorted by column. */
  readonly byRow: Map<number, SheetCell[]>;
  /** Merge origins by `row:column`, and every covered position. */
  readonly merges: Map<string, Region>;
  readonly covered: Set<string>;
  readonly frozenHeight: number;
  readonly frozenWidth: number;
  /** List validation options by `row:column`. */
  readonly lists: Map<string, readonly string[]>;
  /** Table header cells that show a filter button. */
  readonly filters: Set<string>;
}

function layout(sheet: Sheet): SheetLayout {
  let lastRow = 0;
  let lastColumn = 0;
  for (const cell of sheet.cells) {
    lastRow = Math.max(lastRow, cell.row);
    lastColumn = Math.max(lastColumn, cell.column);
  }
  for (const merge of sheet.merges) {
    lastRow = Math.max(lastRow, merge.bottom);
    lastColumn = Math.max(lastColumn, merge.right);
  }
  for (const drawing of sheet.drawings) {
    const to = drawing.placement.kind === "cells" ? drawing.placement.to : drawing.placement.from;
    lastRow = Math.max(lastRow, to.row + 1);
    lastColumn = Math.max(lastColumn, to.column + 1);
  }
  const rowSizes = new Map(sheet.rows.sizes);
  const columnSizes = new Map(sheet.columns.sizes);
  const hiddenRows = new Set(sheet.rows.hidden);
  const hiddenColumns = new Set(sheet.columns.hidden);
  const defaultRow = sheet.rows.defaultSize === undefined ? DEFAULT_ROW : pointPixels(sheet.rows.defaultSize);
  const defaultColumn = sheet.columns.defaultSize === undefined ? DEFAULT_COLUMN : columnPixels(sheet.columns.defaultSize);
  const rows = new AxisLayout(Math.max(MIN_ROWS, lastRow + 20), (i) => (hiddenRows.has(i) ? 0 : rowSizes.has(i) ? pointPixels(rowSizes.get(i)!) : defaultRow));
  const columns = new AxisLayout(Math.max(MIN_COLUMNS, lastColumn + 5), (i) => (hiddenColumns.has(i) ? 0 : columnSizes.has(i) ? columnPixels(columnSizes.get(i)!) : defaultColumn));
  const byRow = new Map<number, SheetCell[]>();
  for (const cell of sheet.cells) {
    const row = byRow.get(cell.row);
    if (row) row.push(cell);
    else byRow.set(cell.row, [cell]);
  }
  const merges = new Map<string, Region>();
  const covered = new Set<string>();
  for (const merge of sheet.merges) {
    merges.set(`${merge.top}:${merge.left}`, merge);
    // Merges are bounded by the file's extent, which the core already caps.
    for (let r = merge.top; r <= merge.bottom; r += 1) for (let c = merge.left; c <= merge.right; c += 1) if (r !== merge.top || c !== merge.left) covered.add(`${r}:${c}`);
  }
  // Validations and filters are looked up per drawn cell; a region over a whole column stops at the sheet's extent.
  const lists = new Map<string, readonly string[]>();
  for (const validation of sheet.validations) {
    for (const region of validation.regions) {
      for (let r = region.top; r <= Math.min(region.bottom, lastRow + 20); r += 1)
        for (let c = region.left; c <= Math.min(region.right, lastColumn + 5); c += 1) lists.set(`${r}:${c}`, validation.options);
    }
  }
  const filters = new Set<string>();
  for (const table of sheet.tables) {
    if (!table.filter) continue;
    for (let c = table.region.left; c <= table.region.right; c += 1) filters.add(`${table.region.top}:${c}`);
  }
  return {
    sheet,
    rows,
    columns,
    byRow,
    merges,
    covered,
    lists,
    filters,
    frozenHeight: rows.start(sheet.frozenRows),
    frozenWidth: columns.start(sheet.frozenColumns),
  };
}

const columnName = (index: number) => {
  let name = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
};

class Grid {
  readonly doc: Document;
  readonly root: HTMLDivElement;
  readonly areas: Record<"corner" | "top" | "left" | "body", HTMLDivElement>;
  readonly styleCss: string[];
  readonly urls: string[] = [];
  current: SheetLayout | undefined;
  #layouts = new Map<number, SheetLayout>();
  #zoom = 1;
  #frame = 0;
  #selected: string | undefined;

  constructor(
    readonly element: HTMLElement,
    readonly workbook: Workbook,
    readonly onLink: ((url: string) => void) | undefined,
  ) {
    this.doc = element.ownerDocument;
    this.root = this.doc.createElement("div");
    this.root.className = "documents-grid";
    this.areas = {
      corner: this.area("corner"),
      top: this.area("top"),
      left: this.area("left"),
      body: this.area("body"),
    };
    this.root.append(this.areas.corner, this.areas.top, this.areas.left, this.areas.body);
    this.styleCss = workbook.styles.map(styleCss);
    element.replaceChildren(this.root);
    element.addEventListener("scroll", this.schedule, { passive: true });
    this.root.addEventListener("click", this.click);
    this.resize.observe(element);
  }

  readonly resize = new ResizeObserver(() => this.schedule());

  area(name: string) {
    const area = this.doc.createElement("div");
    area.className = `documents-grid-${name}`;
    return area;
  }

  show(index: number) {
    let next = this.#layouts.get(index);
    if (!next) {
      next = layout(this.workbook.sheets[index]!);
      this.#layouts.set(index, next);
    }
    this.current = next;
    const { rows, columns, frozenHeight, frozenWidth, sheet } = next;
    const headerHeight = HEADER_HEIGHT + frozenHeight;
    const headerWidth = HEADER_WIDTH + frozenWidth;
    this.root.style.gridTemplateColumns = `${headerWidth}px ${columns.start(columns.count) - frozenWidth}px`;
    this.root.style.gridTemplateRows = `${headerHeight}px ${rows.start(rows.count) - frozenHeight}px`;
    this.root.dataset.gridLines = String(sheet.gridLines);
    this.element.scrollTo(0, 0);
    this.#selected = undefined;
    for (const area of Object.values(this.areas)) area.replaceChildren();
    this.drawDrawings(next);
    this.draw();
  }

  setZoom(value: number) {
    this.#zoom = value;
    this.root.style.zoom = String(value);
    this.schedule();
  }

  readonly schedule = () => {
    if (this.#frame) return;
    this.#frame = requestAnimationFrame(() => {
      this.#frame = 0;
      this.draw();
    });
  };

  /** Redraw the cells in view: body, frozen rows, frozen columns and their corner. */
  draw() {
    const sheet = this.current;
    if (!sheet) return;
    const { rows, columns, frozenHeight, frozenWidth } = sheet;
    const scrollTop = this.element.scrollTop / this.#zoom;
    const scrollLeft = this.element.scrollLeft / this.#zoom;
    const height = this.element.clientHeight / this.#zoom;
    const width = this.element.clientWidth / this.#zoom;
    const frozenRows = sheet.sheet.frozenRows;
    const frozenColumns = sheet.sheet.frozenColumns;
    const firstRow = Math.max(frozenRows, rows.at(frozenHeight + scrollTop) - OVERSCAN);
    const lastRow = Math.min(rows.count - 1, rows.at(frozenHeight + scrollTop + height) + OVERSCAN);
    const firstColumn = Math.max(frozenColumns, columns.at(frozenWidth + scrollLeft) - OVERSCAN);
    const lastColumn = Math.min(columns.count - 1, columns.at(frozenWidth + scrollLeft + width) + OVERSCAN);

    this.fill(this.areas.body, sheet, firstRow, lastRow, firstColumn, lastColumn, frozenHeight, frozenWidth);
    this.fill(this.areas.top, sheet, 0, frozenRows - 1, firstColumn, lastColumn, -HEADER_HEIGHT, frozenWidth, "columns");
    this.fill(this.areas.left, sheet, firstRow, lastRow, 0, frozenColumns - 1, frozenHeight, -HEADER_WIDTH, "rows");
    this.fill(this.areas.corner, sheet, 0, frozenRows - 1, 0, frozenColumns - 1, -HEADER_HEIGHT, -HEADER_WIDTH, "corner");
  }

  /**
   * Fill one area with the cells in a window. `top` and `left` are where the
   * area starts in sheet coordinates, so positions inside it are relative.
   */
  fill(area: HTMLElement, sheet: SheetLayout, firstRow: number, lastRow: number, firstColumn: number, lastColumn: number, top: number, left: number, headers?: "columns" | "rows" | "corner") {
    const { rows, columns } = sheet;
    const nodes: HTMLElement[] = [];
    if (headers === "columns" || headers === "corner") {
      const from = headers === "corner" ? 0 : firstColumn;
      const to = headers === "corner" ? sheet.sheet.frozenColumns - 1 : lastColumn;
      if (headers === "corner") nodes.push(this.box("documents-grid-header", 0, 0, HEADER_WIDTH, HEADER_HEIGHT, ""));
      for (let c = from; c <= to; c += 1) {
        if (columns.size(c) === 0) continue;
        nodes.push(this.box("documents-grid-header", 0, columns.start(c) - left, columns.size(c), HEADER_HEIGHT, columnName(c)));
      }
    }
    if (headers === "rows" || headers === "corner") {
      const from = headers === "corner" ? 0 : firstRow;
      const to = headers === "corner" ? sheet.sheet.frozenRows - 1 : lastRow;
      for (let r = from; r <= to; r += 1) {
        if (rows.size(r) === 0) continue;
        nodes.push(this.box("documents-grid-header", rows.start(r) - top, 0, HEADER_WIDTH, rows.size(r), String(r + 1)));
      }
    }
    const drawn = new Set<string>();
    const place = (cell: SheetCell | undefined, r: number, c: number) => {
      const key = `${r}:${c}`;
      if (drawn.has(key) || sheet.covered.has(key)) return;
      drawn.add(key);
      const merge = sheet.merges.get(key);
      const width = merge ? columns.start(merge.right + 1) - columns.start(c) : columns.size(c);
      const height = merge ? rows.start(merge.bottom + 1) - rows.start(r) : rows.size(r);
      if (width === 0 || height === 0) return;
      const node = this.box("documents-grid-cell", rows.start(r) - top, columns.start(c) - left, width, height, "");
      node.dataset.cell = key;
      if (key === this.#selected) node.dataset.selected = "";
      if (cell) this.content(node, cell, merge !== undefined || this.overflows(sheet, cell));
      const options = sheet.lists.get(key);
      if (options) {
        const arrow = this.doc.createElement("button");
        arrow.type = "button";
        arrow.className = "documents-grid-list";
        arrow.dataset.list = key;
        arrow.setAttribute("aria-label", "Show allowed values");
        node.append(arrow);
      } else if (sheet.filters.has(key)) {
        const filter = this.doc.createElement("span");
        filter.className = "documents-grid-filter";
        filter.setAttribute("aria-hidden", "true");
        node.append(filter);
      }
      nodes.push(node);
    };
    // Merges that start outside the window but reach into it still draw.
    for (const merge of sheet.sheet.merges) {
      if (merge.bottom >= firstRow && merge.top <= lastRow && merge.right >= firstColumn && merge.left <= lastColumn && (merge.top < firstRow || merge.left < firstColumn)) {
        place(sheet.byRow.get(merge.top)?.find((cell) => cell.column === merge.left), merge.top, merge.left);
      }
    }
    for (let r = firstRow; r <= lastRow; r += 1) {
      const cells = sheet.byRow.get(r);
      let i = cells ? lowerBound(cells, firstColumn) : 0;
      for (let c = firstColumn; c <= lastColumn; c += 1) {
        let cell: SheetCell | undefined;
        if (cells && cells[i]?.column === c) cell = cells[i++];
        place(cell, r, c);
      }
    }
    area.replaceChildren(...nodes, ...area.querySelectorAll(":scope > .documents-grid-drawing"));
  }

  /** Text spills into the next cells while they're empty, as in Excel. */
  overflows(sheet: SheetLayout, cell: SheetCell): boolean {
    if (cell.kind !== "text" || this.workbook.styles[cell.style ?? 0]?.wrap) return false;
    const next = sheet.byRow.get(cell.row)?.find((other) => other.column === cell.column + 1);
    return !next || next.text === "";
  }

  box(className: string, top: number, left: number, width: number, height: number, text: string) {
    const node = this.doc.createElement("div");
    node.className = className;
    node.style.cssText = `top:${top}px;left:${left}px;width:${width}px;height:${height}px`;
    if (text) node.textContent = text;
    return node;
  }

  content(node: HTMLElement, cell: SheetCell, spill: boolean) {
    const style = this.workbook.styles[cell.style ?? 0];
    node.style.cssText += this.styleCss[cell.style ?? 0] ?? "";
    if (!style?.horizontal && (cell.kind === "number" || cell.kind === "bool" || cell.kind === "error")) node.style.justifyContent = cell.kind === "number" ? "flex-end" : "center";
    if (spill) node.dataset.spill = "";
    if (cell.bar) {
      const bar = this.doc.createElement("span");
      bar.className = "documents-grid-bar";
      bar.style.cssText = `width:${(cell.bar.fraction * 100).toFixed(1)}%;--bar:${cell.bar.color}`;
      node.append(bar);
    }
    const text = this.doc.createElement("span");
    text.className = "documents-grid-text";
    text.textContent = cell.text;
    if (cell.checkbox) {
      const box = this.doc.createElement("input");
      box.type = "checkbox";
      box.checked = cell.checkbox.checked;
      box.disabled = true;
      node.append(box);
      if (!cell.text && cell.checkbox.caption) text.textContent = cell.checkbox.caption;
    }
    if (cell.link) {
      const link = this.doc.createElement("a");
      link.href = cell.link;
      link.append(text);
      node.append(link);
    } else node.append(text);
  }

  drawDrawings(sheet: SheetLayout) {
    for (const url of this.urls.splice(0)) URL.revokeObjectURL(url);
    for (const drawing of sheet.sheet.drawings) {
      const box = this.placement(sheet, drawing);
      const node = this.doc.createElement("div");
      node.className = "documents-grid-drawing";
      node.style.cssText = `top:${box.top}px;left:${box.left}px;width:${box.width}px;height:${box.height}px`;
      if (drawing.content.kind === "image") {
        const url = URL.createObjectURL(new Blob([drawing.content.data as BlobPart], { type: drawing.content.mediaType }));
        this.urls.push(url);
        const image = this.doc.createElement("img");
        image.src = url;
        image.alt = "";
        node.append(image);
      } else {
        node.append(chartSvg(this.doc, drawing.content, box.width, box.height));
      }
      this.areas.body.append(node);
    }
  }

  placement(sheet: SheetLayout, drawing: Drawing) {
    const { rows, columns, frozenHeight, frozenWidth } = sheet;
    const at = (a: { row: number; column: number; rowOffset: number; columnOffset: number }) => ({
      top: rows.start(a.row) + pointPixels(a.rowOffset) - frozenHeight,
      left: columns.start(a.column) + pointPixels(a.columnOffset) - frozenWidth,
    });
    const from = at(drawing.placement.from);
    if (drawing.placement.kind === "cells") {
      const to = at(drawing.placement.to);
      return { ...from, width: Math.max(1, to.left - from.left), height: Math.max(1, to.top - from.top) };
    }
    return { ...from, width: pointPixels(drawing.placement.width), height: pointPixels(drawing.placement.height) };
  }

  readonly click = (event: MouseEvent) => {
    const target = event.target as Element;
    const link = target.closest("a[href]");
    if (link) {
      event.preventDefault();
      this.onLink?.(link.getAttribute("href")!);
      return;
    }
    const list = target.closest<HTMLElement>("[data-list]");
    if (list) {
      this.showList(list);
      return;
    }
    this.closeList();
    const cell = target.closest<HTMLElement>("[data-cell]");
    if (cell) this.select(cell.dataset.cell);
  };

  #list: HTMLElement | undefined;

  /** The values a list validation allows, under its cell. Read-only, as the whole viewer is. */
  showList(button: HTMLElement) {
    const options = this.current?.lists.get(button.dataset.list!);
    if (!options) return;
    this.closeList();
    const cell = button.closest<HTMLElement>("[data-cell]")!;
    const list = this.doc.createElement("ul");
    list.className = "documents-grid-options";
    list.setAttribute("role", "listbox");
    const value = cell.querySelector(".documents-grid-text")?.textContent ?? "";
    for (const option of options) {
      const item = this.doc.createElement("li");
      item.setAttribute("role", "option");
      item.setAttribute("aria-selected", String(option === value));
      item.textContent = option;
      list.append(item);
    }
    list.style.cssText = `top:${cell.offsetTop + cell.offsetHeight}px;left:${cell.offsetLeft}px;min-width:${cell.offsetWidth}px`;
    cell.parentElement!.append(list);
    this.#list = list;
  }

  closeList() {
    this.#list?.remove();
    this.#list = undefined;
  }

  select(key: string | undefined) {
    this.root.querySelector("[data-selected]")?.removeAttribute("data-selected");
    this.#selected = key;
    if (key) this.root.querySelector(`[data-cell="${key}"]`)?.setAttribute("data-selected", "");
  }

  /** Scroll a cell into the middle of the view and select it. */
  reveal(row: number, column: number) {
    const sheet = this.current;
    if (!sheet) return;
    const top = (sheet.rows.start(row) - sheet.frozenHeight) * this.#zoom;
    const left = (sheet.columns.start(column) - sheet.frozenWidth) * this.#zoom;
    this.element.scrollTo({ top: Math.max(0, top - this.element.clientHeight / 2), left: Math.max(0, left - this.element.clientWidth / 3) });
    this.#selected = `${row}:${column}`;
    this.draw();
  }

  destroy() {
    cancelAnimationFrame(this.#frame);
    this.resize.disconnect();
    this.element.removeEventListener("scroll", this.schedule);
    for (const url of this.urls) URL.revokeObjectURL(url);
    this.element.replaceChildren();
  }
}

function lowerBound(cells: readonly SheetCell[], column: number) {
  let low = 0;
  let high = cells.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (cells[mid]!.column < column) low = mid + 1;
    else high = mid;
  }
  return low;
}

const borderWidth = { thin: 1, medium: 2, thick: 3 } as const;
const justify = { start: "flex-start", center: "center", end: "flex-end", justify: "flex-start" } as const;

/** A style as inline CSS, built once per style rather than once per cell. */
function styleCss(style: CellStyle): string {
  const css: string[] = [];
  if (style.bold) css.push("font-weight:700");
  if (style.italic) css.push("font-style:italic");
  const lines = [style.underline && "underline", style.strike && "line-through"].filter(Boolean);
  if (lines.length) css.push(`text-decoration:${lines.join(" ")}`);
  if (style.fontFamily) css.push(`font-family:${JSON.stringify(style.fontFamily)},var(--documents-font)`);
  if (style.fontSize) css.push(`font-size:${((style.fontSize * 4) / 3).toFixed(1)}px`);
  if (style.color) css.push(`color:${style.color}`);
  if (style.fill) css.push(`background:${style.fill}`);
  for (const [side, border] of [["top", style.borderTop], ["right", style.borderRight], ["bottom", style.borderBottom], ["left", style.borderLeft]] as const) {
    if (border) css.push(`border-${side}:${border.double ? 3 : borderWidth[border.width]}px ${border.double ? "double" : border.dashed ? "dashed" : "solid"} ${border.color ?? "currentColor"}`);
  }
  if (style.horizontal) css.push(`justify-content:${justify[style.horizontal]}`);
  if (style.horizontal === "center") css.push("text-align:center");
  if (style.vertical) css.push(`align-items:${justify[style.vertical]}`);
  if (style.wrap) css.push("white-space:normal");
  if (style.indent) css.push(`padding-left:${4 + style.indent * 9}px`);
  return css.length ? `;${css.join(";")}` : "";
}

/** Search every sheet's displayed text; showing a match opens its sheet. */
function gridSearch(grid: Grid, workbook: Workbook, onSheet: (index: number) => void): Searchable {
  let matches: { sheet: number; row: number; column: number }[] = [];
  return {
    async find(query) {
      const needle = query.toLocaleLowerCase();
      matches = [];
      workbook.sheets.forEach((sheet, index) => {
        for (const cell of sheet.cells) if (cell.text.toLocaleLowerCase().includes(needle)) matches.push({ sheet: index, row: cell.row, column: cell.column });
      });
      return matches.length;
    },
    show(index) {
      const match = matches[index];
      if (!match) return;
      if (grid.current?.sheet !== workbook.sheets[match.sheet]) {
        grid.show(match.sheet);
        onSheet(match.sheet);
      }
      grid.reveal(match.row, match.column);
    },
    clear() {
      matches = [];
      grid.select(undefined);
    },
  };
}
