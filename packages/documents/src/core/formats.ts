/**
 * Every format the package knows, in one table. Detection, size limits,
 * parsing, rendering and the README's format list all read from here, so a
 * format is supported everywhere or nowhere.
 */

/** How a format becomes Markdown. */
export type ParseMethod =
  /** The Rust core, compiled to WebAssembly. The value is the core's format name. */
  | { readonly kind: "core"; readonly format: CoreFormat }
  /** The bytes are already Markdown, or text that becomes a code block. */
  | { readonly kind: "text" }
  /** Nothing to read: the Markdown describes the file. */
  | { readonly kind: "describe" };

/** Format names the Rust core accepts. */
export type CoreFormat = "doc" | "docx" | "odt" | "pdf" | "ppt" | "pptx" | "rtf" | "epub" | "xlsx" | "ods" | "odp" | "csv";

/** Which renderer draws a format. */
export type RenderMethod =
  | "pdf"
  | "docx"
  | "pptx"
  | "spreadsheet"
  /** The core's document model, drawn as a page: legacy and open formats with no native engine. */
  | "document"
  | "markdown"
  | "text"
  | "image"
  | "video"
  | "audio"
  | "font"
  | "binary";

export interface FormatInfo {
  readonly label: string;
  readonly extensions: readonly string[];
  readonly mediaTypes: readonly string[];
  readonly parse: ParseMethod;
  readonly render: RenderMethod;
  /** The most bytes read to parse or render it. */
  readonly maxBytes: number;
}

const MB = 1024 * 1024;
const core = (format: CoreFormat): ParseMethod => ({ kind: "core", format });
const text: ParseMethod = { kind: "text" };
const describe: ParseMethod = { kind: "describe" };

export const formats = {
  pdf: { label: "PDF", extensions: ["pdf"], mediaTypes: ["application/pdf"], parse: core("pdf"), render: "pdf", maxBytes: 200 * MB },
  docx: {
    label: "Word",
    extensions: ["docx", "docm", "dotx", "dotm"],
    mediaTypes: [
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.ms-word.document.macroenabled.12",
    ],
    parse: core("docx"),
    render: "docx",
    maxBytes: 100 * MB,
  },
  doc: { label: "Word 97-2003", extensions: ["doc", "dot"], mediaTypes: ["application/msword"], parse: core("doc"), render: "document", maxBytes: 100 * MB },
  odt: { label: "OpenDocument Text", extensions: ["odt", "ott"], mediaTypes: ["application/vnd.oasis.opendocument.text"], parse: core("odt"), render: "document", maxBytes: 100 * MB },
  rtf: { label: "Rich Text", extensions: ["rtf"], mediaTypes: ["application/rtf", "text/rtf"], parse: core("rtf"), render: "document", maxBytes: 100 * MB },
  epub: { label: "EPUB", extensions: ["epub"], mediaTypes: ["application/epub+zip"], parse: core("epub"), render: "document", maxBytes: 100 * MB },
  pptx: {
    label: "PowerPoint",
    extensions: ["pptx", "pptm", "ppsx", "ppsm", "potx", "potm"],
    mediaTypes: [
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "application/vnd.openxmlformats-officedocument.presentationml.slideshow",
      "application/vnd.ms-powerpoint.presentation.macroenabled.12",
    ],
    parse: core("pptx"),
    render: "pptx",
    maxBytes: 100 * MB,
  },
  ppt: { label: "PowerPoint 97-2003", extensions: ["ppt", "pps", "pot"], mediaTypes: ["application/vnd.ms-powerpoint"], parse: core("ppt"), render: "document", maxBytes: 100 * MB },
  odp: { label: "OpenDocument Presentation", extensions: ["odp", "otp"], mediaTypes: ["application/vnd.oasis.opendocument.presentation"], parse: core("odp"), render: "document", maxBytes: 100 * MB },
  xlsx: {
    label: "Excel",
    extensions: ["xlsx", "xlsm", "xltx", "xltm"],
    mediaTypes: [
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-excel.sheet.macroenabled.12",
    ],
    parse: core("xlsx"),
    render: "spreadsheet",
    maxBytes: 100 * MB,
  },
  xlsb: { label: "Excel Binary", extensions: ["xlsb"], mediaTypes: ["application/vnd.ms-excel.sheet.binary.macroenabled.12"], parse: core("xlsx"), render: "spreadsheet", maxBytes: 100 * MB },
  xls: { label: "Excel 97-2003", extensions: ["xls", "xlt"], mediaTypes: ["application/vnd.ms-excel"], parse: core("xlsx"), render: "spreadsheet", maxBytes: 100 * MB },
  ods: { label: "OpenDocument Spreadsheet", extensions: ["ods", "ots"], mediaTypes: ["application/vnd.oasis.opendocument.spreadsheet"], parse: core("ods"), render: "spreadsheet", maxBytes: 100 * MB },
  csv: { label: "CSV", extensions: ["csv"], mediaTypes: ["text/csv"], parse: core("csv"), render: "spreadsheet", maxBytes: 100 * MB },
  tsv: { label: "TSV", extensions: ["tsv", "tab"], mediaTypes: ["text/tab-separated-values"], parse: core("csv"), render: "spreadsheet", maxBytes: 100 * MB },
  markdown: { label: "Markdown", extensions: ["md", "markdown", "mdown", "mkd"], mediaTypes: ["text/markdown", "text/x-markdown"], parse: text, render: "markdown", maxBytes: 10 * MB },
  text: { label: "Text", extensions: ["txt", "text", "log"], mediaTypes: ["text/plain"], parse: text, render: "text", maxBytes: 10 * MB },
  image: {
    label: "Image",
    extensions: ["png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "ico", "heic", "heif"],
    mediaTypes: ["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif", "image/bmp", "image/x-icon", "image/vnd.microsoft.icon", "image/heic", "image/heif"],
    parse: describe,
    render: "image",
    maxBytes: 100 * MB,
  },
  svg: { label: "SVG", extensions: ["svg"], mediaTypes: ["image/svg+xml"], parse: describe, render: "image", maxBytes: 20 * MB },
  video: {
    label: "Video",
    extensions: ["mp4", "m4v", "mov", "webm", "ogv", "mkv"],
    mediaTypes: ["video/mp4", "video/quicktime", "video/webm", "video/ogg", "video/x-matroska"],
    parse: describe,
    render: "video",
    maxBytes: 1024 * MB,
  },
  audio: {
    label: "Audio",
    extensions: ["mp3", "wav", "ogg", "oga", "opus", "m4a", "aac", "flac", "weba"],
    mediaTypes: ["audio/mpeg", "audio/wav", "audio/x-wav", "audio/ogg", "audio/mp4", "audio/aac", "audio/flac", "audio/webm"],
    parse: describe,
    render: "audio",
    maxBytes: 500 * MB,
  },
  font: {
    label: "Font",
    extensions: ["ttf", "otf", "woff", "woff2"],
    mediaTypes: ["font/ttf", "font/otf", "font/woff", "font/woff2"],
    parse: describe,
    render: "font",
    maxBytes: 50 * MB,
  },
  /** Anything else: UTF-8 shows as text, the rest as its first bytes. */
  binary: { label: "File", extensions: [], mediaTypes: ["application/octet-stream"], parse: describe, render: "binary", maxBytes: 10 * MB },
} as const satisfies Record<string, FormatInfo>;

export type DocumentFormat = keyof typeof formats;

export const formatNames = Object.keys(formats) as DocumentFormat[];

const byExtension = new Map<string, DocumentFormat>();
const byMediaType = new Map<string, DocumentFormat>();
for (const name of formatNames) {
  const info: FormatInfo = formats[name];
  for (const extension of info.extensions) byExtension.set(extension, name);
  for (const type of info.mediaTypes) byMediaType.set(type, name);
}

export const isDocumentFormat = (value: string): value is DocumentFormat => Object.hasOwn(formats, value);

/** The format a file name's extension names, if any. */
export function formatFromName(name: string): DocumentFormat | undefined {
  const extension = /\.([^./\\]+)$/u.exec(name)?.[1]?.toLowerCase();
  return extension === undefined ? undefined : byExtension.get(extension);
}

/** The format a media type names, if any. Parameters such as `charset` are ignored. */
export function formatFromMediaType(type: string): DocumentFormat | undefined {
  const essence = type.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  // A generic container type says nothing about the file inside it.
  if (essence === "application/octet-stream" || essence === "application/zip") return undefined;
  return byMediaType.get(essence);
}
