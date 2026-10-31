import { DocumentError } from "./errors.js";

/**
 * Where a document's bytes come from. URLs are fetched with `fetch`; only
 * `http:`, `https:` and `blob:` are allowed. A `File` brings its own name.
 */
export type DocumentSource =
  | Blob
  | ArrayBuffer
  | ArrayBufferView
  | ReadableStream<Uint8Array>
  | string
  | URL
  | { readonly url: string | URL; readonly init?: Omit<RequestInit, "signal"> };

export interface ReadOptions {
  /** Reading stops with `tooLarge` past this many bytes. */
  readonly maxBytes: number;
  readonly signal?: AbortSignal | undefined;
}

export interface ReadResult {
  readonly bytes: Uint8Array;
  /** The file name, from a `File` or the URL's last path segment. */
  readonly name: string | undefined;
  /** The media type a Blob or HTTP response declared. */
  readonly mediaType: string | undefined;
}

const allowedProtocols = new Set(["http:", "https:", "blob:"]);

export async function readSource(source: DocumentSource, options: ReadOptions): Promise<ReadResult> {
  const { maxBytes, signal } = options;
  signal?.throwIfAborted();
  if (source instanceof Blob) {
    checkSize(source.size, maxBytes);
    const bytes = new Uint8Array(await source.arrayBuffer());
    signal?.throwIfAborted();
    return { bytes, name: typeof File !== "undefined" && source instanceof File ? source.name : undefined, mediaType: source.type || undefined };
  }
  if (source instanceof ArrayBuffer) {
    checkSize(source.byteLength, maxBytes);
    return { bytes: new Uint8Array(source), name: undefined, mediaType: undefined };
  }
  if (ArrayBuffer.isView(source)) {
    checkSize(source.byteLength, maxBytes);
    return { bytes: new Uint8Array(source.buffer, source.byteOffset, source.byteLength), name: undefined, mediaType: undefined };
  }
  if (source instanceof ReadableStream) {
    return { bytes: await readStream(source, maxBytes, signal), name: undefined, mediaType: undefined };
  }
  const { url: target, init } = typeof source === "string" || source instanceof URL ? { url: source, init: undefined } : source;
  const url = parseUrl(target);
  let response: Response;
  try {
    response = await fetch(url, { ...init, ...(signal ? { signal } : {}) });
  } catch (cause) {
    throw DocumentError.from(cause, { code: "fetchFailed", message: `Couldn't fetch ${url.href}.` });
  }
  if (!response.ok) throw new DocumentError(`Fetching ${url.href} failed with status ${response.status}.`, { code: "fetchFailed", status: response.status });
  const declared = Number(response.headers.get("content-length") ?? Number.NaN);
  if (Number.isFinite(declared)) checkSize(declared, maxBytes);
  const bytes = response.body ? await readStream(response.body, maxBytes, signal) : new Uint8Array(await response.arrayBuffer());
  checkSize(bytes.byteLength, maxBytes);
  return { bytes, name: nameFromUrl(url), mediaType: response.headers.get("content-type") ?? undefined };
}

function parseUrl(value: string | URL): URL {
  let url: URL;
  try {
    url = new URL(value, globalThis.location?.href);
  } catch (cause) {
    throw new DocumentError(`${String(value)} isn't a valid URL.`, { code: "invalidSource", cause });
  }
  if (!allowedProtocols.has(url.protocol)) throw new DocumentError(`${url.protocol} URLs can't be read.`, { code: "invalidSource" });
  return url;
}

function nameFromUrl(url: URL): string | undefined {
  const segment = url.pathname.split("/").at(-1);
  if (!segment) return undefined;
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

async function readStream(stream: ReadableStream<Uint8Array>, maxBytes: number, signal: AbortSignal | undefined): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      signal?.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      checkSize(size, maxBytes);
      chunks.push(value);
    }
  } catch (cause) {
    await reader.cancel(cause).catch(() => undefined);
    throw cause;
  } finally {
    reader.releaseLock();
  }
  if (chunks.length === 1) return chunks[0]!;
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function checkSize(size: number, maxBytes: number) {
  if (size > maxBytes) throw new DocumentError(`The document is larger than the ${formatBytes(maxBytes)} limit.`, { code: "tooLarge" });
}

const formatBytes = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${Math.round(bytes / (1024 * 1024))} MB` : bytes >= 1024 ? `${Math.round(bytes / 1024)} KB` : `${bytes} bytes`;
