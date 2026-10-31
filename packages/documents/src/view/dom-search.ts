import type { Searchable } from "./renderer.js";

/**
 * Search over rendered text, highlighted with the CSS Custom Highlight API:
 * nothing in the document's DOM changes, so renderers never see the search.
 * Text nodes are read in batches, yielding between them, so a long document
 * stays responsive.
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
      const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      let visited = 0;
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const haystack = (node.nodeValue ?? "").toLocaleLowerCase();
        for (let at = haystack.indexOf(needle); at >= 0; at = haystack.indexOf(needle, at + needle.length)) {
          const range = element.ownerDocument.createRange();
          range.setStart(node, at);
          range.setEnd(node, at + needle.length);
          ranges.push(range);
          all?.add(range);
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
