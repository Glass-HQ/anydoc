import type { Document as CoreDocument, Workbook } from "./wasm/anydoc_wasm.js";
import type { CoreTask } from "./core-runtime.js";
import { detectFormat } from "./detect.js";
import { DocumentError } from "./errors.js";
import { formats, isDocumentFormat, type DocumentFormat, type FormatInfo } from "./formats.js";
import { readSource, type DocumentSource } from "./source.js";

export type { CoreDocument, Workbook };
export type * from "./wasm/anydoc_wasm.js";

export interface OpenOptions {
  /** Skip detection. Needed only when neither the content nor the name says what the file is. */
  readonly format?: DocumentFormat | undefined;
  /** The file's name, when the source doesn't carry one. Helps with CSV, TSV and Markdown. */
  readonly name?: string | undefined;
  readonly mediaType?: string | undefined;
  /** Overrides the format's byte limit. */
  readonly maxBytes?: number | undefined;
  readonly signal?: AbortSignal | undefined;
}

/** A source's bytes, read once, with the format they turned out to be. */
export interface OpenedDocument {
  readonly bytes: Uint8Array;
  readonly format: DocumentFormat;
  readonly name: string | undefined;
}

const largestLimit = Math.max(...Object.values(formats).map((info: FormatInfo) => info.maxBytes));

/** Read a source and detect its format, enforcing that format's byte limit. */
export async function openDocument(source: DocumentSource, options: OpenOptions = {}): Promise<OpenedDocument> {
  const read = await readSource(source, {
    maxBytes: options.maxBytes ?? (options.format ? formats[options.format].maxBytes : largestLimit),
    signal: options.signal,
  });
  const name = options.name ?? read.name;
  const format = options.format ?? detectFormat({ bytes: read.bytes, name, mediaType: options.mediaType ?? read.mediaType });
  const limit = options.maxBytes ?? formats[format].maxBytes;
  if (read.bytes.byteLength > limit && format !== "binary")
    throw new DocumentError(`This ${formats[format].label} file is larger than its ${Math.round(limit / 1024 / 1024)} MB limit.`, { code: "tooLarge", format });
  return { bytes: read.bytes, format, name };
}

/** Any supported file as GitHub-Flavored Markdown. */
export async function toMarkdown(source: DocumentSource | OpenedDocument, options: OpenOptions = {}): Promise<string> {
  const opened = isOpened(source) ? source : await openDocument(source, options);
  const info: FormatInfo = formats[opened.format];
  switch (info.parse.kind) {
    case "core":
      return runCore("markdown", opened.bytes, info.parse.format, opened.format, options.signal) as Promise<string>;
    case "text":
      return decodeText(opened.bytes, opened.format);
    case "describe":
      return describe(opened);
  }
}

/**
 * The core's document model: blocks, notes and embedded assets. PDF has no
 * model (the core turns it straight into Markdown), nor do media and fonts.
 */
export async function toDocument(source: DocumentSource | OpenedDocument, options: OpenOptions = {}): Promise<CoreDocument> {
  const opened = isOpened(source) ? source : await openDocument(source, options);
  const info: FormatInfo = formats[opened.format];
  if (info.parse.kind !== "core" || info.parse.format === "pdf")
    throw new DocumentError(`${info.label} files have no document model.`, { code: "unsupported", format: opened.format });
  return runCore("document", opened.bytes, info.parse.format, opened.format, options.signal) as Promise<CoreDocument>;
}

/** A spreadsheet as the viewer draws it: displayed values, styles, sizes, merges and charts. */
export async function toWorkbook(source: DocumentSource | OpenedDocument, options: OpenOptions = {}): Promise<Workbook> {
  const opened = isOpened(source) ? source : await openDocument(source, options);
  const info: FormatInfo = formats[opened.format];
  if (info.render !== "spreadsheet" || info.parse.kind !== "core")
    throw new DocumentError(`${info.label} files aren't spreadsheets.`, { code: "unsupported", format: opened.format });
  return runCore("workbook", opened.bytes, info.parse.format, opened.format, options.signal) as Promise<Workbook>;
}

const isOpened = (value: unknown): value is OpenedDocument =>
  typeof value === "object" && value !== null && "bytes" in value && "format" in value && typeof value.format === "string" && isDocumentFormat(value.format);

/** Text as a string: UTF-16 when it opens on a byte order mark, UTF-8 otherwise. */
export function decodeText(bytes: Uint8Array, format?: DocumentFormat): string {
  const encoding = bytes[0] === 0xff && bytes[1] === 0xfe ? "utf-16le" : bytes[0] === 0xfe && bytes[1] === 0xff ? "utf-16be" : "utf-8";
  try {
    return new TextDecoder(encoding, { fatal: true }).decode(bytes);
  } catch (cause) {
    throw new DocumentError("The file isn't valid text.", { code: "malformed", format, cause });
  }
}

function describe({ bytes, format, name }: OpenedDocument): string {
  const title = name ?? formats[format].label;
  if (format === "image" || format === "svg") return `![${escapeMarkdown(title)}](<${title.replaceAll(">", "%3E")}>)\n`;
  return `**${escapeMarkdown(title)}**: ${formats[format].label}, ${bytes.byteLength.toLocaleString("en")} bytes.\n`;
}

const escapeMarkdown = (value: string) => value.replace(/[\\`*_[\]<>#|]/gu, "\\$&");

// The core runs on a worker where there is one, so a large file never blocks the page.

export interface CoreRequest { readonly id: number; readonly task: CoreTask; readonly bytes: Uint8Array; readonly format: string }
export type CoreResponse =
  | { readonly id: number; readonly ok: true; readonly value: unknown }
  | { readonly id: number; readonly ok: false; readonly error: { readonly message: string; readonly code?: string; readonly pages?: number[] } };

let worker: Worker | undefined;
let nextId = 0;
const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: unknown) => void }>();

function coreWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL("./parse-worker.js", import.meta.url), { type: "module", name: "documents-core" });
  worker.onmessage = ({ data }: MessageEvent<CoreResponse>) => {
    const task = pending.get(data.id);
    pending.delete(data.id);
    if (!task) return;
    if (data.ok) task.resolve(data.value);
    else task.reject(Object.assign(new Error(data.error.message), data.error));
  };
  worker.onerror = (event) => {
    for (const task of pending.values()) task.reject(new Error(event.message || "The document worker failed."));
    pending.clear();
    worker?.terminate();
    worker = undefined;
  };
  return worker;
}

async function runCore(task: CoreTask, bytes: Uint8Array, coreFormat: string, format: DocumentFormat, signal: AbortSignal | undefined): Promise<unknown> {
  signal?.throwIfAborted();
  const fail = (cause: unknown) => {
    throw DocumentError.from(cause, { code: "malformed", format, message: `Couldn't read this ${formats[format].label} file.` });
  };
  if (typeof Worker === "undefined") return runInline(task, bytes, coreFormat).catch(fail);
  const id = nextId++;
  const result = new Promise<unknown>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    signal?.addEventListener("abort", () => {
      pending.delete(id);
      reject(signal.reason);
    }, { once: true });
  });
  // The worker gets its own copy, so the caller's bytes stay usable.
  coreWorker().postMessage({ id, task, bytes, format: coreFormat } satisfies CoreRequest);
  return result.catch(fail);
}

async function runInline(task: CoreTask, bytes: Uint8Array, format: string): Promise<unknown> {
  const { runCoreTask } = await import("./core-runtime.js");
  return runCoreTask(task, bytes, format);
}
