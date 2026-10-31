// Everything without a framework: reading, detecting, parsing to Markdown, and the viewer itself.
export { formats, formatNames, formatFromName, formatFromMediaType, isDocumentFormat } from "./core/formats.js";
export type { DocumentFormat, FormatInfo, ParseMethod, RenderMethod } from "./core/formats.js";
export { detectFormat, looksLikeText } from "./core/detect.js";
export { DocumentError } from "./core/errors.js";
export type { DocumentErrorCode, DocumentErrorDetails } from "./core/errors.js";
export { readSource } from "./core/source.js";
export type { DocumentSource, ReadOptions, ReadResult } from "./core/source.js";
export { decodeText, openDocument, toDocument, toMarkdown, toWorkbook } from "./core/parse.js";
export type * from "./core/parse.js";
export { createViewer } from "./view/viewer.js";
export type { DocumentViewer, Highlighted, ViewerOptions } from "./view/viewer.js";
export type { SearchState, ViewerState } from "./view/state.js";
