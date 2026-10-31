import type { DocumentFormat } from "./formats.js";

/**
 * Why a document couldn't be read, parsed or shown. The first six codes are
 * the Rust core's own, passed through unchanged.
 */
export type DocumentErrorCode =
  | "unsupported"
  | "needsOcr"
  | "malformed"
  | "encrypted"
  | "resourceLimit"
  | "missingPart"
  /** The source isn't something the package can read, such as a `file:` URL. */
  | "invalidSource"
  /** Fetching a URL source failed. `status` holds the HTTP status when there was one. */
  | "fetchFailed"
  /** The file is larger than the format's byte limit. */
  | "tooLarge"
  | "aborted"
  /** A renderer failed on a file it accepted. */
  | "renderFailed";

const coreCodes = new Set<string>(["unsupported", "needsOcr", "malformed", "encrypted", "resourceLimit", "missingPart"]);

export interface DocumentErrorDetails {
  readonly code: DocumentErrorCode;
  readonly format?: DocumentFormat | undefined;
  readonly status?: number | undefined;
  /** needsOcr: the 1-indexed pages that need it. */
  readonly pages?: readonly number[] | undefined;
  readonly cause?: unknown;
}

export class DocumentError extends Error {
  override readonly name = "DocumentError";
  readonly code: DocumentErrorCode;
  readonly format: DocumentFormat | undefined;
  readonly status: number | undefined;
  readonly pages: readonly number[] | undefined;

  constructor(message: string, details: DocumentErrorDetails) {
    super(message, { cause: details.cause });
    this.code = details.code;
    this.format = details.format;
    this.status = details.status;
    this.pages = details.pages;
  }

  /** Any thrown value as a DocumentError. Core and abort errors keep their code; the rest get `fallback`. */
  static from(
    cause: unknown,
    fallback: { readonly code: DocumentErrorCode; readonly message: string; readonly format?: DocumentFormat | undefined },
  ): DocumentError {
    if (cause instanceof DocumentError) return cause;
    const format = fallback.format;
    if (isAbort(cause)) return new DocumentError("Reading the document was cancelled.", { code: "aborted", format, cause });
    if (cause instanceof Error && "code" in cause && typeof cause.code === "string" && coreCodes.has(cause.code)) {
      const pages = "pages" in cause && Array.isArray(cause.pages) ? (cause.pages as number[]) : undefined;
      return new DocumentError(cause.message, { code: cause.code as DocumentErrorCode, format, pages, cause });
    }
    return new DocumentError(fallback.message, { code: fallback.code, format, cause });
  }
}

const isAbort = (cause: unknown) =>
  typeof cause === "object" && cause !== null && "name" in cause && (cause.name === "AbortError" || cause.name === "TimeoutError");
