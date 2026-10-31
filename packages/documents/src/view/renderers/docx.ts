import { parseAsync, renderDocument } from "docx-preview";
import { domSearch } from "../dom-search.js";
import { followLinks } from "../links.js";
import type { RenderFunction } from "../renderer.js";
import { sanitize } from "../sanitize.js";
import { mapSymbolFonts } from "../symbol-fonts.js";
import { numberLists } from "../docx-numbering.js";

/**
 * Word documents laid out as pages by docx-preview. Its resources only ever
 * come from the file's own package, its embedded-HTML frames are turned off,
 * and the markup it makes is sanitized before it's shown.
 */
export const render: RenderFunction = async ({ element, bytes, signal, options }) => {
  const options_ = {
    className: "documents-docx",
    inWrapper: false,
    breakPages: true,
    ignoreLastRenderedPageBreak: false,
    experimental: true,
    renderHeaders: true,
    renderFooters: true,
    renderFootnotes: true,
    renderEndnotes: true,
    renderComments: false,
    renderAltChunks: false,
    useBase64URL: false,
  };
  const parsed = await parseAsync(bytes.slice().buffer, options_);
  signal.throwIfAborted();
  const doc = element.ownerDocument;
  const rendered = doc.createDocumentFragment();
  rendered.append(...(await renderDocument(parsed, options_)));
  signal.throwIfAborted();
  sanitize(rendered);
  mapSymbolFonts(rendered);
  const pages = doc.createElement("div");
  pages.className = "documents-pages documents-docx-pages";
  for (const section of rendered.querySelectorAll<HTMLElement>("section.documents-docx")) section.classList.add("documents-page");
  pages.append(rendered);
  const stopLinks = followLinks(pages, options.onLink);
  element.replaceChildren(pages);
  // Numbers are written once the pages are in the document, where their styles apply.
  numberLists(pages, (parsed as unknown as { numberingPart?: Parameters<typeof numberLists>[1] }).numberingPart);
  // Pages are a fixed paper width: 100% is the width that fits the viewer, never wider than the paper.
  const paper = Math.max(1, ...[...pages.querySelectorAll<HTMLElement>(".documents-page")].map((page) => page.offsetWidth));
  const fit = () => Math.min(1, (element.clientWidth - 48) / paper);
  let zoom = 1;
  const apply = () => {
    pages.style.zoom = String(fit() * zoom);
  };
  apply();
  const resize = new ResizeObserver(apply);
  resize.observe(element);
  return {
    zoom: { min: 0.25, max: 5, apply: (value: number) => { zoom = value; apply(); } },
    search: domSearch(() => pages),
    destroy: () => {
      resize.disconnect();
      stopLinks();
      // docx-preview made blob URLs for the images it drew.
      for (const image of pages.querySelectorAll<HTMLImageElement>("img[src^='blob:']")) URL.revokeObjectURL(image.src);
      element.replaceChildren();
    },
  };
};
