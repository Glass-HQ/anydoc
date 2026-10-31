import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from "pdfjs-dist";
import { DocumentError } from "../../core/errors.js";
import { followLinks } from "../links.js";
import type { RenderFunction, Searchable } from "../renderer.js";

const MAX_PAGES = 5_000;
/** Pages drawn ahead of the viewport in each direction, as a share of its height. */
const OVERSCAN = "150% 0px";
/** Canvases kept alive at once; the farthest are released past this. */
const LIVE_PAGES = 12;

/**
 * PDFs through pdf.js: every page is laid out at its size up front, and only
 * those near the viewport are drawn, with a text layer for selection and
 * search. Scripts, forms and XFA are off; links go to the app.
 */
export const render: RenderFunction = async ({ element, bytes, signal, options, onPosition }) => {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = String(options.pdfWorker ?? new URL("../../pdf.worker.min.mjs", import.meta.url));
  const task = pdfjs.getDocument({
    data: bytes.slice(),
    enableXfa: false,
    disableAutoFetch: true,
    disableStream: true,
  });
  signal.addEventListener("abort", () => void task.destroy(), { once: true });
  const pdf = await task.promise;
  if (pdf.numPages > MAX_PAGES) {
    await task.destroy();
    throw new DocumentError(`This PDF has ${pdf.numPages.toLocaleString()} pages, more than the ${MAX_PAGES.toLocaleString()} the viewer shows.`, { code: "resourceLimit", format: "pdf" });
  }
  const doc = element.ownerDocument;
  const container = doc.createElement("div");
  container.className = "documents-pages";
  element.replaceChildren(container);

  // Sizes at scale 1, read up front so the scroll height is right before anything is drawn.
  const first = await pdf.getPage(1);
  const base = first.getViewport({ scale: 1 });
  const pages: PageView[] = [];
  for (let index = 0; index < pdf.numPages; index += 1) {
    pages.push(new PageView(doc, pdf, index, base.width, base.height));
    container.append(pages[index]!.root);
  }
  // Real sizes arrive in the background: most PDFs keep one size, so the guess rarely moves anything.
  void (async () => {
    for (const page of pages) {
      if (signal.aborted) return;
      await page.measure();
    }
  })();

  let scale = fitScale(element, base.width);
  for (const page of pages) page.setScale(scale);
  const live = new Set<PageView>();
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const page = pages[Number((entry.target as HTMLElement).dataset.page)];
        if (!page) continue;
        if (entry.isIntersecting) {
          live.add(page);
          void page.draw();
        }
      }
      // Release the farthest drawn pages so memory stays bounded however long the PDF is.
      if (live.size > LIVE_PAGES) {
        const center = currentPage();
        const far = [...live].sort((a, b) => Math.abs(b.index - center) - Math.abs(a.index - center));
        for (const page of far.slice(0, live.size - LIVE_PAGES)) {
          page.release();
          live.delete(page);
        }
      }
    },
    { root: element, rootMargin: OVERSCAN },
  );
  for (const page of pages) observer.observe(page.root);

  const currentPage = () => {
    const middle = element.scrollTop + element.clientHeight / 3;
    let low = 0;
    let high = pages.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if (pages[mid]!.root.offsetTop <= middle) low = mid;
      else high = mid - 1;
    }
    return low;
  };
  let reported = 0;
  const scroll = () => {
    const page = currentPage();
    if (page !== reported) {
      reported = page;
      onPosition({ page });
    }
  };
  element.addEventListener("scroll", scroll, { passive: true });
  const stopLinks = followLinks(container, options.onLink);

  return {
    pages: {
      total: pages.length,
      goTo: (index) => pages[index]?.root.scrollIntoView({ block: "start" }),
    },
    zoom: {
      min: 0.25,
      max: 5,
      apply(value) {
        const anchor = currentPage();
        const offset = element.scrollTop - pages[anchor]!.root.offsetTop;
        const previous = scale;
        scale = fitScale(element, base.width) * value;
        for (const page of pages) page.setScale(scale);
        for (const page of live) void page.draw();
        element.scrollTop = pages[anchor]!.root.offsetTop + (offset * scale) / previous;
      },
    },
    search: pdfSearch(pdf, pages),
    thumbnails: {
      render(index, target, width) {
        let task: RenderTask | undefined;
        let cancelled = false;
        void pdf.getPage(index + 1).then((page) => {
          if (cancelled) return;
          const base = page.getViewport({ scale: 1 });
          const viewport = page.getViewport({ scale: width / base.width });
          const ratio = Math.min(globalThis.devicePixelRatio || 1, 2);
          const canvas = target.ownerDocument.createElement("canvas");
          canvas.width = Math.floor(viewport.width * ratio);
          canvas.height = Math.floor(viewport.height * ratio);
          canvas.style.cssText = `display:block;width:${viewport.width}px;height:${viewport.height}px;background:#fff`;
          target.replaceChildren(canvas);
          task = page.render({ canvas, viewport, transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0] });
          task.promise.catch(() => undefined);
        });
        return () => {
          cancelled = true;
          task?.cancel();
          target.replaceChildren();
        };
      },
    },
    destroy() {
      observer.disconnect();
      element.removeEventListener("scroll", scroll);
      stopLinks();
      for (const page of pages) page.release();
      void task.destroy();
      element.replaceChildren();
    },
  };
};

/** The scale at which a page fills the viewer's width, never above 100% on a wide screen. */
function fitScale(element: HTMLElement, width: number): number {
  const available = Math.max(200, element.clientWidth - 48);
  return Math.min(1.5, available / width);
}

class PageView {
  readonly root: HTMLDivElement;
  #width: number;
  #height: number;
  #scale = 1;
  #drawn = 0;
  #task: RenderTask | undefined;
  #textLayer: { cancel(): void } | undefined;
  #page: PDFPageProxy | undefined;
  text: HTMLDivElement | undefined;

  constructor(
    readonly doc: Document,
    readonly pdf: PDFDocumentProxy,
    readonly index: number,
    width: number,
    height: number,
  ) {
    this.#width = width;
    this.#height = height;
    this.root = doc.createElement("div");
    this.root.className = "documents-page";
    this.root.dataset.page = String(index);
    this.root.setAttribute("role", "img");
    this.root.setAttribute("aria-label", `Page ${index + 1}`);
  }

  async page(): Promise<PDFPageProxy> {
    this.#page ??= await this.pdf.getPage(this.index + 1);
    return this.#page;
  }

  async measure() {
    const viewport = (await this.page()).getViewport({ scale: 1 });
    if (viewport.width !== this.#width || viewport.height !== this.#height) {
      this.#width = viewport.width;
      this.#height = viewport.height;
      this.setScale(this.#scale);
    }
  }

  setScale(scale: number) {
    this.#scale = scale;
    this.root.style.width = `${Math.floor(this.#width * scale)}px`;
    this.root.style.height = `${Math.floor(this.#height * scale)}px`;
  }

  async draw() {
    if (this.#drawn === this.#scale) return;
    const scale = this.#scale;
    this.#drawn = scale;
    this.#task?.cancel();
    this.#textLayer?.cancel();
    const page = await this.page();
    const viewport = page.getViewport({ scale });
    const ratio = Math.min(globalThis.devicePixelRatio || 1, 2);
    const canvas = this.doc.createElement("canvas");
    canvas.width = Math.floor(viewport.width * ratio);
    canvas.height = Math.floor(viewport.height * ratio);
    canvas.style.cssText = "display:block;width:100%;height:100%";
    const task = page.render({ canvas, viewport, transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0] });
    this.#task = task;
    try {
      await task.promise;
    } catch {
      return;
    }
    if (this.#drawn !== scale) return;
    const { TextLayer } = await import("pdfjs-dist");
    const text = this.doc.createElement("div");
    text.className = "textLayer";
    text.style.setProperty("--total-scale-factor", String(scale));
    const layer = new TextLayer({ container: text, textContentSource: page.streamTextContent(), viewport });
    this.#textLayer = layer;
    await layer.render().catch(() => undefined);
    if (this.#drawn !== scale) return;
    this.text = text;
    this.root.replaceChildren(canvas, text, await this.links(page, viewport));
    this.root.dispatchEvent(new Event("documents-drawn"));
  }

  /** The page's link annotations as plain anchors over the canvas. */
  async links(page: PDFPageProxy, viewport: ReturnType<PDFPageProxy["getViewport"]>): Promise<DocumentFragment> {
    const fragment = this.doc.createDocumentFragment();
    for (const annotation of await page.getAnnotations({ intent: "display" })) {
      if (annotation.subtype !== "Link" || typeof annotation.url !== "string") continue;
      const [left, bottom, right, top] = annotation.rect as [number, number, number, number];
      const [x1, y1] = viewport.convertToViewportPoint(left, bottom) as [number, number];
      const [x2, y2] = viewport.convertToViewportPoint(right, top) as [number, number];
      const link = this.doc.createElement("a");
      link.href = annotation.url;
      link.style.cssText = `position:absolute;left:${Math.min(x1, x2)}px;top:${Math.min(y1, y2)}px;width:${Math.abs(x2 - x1)}px;height:${Math.abs(y2 - y1)}px`;
      fragment.append(link);
    }
    return fragment;
  }

  release() {
    this.#task?.cancel();
    this.#textLayer?.cancel();
    this.#drawn = 0;
    this.text = undefined;
    this.root.replaceChildren();
    this.#page?.cleanup();
  }
}

/**
 * Search over each page's text, read from pdf.js on demand and cached. Every
 * match on a drawn page is highlighted, and pages drawn later as the reader
 * scrolls pick up theirs as they appear.
 */
function pdfSearch(pdf: PDFDocumentProxy, pages: readonly PageView[]): Searchable {
  const texts = new Map<number, string>();
  let matches: { page: number; start: number; length: number }[] = [];
  const highlights = typeof CSS !== "undefined" && "highlights" in CSS ? CSS.highlights : undefined;
  const supported = highlights !== undefined && typeof Highlight !== "undefined";
  const all = supported ? new Highlight() : undefined;
  const current = supported ? new Highlight() : undefined;
  if (current) current.priority = 1;
  const rangesByPage = new Map<number, Range[]>();
  const pageText = async (index: number) => {
    let text = texts.get(index);
    if (text === undefined) {
      const content = await (await pdf.getPage(index + 1)).getTextContent();
      text = content.items.map((item) => ("str" in item ? item.str : "")).join("");
      texts.set(index, text);
    }
    return text;
  };
  /** Replace a page's highlighted ranges with ones over its current text layer. */
  const markPage = (index: number) => {
    if (!all) return;
    for (const range of rangesByPage.get(index) ?? []) all.delete(range);
    rangesByPage.delete(index);
    const layer = pages[index]?.text;
    if (!layer) return;
    const ranges = matches.filter((m) => m.page === index).map((m) => rangeAt(layer, m.start, m.length)).filter((r): r is Range => r !== undefined);
    for (const range of ranges) all.add(range);
    rangesByPage.set(index, ranges);
  };
  for (const page of pages) page.root.addEventListener("documents-drawn", () => markPage(page.index));
  const showCurrent = (match: (typeof matches)[number]) => {
    const layer = pages[match.page]?.text;
    const range = layer && rangeAt(layer, match.start, match.length);
    if (!range || !current || !highlights) return;
    current.clear();
    current.add(range);
    highlights.set("documents-match-current", current);
    range.startContainer.parentElement?.scrollIntoView({ block: "center" });
  };
  return {
    async find(query, signal, onMatches) {
      matches = [];
      if (all && highlights) highlights.set("documents-match", all);
      const needle = query.toLocaleLowerCase();
      for (let index = 0; index < pages.length; index += 1) {
        signal.throwIfAborted();
        const text = (await pageText(index)).toLocaleLowerCase();
        const before = matches.length;
        for (let at = text.indexOf(needle); at >= 0; at = text.indexOf(needle, at + needle.length)) {
          matches.push({ page: index, start: at, length: needle.length });
        }
        if (matches.length > before) markPage(index);
        if (index % 20 === 19) onMatches(matches.length);
      }
      return matches.length;
    },
    show(index) {
      const match = matches[index];
      const page = match && pages[match.page];
      if (!match || !page) return;
      if (page.text) {
        showCurrent(match);
        return;
      }
      page.root.scrollIntoView({ block: "center" });
      page.root.addEventListener("documents-drawn", () => showCurrent(match), { once: true });
    },
    clear() {
      matches = [];
      rangesByPage.clear();
      all?.clear();
      current?.clear();
    },
  };
}

/** A range over `length` characters starting `start` characters into the element's text. */
function rangeAt(root: Element, start: number, length: number): Range | undefined {
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const range = root.ownerDocument.createRange();
  let offset = 0;
  let started = false;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const size = node.nodeValue?.length ?? 0;
    if (!started && start < offset + size) {
      range.setStart(node, start - offset);
      started = true;
    }
    if (started && start + length <= offset + size) {
      range.setEnd(node, start + length - offset);
      return range;
    }
    offset += size;
  }
  return undefined;
}
