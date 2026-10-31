import { buildPresentation, parseZipLazyMedia, PptxViewer, RECOMMENDED_ZIP_LIMITS, type PresentationData, type SearchHighlightHandle, type TextSearchResult } from "@aiden0z/pptx-renderer";
import { DocumentError } from "../../core/errors.js";
import { isAllowedLink } from "../links.js";
import { mapSymbolFonts } from "../symbol-fonts.js";
import type { RenderFunction } from "../renderer.js";

const MAX_SLIDES = 2_000;

/**
 * PowerPoint through pptx-renderer, every slide in one scrolling column that
 * only mounts the slides near the viewport. Media the file links to outside
 * itself is dropped before anything renders, and links go to the app.
 */
export const render: RenderFunction = async ({ element, bytes, signal, options, onPosition }) => {
  const files = await parseZipLazyMedia(bytes.slice().buffer, RECOMMENDED_ZIP_LIMITS);
  signal.throwIfAborted();
  const presentation = await buildPresentation(files, { lazySlides: true });
  if (presentation.slides.length > MAX_SLIDES)
    throw new DocumentError(`This presentation has ${presentation.slides.length.toLocaleString()} slides, more than the ${MAX_SLIDES.toLocaleString()} the viewer shows.`, { code: "resourceLimit", format: "pptx" });
  blockExternalMedia(presentation);
  const container = element.ownerDocument.createElement("div");
  container.className = "documents-slides";
  element.replaceChildren(container);
  const viewer = new PptxViewer(container, {
    fitMode: "contain",
    lazyMedia: true,
    lazySlides: true,
    pdfjs: false,
    scrollContainer: element,
    zipLimits: RECOMMENDED_ZIP_LIMITS,
    onSlideChange: (index) => onPosition({ page: index }),
    // Bullets in Symbol and Wingdings come out as boxes without these fonts.
    onSlideRendered: (_index, slide) => mapSymbolFonts(slide),
  });
  // The renderer opens external links itself; the app decides instead.
  Reflect.set(viewer, "handleNavigate", (target: { slideIndex?: number; url?: string }) => {
    if (target.slideIndex !== undefined) void viewer.goToSlide(target.slideIndex);
    else if (target.url && isAllowedLink(target.url)) options.onLink?.(target.url);
  });
  viewer.load(presentation);
  await viewer.renderList({ windowed: true });
  signal.throwIfAborted();

  let results: TextSearchResult[] = [];
  let highlight: SearchHighlightHandle | null = null;
  return {
    pages: { total: viewer.slideCount, goTo: (index) => void viewer.goToSlide(index) },
    thumbnails: {
      render(index, target, width) {
        const handle = viewer.renderThumbnailToContainer(index, target, { width });
        return () => {
          handle?.dispose();
          target.replaceChildren();
        };
      },
    },
    zoom: { min: 0.25, max: 4, apply: (value) => void viewer.setZoom(Math.round(value * 100)) },
    search: {
      async find(query, _signal, onMatches) {
        results = viewer.searchText(query);
        onMatches(results.length);
        return results.length;
      },
      show(index) {
        const result = results[index];
        if (!result) return;
        highlight?.dispose();
        void viewer.highlightSearchResult(result).then((handle) => {
          highlight = handle;
        });
      },
      clear() {
        results = [];
        highlight?.dispose();
        highlight = null;
        viewer.clearSearchHighlights();
      },
    },
    destroy() {
      highlight?.dispose();
      viewer.destroy();
      element.replaceChildren();
    },
  };
};

type Relationships = { readonly rels: Map<string, { readonly targetMode?: string; readonly type: string }> };

/** Drop relationships to media outside the file before any slide, layout or master renders. */
function blockExternalMedia(presentation: PresentationData) {
  const owners: Relationships[] = [...presentation.slides, ...presentation.layouts.values(), ...presentation.masters.values()];
  for (const owner of owners) {
    for (const [id, rel] of owner.rels) {
      if (rel.targetMode?.trim().toLowerCase() === "external" && !rel.type.toLowerCase().endsWith("/hyperlink")) owner.rels.delete(id);
    }
  }
}
