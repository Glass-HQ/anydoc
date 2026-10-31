import type { Searchable } from "./renderer.js";

const highlightCss = `
::highlight(documents-match) { background-color: var(--documents-match, rgb(255 214 0 / 0.45)); color: inherit; }
::highlight(documents-match-current) { background-color: var(--documents-match-current, rgb(255 140 0 / 0.6)); color: inherit; }
`;
const styledRoots = new WeakSet<ShadowRoot>();

/** Highlight styles don't cross into shadow roots, so each one a match lands in gets its own copy. */
function styleShadowRoot(root: ShadowRoot) {
  if (styledRoots.has(root) || typeof CSSStyleSheet === "undefined") return;
  styledRoots.add(root);
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(highlightCss);
  root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
}

/** Every text node under `root`, in document order, including inside open shadow roots. */
function* textNodes(root: Node): Generator<Text> {
  const doc = root.ownerDocument ?? (root as Document);
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeType === Node.TEXT_NODE) yield node as Text;
    else if ((node as Element).shadowRoot) yield* textNodes((node as Element).shadowRoot!);
  }
}

/**
 * Search over rendered text, highlighted with the CSS Custom Highlight API:
 * nothing in the document's DOM changes, so renderers never see the search.
 * Text nodes are read in batches, yielding between them, so a long document
 * stays responsive. Open shadow roots, such as a code highlighter's, are
 * searched too.
 */
export function domSearch(root: () => Element | null): Searchable {
  let ranges: Range[] = [];
  const highlights = typeof CSS !== "undefined" && "highlights" in CSS ? CSS.highlights : undefined;
  const all = typeof Highlight === "undefined" ? undefined : new Highlight();
  const current = typeof Highlight === "undefined" ? undefined : new Highlight();
  if (current) current.priority = 1;
  return {
    async find(query, signal, onMatches) {
      ranges = [];
      const element = root();
      if (!element) return 0;
      const needle = query.toLocaleLowerCase();
      let visited = 0;
      for (const node of textNodes(element)) {
        const haystack = (node.nodeValue ?? "").toLocaleLowerCase();
        for (let at = haystack.indexOf(needle); at >= 0; at = haystack.indexOf(needle, at + needle.length)) {
          const range = element.ownerDocument.createRange();
          range.setStart(node, at);
          range.setEnd(node, at + needle.length);
          ranges.push(range);
          all?.add(range);
          const shadow = node.getRootNode();
          if (shadow instanceof ShadowRoot) styleShadowRoot(shadow);
        }
        if (++visited % 2000 === 0) {
          onMatches(ranges.length);
          await new Promise((resolve) => setTimeout(resolve, 0));
          signal.throwIfAborted();
        }
      }
      if (all && highlights) highlights.set("documents-match", all);
      return ranges.length;
    },
    show(index) {
      const range = ranges[index];
      if (!range) return;
      current?.clear();
      current?.add(range);
      if (current && highlights) highlights.set("documents-match-current", current);
      range.startContainer.parentElement?.scrollIntoView({ block: "center", inline: "nearest" });
    },
    clear() {
      ranges = [];
      all?.clear();
      current?.clear();
    },
  };
}
