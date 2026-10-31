import type { RenderFunction } from "../renderer.js";
import { cssZoom } from "../zoom.js";

let fonts = 0;
const sizes = [12, 16, 24, 36, 48, 72];

/** A font's sample sheet: the alphabet, digits, and a sentence at several sizes. */
export const render: RenderFunction = async ({ element, bytes, name }) => {
  const family = `documents-font-${++fonts}`;
  const face = new FontFace(family, bytes.slice().buffer);
  await face.load();
  element.ownerDocument.fonts.add(face);
  const doc = element.ownerDocument;
  const sheet = doc.createElement("div");
  sheet.className = "documents-flow";
  sheet.style.fontFamily = `"${family}"`;
  const line = (text: string, size: number) => {
    const p = doc.createElement("p");
    p.textContent = text;
    p.style.fontSize = `${size}px`;
    p.style.margin = "0 0 0.4em";
    p.style.lineHeight = "1.2";
    return p;
  };
  const title = doc.createElement("p");
  title.className = "documents-message";
  title.style.fontFamily = "var(--documents-font)";
  title.textContent = name ?? "";
  sheet.append(
    title,
    line("ABCDEFGHIJKLMNOPQRSTUVWXYZ", 28),
    line("abcdefghijklmnopqrstuvwxyz", 28),
    line("0123456789 !?&@#%(){}[]", 28),
    ...sizes.map((size) => line("The quick brown fox jumps over the lazy dog", size)),
  );
  element.replaceChildren(sheet);
  return {
    zoom: cssZoom(sheet),
    destroy: () => {
      element.ownerDocument.fonts.delete(face);
      element.replaceChildren();
    },
  };
};
