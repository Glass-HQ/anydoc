import { micromark } from "micromark";
import { gfm, gfmHtml } from "micromark-extension-gfm";
import { decodeText } from "../../core/parse.js";
import { domSearch } from "../dom-search.js";
import { followLinks } from "../links.js";
import type { RenderFunction } from "../renderer.js";
import { cssZoom } from "../zoom.js";

/**
 * Markdown as GitHub renders it. Raw HTML in the file is shown as text, not
 * run, and images only load from the file's own data: URLs, so nothing
 * reaches the network.
 */
export const render: RenderFunction = async ({ element, bytes, format, options }) => {
  const html = micromark(decodeText(bytes, format), { extensions: [gfm()], htmlExtensions: [gfmHtml()] });
  const article = element.ownerDocument.createElement("article");
  article.className = "documents-flow";
  // micromark escapes raw HTML unless told otherwise, so this markup is its own.
  article.innerHTML = html;
  for (const image of article.querySelectorAll("img")) {
    if (!image.src.startsWith("data:image/")) image.removeAttribute("src");
  }
  const stopLinks = followLinks(article, options.onLink);
  element.replaceChildren(article);
  return { zoom: cssZoom(article), search: domSearch(() => article), destroy: () => { stopLinks(); element.replaceChildren(); } };
};
