import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { detectFormat } from "../../src/core/detect.js";
import { formatFromName, formatNames, formats } from "../../src/core/formats.js";
import { toMarkdown } from "../../src/core/parse.js";

const fixtures = join(import.meta.dirname, "../../../../tests/fixtures");
// The core's fixture folders, and the format each folder's files must detect as.
const folders: Record<string, readonly string[]> = {
  csv: ["csv"], doc: ["doc"], docx: ["docx"], epub: ["epub"], odp: ["odp"], ods: ["ods"], odt: ["odt"],
  pdf: ["pdf"], ppt: ["ppt"], pptx: ["pptx"], rtf: ["rtf"], xls: ["xls"], xlsb: ["xlsb"], xlsx: ["xlsx"],
};

describe("registry", () => {
  it("names every extension once", () => {
    const seen = new Map<string, string>();
    for (const name of formatNames) for (const extension of formats[name].extensions) {
      expect(seen.get(extension), extension).toBeUndefined();
      seen.set(extension, name);
    }
  });
  it("maps names case-insensitively", () => {
    expect(formatFromName("Report.XLSM")).toBe("xlsx");
    expect(formatFromName("data.tsv")).toBe("tsv");
    expect(formatFromName("noextension")).toBeUndefined();
  });
});

describe("detection matches the core's fixtures", () => {
  for (const [folder, expected] of Object.entries(folders)) {
    for (const file of readdirSync(join(fixtures, folder))) {
      it(`${folder}/${file}`, () => {
        const bytes = new Uint8Array(readFileSync(join(fixtures, folder, file)));
        expect(expected).toContain(detectFormat({ bytes, name: file }));
      });
    }
  }
  it("never trusts a name over content", () => {
    expect(detectFormat({ bytes: new TextEncoder().encode("hello"), name: "fake.pdf" })).toBe("text");
    expect(detectFormat({ bytes: new Uint8Array([0, 1, 2, 3, 0xff]), name: "fake.docx" })).toBe("binary");
  });
  it("finds svg, tsv and markdown", () => {
    expect(detectFormat({ bytes: new TextEncoder().encode('<?xml version="1.0"?>\n<svg xmlns="x"/>') })).toBe("svg");
    expect(detectFormat({ bytes: new TextEncoder().encode("a\tb\n1\t2\n"), name: "x.tsv" })).toBe("tsv");
    expect(detectFormat({ bytes: new TextEncoder().encode("# Hi"), mediaType: "text/markdown; charset=utf-8" })).toBe("markdown");
  });
});

describe("parsing", () => {
  it("parses every core format to Markdown", async () => {
    for (const folder of ["docx", "doc", "odt", "rtf", "epub", "pptx", "ppt", "odp", "xlsx", "xls", "xlsb", "ods", "csv"]) {
      const file = readdirSync(join(fixtures, folder)).find((name) => !name.startsWith("."))!;
      const markdown = await toMarkdown(new Uint8Array(readFileSync(join(fixtures, folder, file))), { name: file });
      expect(markdown.length, `${folder}/${file}`).toBeGreaterThan(0);
    }
  });
  it("parses tsv through the core's delimiter sniffing", async () => {
    expect(await toMarkdown(new TextEncoder().encode("name\tage\nAda\t36\n"), { name: "people.tsv" })).toContain("| Ada");
  });
});

describe("workbooks", () => {
  it("reads every spreadsheet format", async () => {
    const { toWorkbook } = await import("../../src/core/parse.js");
    for (const path of ["xlsx/sheet.xlsx", "xls/sheet.xls", "xlsb/handmade-sheet.xlsb", "ods/sheet.ods", "csv/sheet.csv"]) {
      const workbook = await toWorkbook(new Uint8Array(readFileSync(join(fixtures, path))), { name: path });
      expect(workbook.sheets[0]!.cells.length, path).toBeGreaterThan(0);
    }
  });
  it("brings charts along", async () => {
    const { toWorkbook } = await import("../../src/core/parse.js");
    const workbook = await toWorkbook(new Uint8Array(readFileSync(join(fixtures, "../../wasm/www/public/samples/workbook.xlsx"))));
    const kinds = workbook.sheets[0]!.drawings.map((d) => d.content.kind);
    expect(kinds).toEqual(["chart", "chart"]);
  });
  it("converts a PDF with the larger build", async () => {
    const markdown = await toMarkdown(new Uint8Array(readFileSync(join(fixtures, "../../wasm/www/public/samples/document.pdf"))));
    expect(markdown.length).toBeGreaterThan(100);
  });
});
