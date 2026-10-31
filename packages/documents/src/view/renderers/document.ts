import { toDocument, type Block, type CoreDocument, type Inline, type List, type Table } from "../../core/parse.js";
import { domSearch } from "../dom-search.js";
import { followLinks, isAllowedLink } from "../links.js";
import type { RenderFunction } from "../renderer.js";
import { cssZoom } from "../zoom.js";

/**
 * Formats with no layout engine of their own (Word 97-2003, OpenDocument,
 * RTF, EPUB, PowerPoint 97-2003) drawn from the core's document model as a
 * reading page. The DOM is built node by node, never from markup, so
 * nothing in the file can run or load.
 */
export const render: RenderFunction = async ({ element, bytes, format, name, signal, options }) => {
  const model = await toDocument({ bytes, format, name }, { signal });
  const urls: string[] = [];
  const article = new DocumentBuilder(element.ownerDocument, model, urls).build();
  const stopLinks = followLinks(article, options.onLink);
  element.replaceChildren(article);
  return {
    zoom: cssZoom(article),
    search: domSearch(() => article),
    destroy: () => {
      stopLinks();
      for (const url of urls) URL.revokeObjectURL(url);
      element.replaceChildren();
    },
  };
};

class DocumentBuilder {
  readonly #assets = new Map<number, string>();

  constructor(
    readonly doc: Document,
    readonly model: CoreDocument,
    readonly urls: string[],
  ) {}

  build(): HTMLElement {
    const article = this.el("article", "documents-flow");
    article.append(...this.blocks(this.model.blocks));
    if (this.model.notes.length > 0) {
      const notes = this.el("section");
      notes.setAttribute("aria-label", "Notes");
      notes.append(this.el("hr"));
      const list = this.el("ol");
      for (const note of this.model.notes) {
        const item = this.el("li");
        item.id = `note-${note.id}`;
        item.append(...this.blocks(note.blocks));
        list.append(item);
      }
      notes.append(list);
      article.append(notes);
    }
    return article;
  }

  el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
    const node = this.doc.createElement(tag);
    if (className) node.className = className;
    return node;
  }

  blocks(blocks: readonly Block[]): Node[] {
    return blocks.map((block) => this.block(block));
  }

  block(block: Block): Node {
    switch (block.kind) {
      case "heading": {
        const heading = this.el(`h${Math.min(6, Math.max(1, block.level ?? 1))}` as "h1");
        if (block.anchor) heading.id = block.anchor;
        heading.append(...this.inlines(block.content ?? []));
        return heading;
      }
      case "paragraph": {
        const p = this.el("p");
        p.append(...this.inlines(block.content ?? []));
        return p;
      }
      case "list":
        return block.list ? this.list(block.list) : this.doc.createTextNode("");
      case "table":
        return block.table ? this.table(block.table) : this.doc.createTextNode("");
      case "blockQuote": {
        const quote = this.el("blockquote");
        quote.append(...this.blocks(block.blocks ?? []));
        return quote;
      }
      case "codeBlock": {
        const pre = this.el("pre");
        const code = this.el("code");
        code.textContent = block.text ?? "";
        pre.append(code);
        return pre;
      }
      case "math": {
        const math = this.el("pre");
        math.textContent = block.text ?? "";
        return math;
      }
      case "rule":
        return this.el("hr");
    }
  }

  list(list: List): HTMLElement {
    const ordered = list.marker !== "bullet";
    const node = this.el(ordered ? "ol" : "ul");
    if (node instanceof HTMLOListElement) {
      node.start = list.start;
      node.type = ({ decimal: "1", lowerAlpha: "a", upperAlpha: "A", lowerRoman: "i", upperRoman: "I", bullet: "1" } as const)[list.marker];
    }
    for (const item of list.items) {
      const li = this.el("li");
      li.append(...this.blocks(item.blocks));
      node.append(li);
    }
    return node;
  }

  table(table: Table): HTMLElement {
    const node = this.el("table");
    const head = this.el("thead");
    const body = this.el("tbody");
    table.grid.forEach((slots, index) => {
      const row = this.el("tr");
      const header = index < table.headerRows;
      for (const slot of slots) {
        if (slot.kind !== "origin" || !slot.cell) continue;
        const cell = this.el(header ? "th" : "td");
        if (slot.cell.colSpan > 1) cell.colSpan = slot.cell.colSpan;
        if (slot.cell.rowSpan > 1) cell.rowSpan = slot.cell.rowSpan;
        cell.append(...this.blocks(slot.cell.blocks));
        row.append(cell);
      }
      (header ? head : body).append(row);
    });
    if (head.childElementCount > 0) node.append(head);
    node.append(body);
    return node;
  }

  inlines(inlines: readonly Inline[]): Node[] {
    return inlines.map((inline) => this.inline(inline));
  }

  inline(inline: Inline): Node {
    switch (inline.kind) {
      case "text": {
        let node: Node = this.doc.createTextNode(inline.text ?? "");
        const style = inline.style;
        if (style?.code) node = this.wrap("code", node);
        if (style?.strike) node = this.wrap("s", node);
        if (style?.italic) node = this.wrap("em", node);
        if (style?.bold) node = this.wrap("strong", node);
        return node;
      }
      case "link": {
        const a = this.el("a");
        const target = inline.target;
        if (target?.kind === "anchor") a.href = `#${target.value}`;
        else if (target?.kind === "external" && isAllowedLink(target.value)) a.href = target.value;
        a.append(...this.inlines(inline.content ?? []));
        return a;
      }
      case "image": {
        const source = inline.source;
        if (source?.kind !== "asset" || source.assetId === undefined) return this.doc.createTextNode(inline.alt ? `[${inline.alt}]` : "");
        const img = this.el("img");
        img.alt = inline.alt ?? "";
        img.decoding = "async";
        img.loading = "lazy";
        const url = this.asset(source.assetId);
        if (url) img.src = url;
        return img;
      }
      case "anchor": {
        const span = this.el("span");
        if (inline.anchor) span.id = inline.anchor;
        return span;
      }
      case "noteRef": {
        const sup = this.el("sup");
        const a = this.el("a");
        a.href = `#note-${inline.noteId ?? ""}`;
        a.textContent = String(this.model.notes.findIndex((note) => note.id === inline.noteId) + 1);
        sup.append(a);
        return sup;
      }
      case "lineBreak":
        return this.el("br");
      case "math": {
        const code = this.el("code");
        code.textContent = inline.text ?? "";
        return code;
      }
      case "checkbox": {
        const box = this.el("input");
        box.type = "checkbox";
        box.checked = inline.checked ?? false;
        box.disabled = true;
        return box;
      }
    }
  }

  wrap(tag: "strong" | "em" | "s" | "code", child: Node): HTMLElement {
    const node = this.el(tag);
    node.append(child);
    return node;
  }

  asset(id: number): string | undefined {
    const cached = this.#assets.get(id);
    if (cached) return cached;
    const asset = this.model.assets.find((a) => a.id === id);
    if (!asset || !asset.mediaType.startsWith("image/")) return undefined;
    const url = URL.createObjectURL(new Blob([asset.data as BlobPart], { type: asset.mediaType }));
    this.urls.push(url);
    this.#assets.set(id, url);
    return url;
  }
}
