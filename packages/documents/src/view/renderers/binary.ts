import { looksLikeText } from "../../core/detect.js";
import type { RenderFunction } from "../renderer.js";

const shown = 4096;
const hex = (byte: number) => byte.toString(16).padStart(2, "0");

/**
 * A file nothing else can show. Text shows as text; anything else as its
 * first bytes, sixteen to a row, with the printable characters beside them.
 */
export const render: RenderFunction = async (context) => {
  if (looksLikeText(context.bytes)) return (await import("./text.js")).render(context);
  const { element, bytes, name } = context;
  const rows: string[] = [];
  const head = bytes.subarray(0, shown);
  for (let offset = 0; offset < head.length; offset += 16) {
    const row = head.subarray(offset, offset + 16);
    const printable = Array.from(row, (b) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : ".")).join("");
    rows.push(`${offset.toString(16).padStart(8, "0")}  ${Array.from(row, hex).join(" ").padEnd(47)}  ${printable}`);
  }
  const note = element.ownerDocument.createElement("p");
  note.className = "documents-message";
  note.textContent = `${name ?? "This file"} is binary data. ${head.length < bytes.byteLength ? `These are its first ${head.length.toLocaleString()} bytes.` : `It's ${bytes.byteLength.toLocaleString()} bytes long.`}`;
  const pre = element.ownerDocument.createElement("pre");
  pre.className = "documents-text";
  pre.textContent = rows.join("\n");
  element.replaceChildren(note, pre);
  return { destroy: () => element.replaceChildren() };
};
