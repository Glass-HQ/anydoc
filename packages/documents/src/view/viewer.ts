import { DocumentError } from "../core/errors.js";
import { formatFromName, formats, type RenderMethod } from "../core/formats.js";
import { openDocument, type OpenOptions } from "../core/parse.js";
import type { DocumentSource } from "../core/source.js";
import type { RenderFunction, Renderer } from "./renderer.js";
import { initialState, Store, type ViewerState } from "./state.js";
import { installStyles } from "./styles.js";

export interface ViewerOptions extends OpenOptions {
  /**
   * Draws text and code with syntax highlighting. Gets the text and the file
   * name, returns the element to show, or the element and how to release it.
   * Without one, text shows plain.
   */
  readonly highlight?: ((text: string, name: string | undefined) => Highlighted | Promise<Highlighted>) | undefined;
  /**
   * Called when someone follows an external link in the document. The viewer
   * never navigates on its own; without this, links do nothing.
   */
  readonly onLink?: ((url: string) => void) | undefined;
  /** Where pdf.js's worker script is served from, if your bundler doesn't resolve it. */
  readonly pdfWorker?: string | URL | undefined;
}

export type Highlighted = HTMLElement | { readonly element: HTMLElement; readonly destroy: () => void };

/** A document shown in an element, with everything its controls need. */
export interface DocumentViewer {
  readonly getState: () => ViewerState;
  readonly subscribe: (listener: () => void) => () => void;
  /** 1-based. */
  goToPage(page: number): void;
  nextPage(): void;
  previousPage(): void;
  selectSheet(index: number): void;
  setZoom(value: number): void;
  zoomIn(): void;
  zoomOut(): void;
  resetZoom(): void;
  /** Search the document. An empty query clears the search. */
  search(query: string): void;
  nextMatch(): void;
  previousMatch(): void;
  /**
   * Draw page or slide `page` (1-based) at `width` CSS pixels into an element
   * of yours, for a thumbnail rail. Returns a function that releases it. Does
   * nothing for documents without pages.
   */
  renderThumbnail(page: number, element: HTMLElement, width?: number): () => void;
  /** Stop everything and empty the element. */
  destroy(): void;
}

const renderers: Record<RenderMethod, () => Promise<{ readonly render: RenderFunction }>> = {
  pdf: () => import("./renderers/pdf.js"),
  docx: () => import("./renderers/docx.js"),
  pptx: () => import("./renderers/pptx.js"),
  spreadsheet: () => import("./renderers/spreadsheet.js"),
  document: () => import("./renderers/document.js"),
  markdown: () => import("./renderers/markdown.js"),
  text: () => import("./renderers/text.js"),
  image: () => import("./renderers/media.js").then((m) => ({ render: m.renderImage })),
  video: () => import("./renderers/media.js").then((m) => ({ render: m.renderVideo })),
  audio: () => import("./renderers/media.js").then((m) => ({ render: m.renderAudio })),
  font: () => import("./renderers/font.js"),
  binary: () => import("./renderers/binary.js"),
};

const streamedRenderers = new Set<RenderMethod>(["image", "video", "audio"]);

/** A URL source whose name or format says it's media, so it can stream instead of being read. */
function streamable(source: DocumentSource, options: ViewerOptions) {
  const target = typeof source === "string" || source instanceof URL ? source : typeof source === "object" && "url" in source && !("init" in source && source.init) ? source.url : undefined;
  if (target === undefined) return undefined;
  const url = new URL(target, globalThis.location?.href);
  if (url.protocol !== "http:" && url.protocol !== "https:" && url.protocol !== "blob:") return undefined;
  const name = options.name ?? decodeURIComponent(url.pathname.split("/").at(-1) ?? "");
  const format = options.format ?? formatFromName(name);
  if (!format || !streamedRenderers.has(formats[format].render)) return undefined;
  return { bytes: new Uint8Array(), format, name, url: url.href };
}

const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5];

/**
 * Open a source and render it into `element`, which the viewer fills and
 * scrolls. The element should have a size: the viewer fills it.
 */
export function createViewer(element: HTMLElement, source: DocumentSource, options: ViewerOptions = {}): DocumentViewer {
  const store = new Store<ViewerState>(initialState);
  const controller = new AbortController();
  const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
  let renderer: Renderer | undefined;
  let searchController: AbortController | undefined;
  installStyles(element.ownerDocument);
  element.dataset.documentsViewer = "";

  void (async () => {
    // Media at a URL streams into the browser's own players instead of being read into memory first.
    const streamed = streamable(source, options);
    const opened = streamed ?? (await openDocument(source, { ...options, signal }));
    store.set({ format: opened.format });
    element.dataset.documentsViewer = opened.format;
    const { render } = await renderers[formats[opened.format].render]();
    signal.throwIfAborted();
    const content = element.ownerDocument.createElement("div");
    content.className = "documents-content";
    element.replaceChildren(content);
    renderer = await render({
      element: content,
      bytes: opened.bytes,
      url: streamed ? streamed.url : undefined,
      format: opened.format,
      name: opened.name,
      signal,
      options,
      onPosition: ({ page, sheet }) => {
        const state = store.get();
        if (page !== undefined && state.page) store.set({ page: { ...state.page, current: page + 1 } });
        if (sheet !== undefined && state.sheets) store.set({ sheets: { ...state.sheets, current: sheet } });
      },
    });
    if (signal.aborted) {
      renderer.destroy();
      return;
    }
    store.set({
      status: "ready",
      page: renderer.pages ? { current: 1, total: renderer.pages.total } : undefined,
      sheets: renderer.sheets ? { names: renderer.sheets.names, current: 0 } : undefined,
      zoom: renderer.zoom ? { value: 1, min: renderer.zoom.min, max: renderer.zoom.max } : undefined,
      search: renderer.search ? { query: "", total: 0, current: 0, pending: false } : undefined,
    });
  })().catch((cause: unknown) => {
    if (controller.signal.aborted) return;
    const error = DocumentError.from(cause, { code: "renderFailed", format: store.get().format, message: "This document couldn't be shown." });
    store.set({ status: "error", error });
  });

  const setZoom = (value: number) => {
    const zoom = store.get().zoom;
    if (!renderer?.zoom || !zoom || !Number.isFinite(value)) return;
    const next = Math.min(zoom.max, Math.max(zoom.min, value));
    renderer.zoom.apply(next);
    store.set({ zoom: { ...zoom, value: next } });
  };
  const step = (direction: 1 | -1) => {
    const value = store.get().zoom?.value ?? 1;
    const next = direction > 0 ? ZOOM_STEPS.find((s) => s > value + 1e-6) : ZOOM_STEPS.findLast((s) => s < value - 1e-6);
    if (next !== undefined) setZoom(next);
  };
  const goToPage = (page: number) => {
    const state = store.get().page;
    if (!renderer?.pages || !state) return;
    const next = Math.min(state.total, Math.max(1, Math.round(page)));
    renderer.pages.goTo(next - 1);
    store.set({ page: { ...state, current: next } });
  };
  const showMatch = (current: number) => {
    const search = store.get().search;
    if (!renderer?.search || !search || search.total === 0) return;
    const next = ((current - 1 + search.total) % search.total) + 1;
    renderer.search.show(next - 1);
    store.set({ search: { ...search, current: next } });
  };

  return {
    getState: store.get,
    subscribe: store.subscribe,
    goToPage,
    nextPage: () => goToPage((store.get().page?.current ?? 0) + 1),
    previousPage: () => goToPage((store.get().page?.current ?? 2) - 1),
    selectSheet: (index) => {
      const sheets = store.get().sheets;
      if (!renderer?.sheets || !sheets || index < 0 || index >= sheets.names.length) return;
      renderer.sheets.select(index);
      store.set({ sheets: { ...sheets, current: index } });
    },
    setZoom,
    zoomIn: () => step(1),
    zoomOut: () => step(-1),
    resetZoom: () => setZoom(1),
    search: (query) => {
      const searchable = renderer?.search;
      if (!searchable || !store.get().search) return;
      searchController?.abort();
      searchable.clear();
      if (!query.trim()) {
        store.set({ search: { query, total: 0, current: 0, pending: false } });
        return;
      }
      const own = new AbortController();
      searchController = own;
      const searchSignal = AbortSignal.any([signal, own.signal]);
      store.set({ search: { query, total: 0, current: 0, pending: true } });
      let shown = false;
      const update = (total: number, pending: boolean) => {
        if (searchSignal.aborted) return;
        store.set({ search: { query, total, current: total > 0 ? Math.max(1, store.get().search?.current ?? 1) : 0, pending } });
        if (!shown && total > 0) {
          shown = true;
          searchable.show(0);
        }
      };
      void searchable.find(query, searchSignal, (total) => update(total, true)).then(
        (total) => update(total, false),
        () => update(store.get().search?.total ?? 0, false),
      );
    },
    renderThumbnail: (page, target, width = 160) => renderer?.thumbnails?.render(page - 1, target, width) ?? (() => {}),
    nextMatch: () => showMatch((store.get().search?.current ?? 0) + 1),
    previousMatch: () => showMatch((store.get().search?.current ?? 2) - 1),
    destroy: () => {
      controller.abort();
      searchController?.abort();
      renderer?.destroy();
      element.replaceChildren();
      delete element.dataset.documentsViewer;
    },
  };
}
