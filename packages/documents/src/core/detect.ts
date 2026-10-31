import { formatFromMediaType, formatFromName, type DocumentFormat } from "./formats.js";

export interface DetectInput {
  readonly bytes: Uint8Array;
  readonly name?: string | undefined;
  readonly mediaType?: string | undefined;
}

/**
 * The file's format. Its content decides first, from the signatures the
 * Rust core recognizes plus those of media and fonts. A name or media type
 * decides only for files without a signature (CSV, Markdown, text) or when
 * they agree with the content's family, such as `.xlsm` for a workbook.
 * Anything left over is text when it decodes as UTF-8, and `binary` when not.
 */
export function detectFormat({ bytes, name, mediaType }: DetectInput): DocumentFormat {
  const hinted = (name === undefined ? undefined : formatFromName(name)) ?? (mediaType === undefined ? undefined : formatFromMediaType(mediaType));
  const sniffed = sniff(bytes);
  if (sniffed !== undefined) return sniffed;
  // A package whose main part sits somewhere unusual is named by its relationships, which are
  // usually compressed. Its name decides then, as long as it names a format of the same container.
  if (hinted !== undefined && container(bytes) !== undefined && container(bytes) === containerOf[hinted]) return hinted;
  if (hinted !== undefined && !needsSignature.has(hinted)) return hinted;
  if (!looksLikeText(bytes)) return "binary";
  if (/^\s*(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg[\s>]/iu.test(decodeHead(bytes))) return "svg";
  return hinted === "markdown" || hinted === "csv" || hinted === "tsv" ? hinted : "text";
}

/** Formats with a signature: a name alone never makes a file one of these. */
const needsSignature = new Set<DocumentFormat>([
  "pdf", "docx", "doc", "odt", "rtf", "epub", "pptx", "ppt", "odp", "xlsx", "xlsb", "xls", "ods", "image", "video", "audio", "font",
]);

const containerOf: Partial<Record<DocumentFormat, "zip" | "ole">> = {
  docx: "zip", pptx: "zip", xlsx: "zip", xlsb: "zip", odt: "zip", odp: "zip", ods: "zip", epub: "zip",
  doc: "ole", ppt: "ole", xls: "ole",
};

function container(bytes: Uint8Array): "zip" | "ole" | undefined {
  if (startsWith(bytes, ascii("PK\x03\x04"))) return "zip";
  if (startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return "ole";
  return undefined;
}

/** True when the first 8 KB are UTF-16 with a byte order mark, or UTF-8 with no NUL bytes. */
export function looksLikeText(bytes: Uint8Array): boolean {
  if (startsWith(bytes, [0xff, 0xfe]) || startsWith(bytes, [0xfe, 0xff])) return true;
  const head = bytes.subarray(0, 8192);
  if (head.includes(0)) return false;
  try {
    // A multi-byte character cut off at the end of the sample is still text.
    new TextDecoder("utf-8", { fatal: true }).decode(head, { stream: true });
    return true;
  } catch {
    return false;
  }
}

const decodeHead = (bytes: Uint8Array) => new TextDecoder().decode(bytes.subarray(0, 4096));

const startsWith = (bytes: Uint8Array, signature: readonly number[], offset = 0) =>
  signature.every((byte, index) => bytes[offset + index] === byte);
const ascii = (value: string) => Array.from(value, (char) => char.charCodeAt(0));

function sniff(bytes: Uint8Array): DocumentFormat | undefined {
  if (startsWith(bytes, ascii("{\\rtf"))) return "rtf";
  if (startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return sniffOle(bytes);
  if (startsWith(bytes, ascii("PK\x03\x04"))) return sniffZip(bytes);
  if (indexOf(bytes.subarray(0, 1024), ascii("%PDF-")) >= 0) return "pdf";
  return sniffMedia(bytes);
}

function sniffMedia(bytes: Uint8Array): DocumentFormat | undefined {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47]) || startsWith(bytes, [0xff, 0xd8, 0xff]) || startsWith(bytes, ascii("GIF8"))) return "image";
  if (startsWith(bytes, ascii("BM")) && bytes.length > 14) return "image";
  if (startsWith(bytes, [0, 0, 1, 0]) && bytes.length > 6) return "image";
  if (startsWith(bytes, ascii("RIFF"))) {
    if (startsWith(bytes, ascii("WEBP"), 8)) return "image";
    if (startsWith(bytes, ascii("WAVE"), 8)) return "audio";
  }
  if (startsWith(bytes, ascii("ftyp"), 4)) {
    const brand = String.fromCharCode(...bytes.subarray(8, 12));
    if (/^(?:avi[fs]|hei[cx]|hevc|mif1|msf1)$/u.test(brand)) return "image";
    if (/^M4[AB] $/u.test(brand)) return "audio";
    return "video";
  }
  if (startsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3])) return "video";
  if (startsWith(bytes, ascii("OggS"))) return indexOf(bytes.subarray(0, 256), ascii("theora")) >= 0 ? "video" : "audio";
  if (startsWith(bytes, ascii("fLaC")) || startsWith(bytes, ascii("ID3"))) return "audio";
  // An MPEG audio frame sync, but not a UTF-16 byte order mark.
  if (bytes[0] === 0xff && ((bytes[1] ?? 0) & 0xe0) === 0xe0 && bytes[1] !== 0xfe && bytes[1] !== 0xff && ((bytes[1] ?? 0) & 0x06) !== 0) return "audio";
  if (startsWith(bytes, [0, 1, 0, 0, 0]) || startsWith(bytes, ascii("OTTO")) || startsWith(bytes, ascii("true"))) return "font";
  if (startsWith(bytes, ascii("wOFF")) || startsWith(bytes, ascii("wOF2"))) return "font";
  return undefined;
}

function indexOf(haystack: Uint8Array, needle: readonly number[]): number {
  outer: for (let i = 0; i + needle.length <= haystack.length; i += 1) {
    for (let j = 0; j < needle.length; j += 1) if (haystack[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}

const u16 = (bytes: Uint8Array, offset: number) => (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8);
const u32 = (bytes: Uint8Array, offset: number) => (u16(bytes, offset) | (u16(bytes, offset + 2) << 16)) >>> 0;

const zipMimetypes: Record<string, DocumentFormat> = {
  "application/epub+zip": "epub",
  "application/vnd.oasis.opendocument.text": "odt",
  "application/vnd.oasis.opendocument.spreadsheet": "ods",
  "application/vnd.oasis.opendocument.presentation": "odp",
};

/** OOXML by its parts, ODF and EPUB by the `mimetype` entry they store first and uncompressed. */
function sniffZip(bytes: Uint8Array): DocumentFormat | undefined {
  const firstName = new TextDecoder().decode(bytes.subarray(30, 30 + u16(bytes, 26)));
  if (firstName === "mimetype" && u16(bytes, 8) === 0) {
    const start = 30 + u16(bytes, 26) + u16(bytes, 28);
    const mime = new TextDecoder().decode(bytes.subarray(start, start + u32(bytes, 18))).trim().replace(/-template$/u, "");
    return zipMimetypes[mime];
  }
  const names = zipEntryNames(bytes);
  if (names === undefined) return undefined;
  if (names.has("word/document.xml")) return "docx";
  if (names.has("ppt/presentation.xml")) return "pptx";
  if (names.has("xl/workbook.bin")) return "xlsb";
  if (names.has("xl/workbook.xml")) return "xlsx";
  if (names.has("META-INF/container.xml")) return "epub";
  return undefined;
}

function zipEntryNames(bytes: Uint8Array): Set<string> | undefined {
  let end = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65_557); offset -= 1) {
    if (u32(bytes, offset) === 0x06054b50) {
      end = offset;
      break;
    }
  }
  if (end < 0) return undefined;
  const count = u16(bytes, end + 10);
  let offset = u32(bytes, end + 16);
  const names = new Set<string>();
  const decoder = new TextDecoder();
  for (let entry = 0; entry < count && offset + 46 <= bytes.length; entry += 1) {
    if (u32(bytes, offset) !== 0x02014b50) break;
    const nameLength = u16(bytes, offset + 28);
    names.add(decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength)));
    offset += 46 + nameLength + u16(bytes, offset + 30) + u16(bytes, offset + 32);
  }
  return names;
}

/** Legacy Office by the stream its root storage holds, as the core decides. */
function sniffOle(bytes: Uint8Array): DocumentFormat | undefined {
  const sectorSize = 1 << u16(bytes, 30);
  if (sectorSize !== 512 && sectorSize !== 4096) return undefined;
  const sectorOffset = (sector: number) => (sector + 1) * sectorSize;
  // The FAT's sectors are listed in the header, past which a large file continues in DIFAT sectors.
  const fatSectors: number[] = [];
  for (let i = 0; i < 109; i += 1) {
    const sector = u32(bytes, 76 + i * 4);
    if (sector >= 0xfffffffa) break;
    fatSectors.push(sector);
  }
  const next = (sector: number) => {
    const perSector = sectorSize / 4;
    const fat = fatSectors[Math.floor(sector / perSector)];
    return fat === undefined ? 0xfffffffe : u32(bytes, sectorOffset(fat) + (sector % perSector) * 4);
  };
  const names: string[] = [];
  let sector = u32(bytes, 48);
  for (let guard = 0; sector < 0xfffffffa && guard < 4096; guard += 1) {
    const base = sectorOffset(sector);
    if (base + sectorSize > bytes.length) break;
    for (let entry = base; entry < base + sectorSize; entry += 128) {
      const length = u16(bytes, entry + 64);
      if (length < 2 || length > 64) continue;
      names.push(String.fromCharCode(...Array.from({ length: length / 2 - 1 }, (_, i) => u16(bytes, entry + i * 2))));
    }
    sector = next(sector);
  }
  const has = (name: string) => names.some((entry) => entry.toLowerCase() === name);
  if (has("worddocument")) return "doc";
  if (has("powerpoint document")) return "ppt";
  if (has("workbook") || has("book")) return "xls";
  return undefined;
}
