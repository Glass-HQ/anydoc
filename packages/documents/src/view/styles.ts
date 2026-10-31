/**
 * The viewer's own stylesheet, added once per document in a cascade layer so
 * any app style wins over it. Theme it through the custom properties below;
 * the rendered document itself keeps the colors the file gives it.
 */
const css = `
@layer documents {
  [data-documents-viewer] {
    --documents-background: transparent;
    --documents-page-background: #fff;
    --documents-page-shadow: 0 1px 3px rgb(0 0 0 / 0.12), 0 0 0 1px rgb(0 0 0 / 0.06);
    --documents-gap: 16px;
    --documents-padding: 24px;
    --documents-match: rgb(255 214 0 / 0.45);
    --documents-match-current: rgb(255 140 0 / 0.6);
    --documents-grid-line: rgb(0 0 0 / 0.08);
    --documents-grid-header: rgb(0 0 0 / 0.04);
    --documents-muted: color-mix(in srgb, currentColor 60%, transparent);
    --documents-font: system-ui, sans-serif;
    --documents-mono: ui-monospace, SFMono-Regular, Menlo, monospace;
    position: relative;
    overflow: hidden;
    background: var(--documents-background);
    font-family: var(--documents-font);
  }
  [data-documents-viewer] .documents-content { position: absolute; inset: 0; overflow: auto; overscroll-behavior: contain; }
  [data-documents-viewer] .documents-zoom { transform-origin: 0 0; }
  [data-documents-viewer] .documents-pages { display: flex; flex-direction: column; align-items: center; gap: var(--documents-gap); padding: var(--documents-padding); min-width: min-content; }
  [data-documents-viewer] .documents-page { background: var(--documents-page-background); box-shadow: var(--documents-page-shadow); color: #000; position: relative; flex: none; }
  [data-documents-viewer] .documents-flow { max-width: 48rem; margin: 0 auto; padding: var(--documents-padding); line-height: 1.6; overflow-wrap: anywhere; }
  [data-documents-viewer] .documents-flow table { border-collapse: collapse; margin: 1em 0; }
  [data-documents-viewer] .documents-flow th, [data-documents-viewer] .documents-flow td { border: 1px solid var(--documents-grid-line); padding: 4px 8px; vertical-align: top; }
  [data-documents-viewer] .documents-flow img { max-width: 100%; height: auto; }
  [data-documents-viewer] .documents-flow pre { overflow-x: auto; font-family: var(--documents-mono); }
  [data-documents-viewer] .documents-text { margin: 0; padding: var(--documents-padding); font-family: var(--documents-mono); font-size: 13px; line-height: 1.5; white-space: pre-wrap; overflow-wrap: anywhere; tab-size: 4; }
  [data-documents-viewer] .documents-center { min-height: 100%; display: grid; place-items: center; padding: var(--documents-padding); box-sizing: border-box; }
  [data-documents-viewer] .documents-center > img, [data-documents-viewer] .documents-center > video { max-width: 100%; max-height: 100%; object-fit: contain; }
  [data-documents-viewer] .documents-message { color: var(--documents-muted); text-align: center; }
  [data-documents-viewer] .textLayer { position: absolute; inset: 0; overflow: clip; line-height: 1; text-align: initial; transform-origin: 0 0; z-index: 0; --min-font-size: 1; --text-scale-factor: calc(var(--total-scale-factor) * var(--min-font-size)); --min-font-size-inv: calc(1 / var(--min-font-size)); }
  [data-documents-viewer] .textLayer :is(span, br) { color: transparent; position: absolute; white-space: pre; cursor: text; transform-origin: 0% 0%; }
  [data-documents-viewer] .textLayer > :not(.markedContent), [data-documents-viewer] .textLayer .markedContent span:not(.markedContent) { z-index: 1; --font-height: 0; font-size: calc(var(--text-scale-factor) * var(--font-height)); --scale-x: 1; --rotate: 0deg; transform: rotate(var(--rotate)) scaleX(var(--scale-x)) scale(var(--min-font-size-inv)); }
  [data-documents-viewer] .textLayer .markedContent { display: contents; }
  [data-documents-viewer] .textLayer ::selection { background: rgb(0 90 255 / 0.25); }
  [data-documents-viewer] .documents-page > a { z-index: 2; }
  [data-documents-viewer] .documents-grid { display: grid; position: relative; width: max-content; font-size: 13px; color: #000; background: #fff; }
  [data-documents-viewer] .documents-grid > div { position: relative; overflow: hidden; }
  [data-documents-viewer] .documents-grid-corner { position: sticky !important; top: 0; left: 0; z-index: 3; background: #fff; }
  [data-documents-viewer] .documents-grid-top { position: sticky !important; top: 0; z-index: 2; background: #fff; }
  [data-documents-viewer] .documents-grid-left { position: sticky !important; left: 0; z-index: 2; background: #fff; }
  [data-documents-viewer] .documents-grid-body { overflow: visible !important; }
  [data-documents-viewer] .documents-grid-cell, [data-documents-viewer] .documents-grid-header { position: absolute; box-sizing: border-box; display: flex; align-items: flex-end; padding: 0 4px 2px; white-space: pre; overflow: hidden; line-height: 1.25; }
  [data-documents-viewer] [data-grid-lines="true"] .documents-grid-cell { box-shadow: inset -1px -1px 0 var(--documents-grid-line); }
  [data-documents-viewer] .documents-grid-cell[data-spill] { overflow: visible; z-index: 1; }
  [data-documents-viewer] .documents-grid-cell[data-selected] { outline: 2px solid #1a73e8; outline-offset: -2px; z-index: 2; }
  [data-documents-viewer] .documents-grid-cell a { color: #1155cc; text-decoration: underline; }
  [data-documents-viewer] .documents-grid-header { justify-content: center; align-items: center; padding: 0; background: var(--documents-grid-header); color: #555; font-size: 11px; box-shadow: inset -1px -1px 0 var(--documents-grid-line); }
  [data-documents-viewer] .documents-grid-text { position: relative; }
  [data-documents-viewer] .documents-grid-bar { position: absolute; left: 1px; top: 2px; bottom: 2px; background: linear-gradient(90deg, var(--bar), color-mix(in srgb, var(--bar) 25%, transparent)); border: 1px solid var(--bar); box-sizing: border-box; pointer-events: none; }
  [data-documents-viewer] .documents-grid-list, [data-documents-viewer] .documents-grid-filter { position: absolute; right: 1px; bottom: 1px; width: 16px; height: 16px; padding: 0; border: 1px solid rgb(0 0 0 / 0.25); border-radius: 2px; background: #fff; cursor: pointer; z-index: 1; }
  [data-documents-viewer] .documents-grid-list::after, [data-documents-viewer] .documents-grid-filter::after { content: ""; position: absolute; left: 4px; top: 6px; border: 4px solid transparent; border-top-color: #444; }
  [data-documents-viewer] .documents-grid-filter { cursor: default; }
  [data-documents-viewer] .documents-grid-options { position: absolute; z-index: 4; margin: 0; padding: 2px 0; list-style: none; background: #fff; border: 1px solid rgb(0 0 0 / 0.2); box-shadow: 0 4px 12px rgb(0 0 0 / 0.15); font-size: 13px; color: #000; }
  [data-documents-viewer] .documents-grid-options li { padding: 3px 10px; white-space: nowrap; }
  [data-documents-viewer] .documents-grid-options li[aria-selected="true"] { background: #e8f0fe; }
  [data-documents-viewer] .documents-grid-drawing { position: absolute; z-index: 1; pointer-events: none; }
  [data-documents-viewer] .documents-grid-drawing img { width: 100%; height: 100%; object-fit: fill; }
  [data-documents-viewer] .documents-docx-pages p[data-marker]::before { content: attr(data-marker) !important; counter-increment: none !important; white-space: pre; }
  ::highlight(documents-match) { background-color: var(--documents-match); color: inherit; }
  ::highlight(documents-match-current) { background-color: var(--documents-match-current); color: inherit; }
}
`;

const installed = new WeakSet<Document>();

export function installStyles(document: Document): void {
  if (installed.has(document)) return;
  installed.add(document);
  const style = document.createElement("style");
  style.dataset.documents = "";
  style.textContent = css;
  document.head.prepend(style);
}
