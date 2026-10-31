import { decodeText } from "../../core/parse.js";
import { domSearch } from "../dom-search.js";
import type { RenderFunction } from "../renderer.js";
import { cssZoom } from "../zoom.js";

/** Text and code, through the app's highlighter when it gives one. */
export const render: RenderFunction = async ({ element, bytes, format, name, options }) => {
  const text = decodeText(bytes, format);
  const body = options.highlight ? await options.highlight(text, name) : plain(element.ownerDocument, text);
  element.replaceChildren(body);
  return { zoom: cssZoom(body), search: domSearch(() => body), destroy: () => element.replaceChildren() };
};

function plain(document: Document, text: string) {
  const pre = document.createElement("pre");
  pre.className = "documents-text";
  pre.textContent = text;
  return pre;
}
