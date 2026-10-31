// The format registry and detection on their own, with nothing that touches the DOM or loads
// WebAssembly: safe to import anywhere, including React Native.
export { formats, formatNames, formatFromName, formatFromMediaType, isDocumentFormat } from "./core/formats.js";
export type { DocumentFormat, FormatInfo, ParseMethod, RenderMethod } from "./core/formats.js";
export { detectFormat, looksLikeText } from "./core/detect.js";
