import type { Chart } from "../../core/parse.js";

const palette = ["#4472c4", "#ed7d31", "#a5a5a5", "#ffc000", "#5b9bd5", "#70ad47", "#264478", "#9e480e", "#636363", "#997300"];
const SVG = "http://www.w3.org/2000/svg";

/**
 * A spreadsheet chart as SVG, from the values its file cached. Covers the
 * kinds the core reads: bar, column, line, area, pie, doughnut, scatter and
 * radar, stacked or side by side, and combinations of them.
 */
export function chartSvg(doc: Document, chart: Chart, width: number, height: number): SVGSVGElement {
  const svg = doc.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("width", String(width));
  svg.setAttribute("height", String(height));
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", chart.title ?? "Chart");
  const add = <K extends keyof SVGElementTagNameMap>(parent: Element, tag: K, attributes: Record<string, string | number>, text?: string) => {
    const node = doc.createElementNS(SVG, tag);
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
    if (text !== undefined) node.textContent = text;
    parent.append(node);
    return node;
  };
  add(svg, "rect", { width, height, fill: "#fff", stroke: "#d9d9d9" });
  let top = 8;
  if (chart.title) {
    add(svg, "text", { x: width / 2, y: 22, "text-anchor": "middle", "font-size": 14, "font-weight": 600, fill: "#404040" }, chart.title);
    top = 34;
  }
  const legendHeight = chart.series.length > 1 || isRound(chart) ? 22 : 0;
  const plot = { x: 8, y: top, width: width - 16, height: height - top - 8 - legendHeight };
  const colors = (i: number) => palette[i % palette.length]!;

  if (isRound(chart)) {
    pie(add, svg, chart, plot, colors);
    legend(add, svg, chart.categories, plot, height, colors);
    return svg;
  }
  axisChart(add, svg, chart, plot, colors);
  if (legendHeight) legend(add, svg, chart.series.map((s, i) => s.name ?? `Series ${i + 1}`), plot, height, colors);
  return svg;
}

type Add = <K extends keyof SVGElementTagNameMap>(parent: Element, tag: K, attributes: Record<string, string | number>, text?: string) => SVGElementTagNameMap[K];
type Box = { x: number; y: number; width: number; height: number };

const isRound = (chart: Chart) => chart.series[0]?.kind === "pie" || chart.series[0]?.kind === "doughnut";

function pie(add: Add, svg: SVGSVGElement, chart: Chart, plot: Box, colors: (i: number) => string) {
  const series = chart.series[0]!;
  const values = series.values.map((v) => Math.max(0, v ?? 0));
  const total = values.reduce((a, b) => a + b, 0) || 1;
  const cx = plot.x + plot.width / 2;
  const cy = plot.y + plot.height / 2;
  const r = Math.max(4, Math.min(plot.width, plot.height) / 2 - 4);
  const inner = series.kind === "doughnut" ? r * 0.55 : 0;
  let angle = -Math.PI / 2;
  values.forEach((value, i) => {
    const sweep = (value / total) * Math.PI * 2;
    if (sweep <= 0) return;
    const end = angle + Math.min(sweep, Math.PI * 2 - 1e-4);
    const large = sweep > Math.PI ? 1 : 0;
    const point = (radius: number, a: number) => `${cx + radius * Math.cos(a)} ${cy + radius * Math.sin(a)}`;
    const d = inner
      ? `M${point(r, angle)}A${r} ${r} 0 ${large} 1 ${point(r, end)}L${point(inner, end)}A${inner} ${inner} 0 ${large} 0 ${point(inner, angle)}Z`
      : `M${cx} ${cy}L${point(r, angle)}A${r} ${r} 0 ${large} 1 ${point(r, end)}Z`;
    add(svg, "path", { d, fill: colors(i), stroke: "#fff", "stroke-width": 1 });
    angle += sweep;
  });
}

function axisChart(add: Add, svg: SVGSVGElement, chart: Chart, area: Box, colors: (i: number) => string) {
  const count = Math.max(chart.categories.length, ...chart.series.map((s) => s.values.length), 1);
  const horizontal = chart.series.every((s) => s.kind === "bar");
  const bars = chart.series.filter((s) => s.kind === "bar" || s.kind === "column");
  // The value range covers stacked totals when series stack.
  let min = 0;
  let max = 0;
  for (let i = 0; i < count; i += 1) {
    let positive = 0;
    let negative = 0;
    for (const series of chart.series) {
      const v = series.values[i] ?? 0;
      if (chart.stacked) {
        if (v >= 0) positive += v;
        else negative += v;
      } else {
        max = Math.max(max, v);
        min = Math.min(min, v);
      }
    }
    if (chart.stacked) {
      max = Math.max(max, positive);
      min = Math.min(min, negative);
    }
  }
  const step = niceStep((max - min) / 5 || 1);
  max = Math.ceil(max / step) * step || step;
  min = Math.floor(min / step) * step;
  const labelWidth = Math.max(...[min, max].map((v) => formatTick(v).length)) * 6.5 + 8;
  const plot = horizontal
    ? { x: area.x + Math.min(120, area.width / 3), y: area.y, width: area.width - Math.min(120, area.width / 3), height: area.height - 18 }
    : { x: area.x + labelWidth, y: area.y, width: area.width - labelWidth, height: area.height - 18 };
  const length = horizontal ? plot.width : plot.height;
  const scale = (v: number) => ((v - min) / (max - min || 1)) * length;
  const band = (horizontal ? plot.height : plot.width) / count;

  for (let tick = min; tick <= max + step / 2; tick += step) {
    const at = scale(tick);
    if (horizontal) {
      add(svg, "line", { x1: plot.x + at, x2: plot.x + at, y1: plot.y, y2: plot.y + plot.height, stroke: "#e5e5e5" });
      add(svg, "text", { x: plot.x + at, y: plot.y + plot.height + 13, "text-anchor": "middle", "font-size": 10, fill: "#595959" }, formatTick(tick));
    } else {
      const y = plot.y + plot.height - at;
      add(svg, "line", { x1: plot.x, x2: plot.x + plot.width, y1: y, y2: y, stroke: "#e5e5e5" });
      add(svg, "text", { x: plot.x - 4, y: y + 3, "text-anchor": "end", "font-size": 10, fill: "#595959" }, formatTick(tick));
    }
  }
  const labels = Math.max(1, Math.ceil(count / Math.max(1, Math.floor((horizontal ? plot.height : plot.width) / 60))));
  chart.categories.forEach((category, i) => {
    if (i % labels !== 0) return;
    const center = band * (i + 0.5);
    const label = category.length > 14 ? `${category.slice(0, 13)}…` : category;
    if (horizontal) add(svg, "text", { x: plot.x - 4, y: plot.y + center + 3, "text-anchor": "end", "font-size": 10, fill: "#595959" }, label);
    else add(svg, "text", { x: plot.x + center, y: plot.y + plot.height + 13, "text-anchor": "middle", "font-size": 10, fill: "#595959" }, label);
  });

  const stacks = new Float64Array(count);
  const negativeStacks = new Float64Array(count);
  const zero = scale(0);
  chart.series.forEach((series, s) => {
    const color = colors(s);
    if (series.kind === "bar" || series.kind === "column") {
      const slot = bars.indexOf(series);
      const groups = chart.stacked ? 1 : bars.length;
      const thickness = (band * 0.7) / groups;
      series.values.forEach((value, i) => {
        if (value === null) return;
        const base = chart.stacked ? (value >= 0 ? stacks[i]! : negativeStacks[i]!) : 0;
        const from = scale(base);
        const to = scale(base + value);
        if (chart.stacked) {
          if (value >= 0) stacks[i]! += value;
          else negativeStacks[i]! += value;
        }
        const offset = band * i + band * 0.15 + (chart.stacked ? 0 : slot * thickness);
        const [a, b] = [Math.min(from, to), Math.abs(to - from)];
        if (horizontal) add(svg, "rect", { x: plot.x + a, y: plot.y + offset, width: b, height: thickness, fill: color });
        else add(svg, "rect", { x: plot.x + offset, y: plot.y + plot.height - a - b, width: thickness, height: b, fill: color });
      });
      return;
    }
    const points = series.values.map((value, i) => (value === null ? null : `${plot.x + band * (i + 0.5)},${plot.y + plot.height - scale(value)}`));
    const path = points.filter((p): p is string => p !== null);
    if (series.kind === "area" && path.length > 1) {
      add(svg, "polygon", { points: `${plot.x + band * 0.5},${plot.y + plot.height - zero} ${path.join(" ")} ${plot.x + band * (path.length - 0.5)},${plot.y + plot.height - zero}`, fill: color, "fill-opacity": 0.5 });
    } else if (series.kind === "scatter") {
      for (const point of path) {
        const [x, y] = point.split(",");
        add(svg, "circle", { cx: x!, cy: y!, r: 3, fill: color });
      }
    } else {
      add(svg, "polyline", { points: path.join(" "), fill: "none", stroke: color, "stroke-width": 2 });
    }
  });
}

function legend(add: Add, svg: SVGSVGElement, names: readonly string[], plot: Box, height: number, colors: (i: number) => string) {
  const y = height - 14;
  let x = plot.x;
  names.forEach((name, i) => {
    add(svg, "rect", { x, y: y - 8, width: 9, height: 9, fill: colors(i) });
    const label = name.length > 20 ? `${name.slice(0, 19)}…` : name;
    add(svg, "text", { x: x + 13, y, "font-size": 10, fill: "#404040" }, label);
    x += 22 + label.length * 5.6;
  });
}

function niceStep(rough: number): number {
  const power = 10 ** Math.floor(Math.log10(Math.abs(rough)));
  const fraction = rough / power;
  return (fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10) * power;
}

function formatTick(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${+(value / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${+(value / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${+(value / 1e3).toFixed(1)}K`;
  return String(+value.toFixed(2));
}
