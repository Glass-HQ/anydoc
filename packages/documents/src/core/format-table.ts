import { formatNames, formats, type FormatInfo } from "./formats.js";

const renderers: Record<FormatInfo["render"], string> = {
  pdf: "Pages, through pdf.js",
  docx: "Pages, through docx-preview",
  pptx: "Slides, through pptx-renderer",
  spreadsheet: "Spreadsheet grid, with the styles, merges and charts the file has",
  document: "Reading view, from the document model",
  markdown: "Formatted, as GitHub renders it",
  text: "Text, or your highlighter",
  image: "The image",
  video: "The browser's video player",
  audio: "The browser's audio player",
  font: "A sample sheet",
  binary: "Text, or its first bytes",
};

const markdown = (info: FormatInfo) =>
  info.parse.kind === "core" ? "Converted" : info.parse.kind === "text" ? "As written" : "A line describing the file";

/** The README's format table, made from the registry so the two can't disagree. */
export function formatTable(): string {
  const rows = formatNames.map((name) => {
    const info: FormatInfo = formats[name];
    const extensions = info.extensions.length ? info.extensions.map((e) => `\`.${e}\``).join(", ") : "anything else";
    return `| ${info.label} | ${extensions} | ${markdown(info)} | ${renderers[info.render]} |`;
  });
  return ["| Format | Extensions | Markdown | Rendered as |", "| --- | --- | --- | --- |", ...rows].join("\n");
}
