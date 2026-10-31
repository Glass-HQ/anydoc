# Documents

Parse any file to Markdown and show it in your app. One package for the browser: PDF, Word, PowerPoint, Excel, OpenDocument, RTF, EPUB, CSV and TSV, Markdown and text, images, video, audio and fonts. Every format it reads to Markdown it also renders, and the other way round.

Parsing is [Firecrawl's anydoc](https://github.com/firecrawl/anydoc), a fast Rust converter, compiled to WebAssembly and kept in sync with upstream. Rendering, the format registry and the viewer are this fork's.

**[Try the playground](https://glass-hq.github.io/anydoc/)**: drop in a file to see it rendered and as Markdown. It all runs in your browser; files never leave your machine.

```bash
npm install @glass-hq/documents
```

## Markdown

```js
import { toMarkdown } from '@glass-hq/documents';

const markdown = await toMarkdown(file); // a File, Blob, bytes, URL or stream
```

The format is detected from the bytes; a name or media type only decides for files without a signature, like CSV or Markdown. Conversion runs on a worker, so a large file never blocks the page. `toDocument` stops at the document model, with embedded images as bytes, and `toWorkbook` reads a spreadsheet with its styles, sizes, charts, tables, conditional formats and list validations, already resolved into each cell.

## Rendering

```js
import { createViewer } from '@glass-hq/documents';

const viewer = createViewer(element, file, { onLink: (url) => window.open(url) });
```

The viewer fills `element`, which needs a size, and scrolls inside it. It draws the document and nothing else: no toolbar. Your controls read its state and call its actions:

```js
viewer.subscribe(() => {
  const { status, page, zoom, search, sheets } = viewer.getState();
  // page: { current, total }   PDFs and presentations
  // zoom: { value, min, max }
  // search: { query, total, current, pending }
  // sheets: { names, current } spreadsheets
});

viewer.nextPage();
viewer.zoomIn();
viewer.search('revenue');
viewer.nextMatch();
viewer.selectSheet(1);
const release = viewer.renderThumbnail(3, thumbnailElement, 120); // page or slide 3, for a rail
viewer.destroy();
```

A part of the state is absent when the document has no such thing (a video has no pages), so controls for it never show. Images, video and audio given as a URL stream from it instead of being read into memory.

`@glass-hq/documents/formats` has the format registry and detection alone, with nothing that touches the DOM or loads WebAssembly, for servers and React Native.

### React

```tsx
import { useDocumentViewer } from '@glass-hq/documents/react';

function Viewer({ file }: { file: File }) {
  const { ref, state, viewer } = useDocumentViewer(file);
  return (
    <>
      {state.page && <button onClick={() => viewer?.nextPage()}>Next</button>}
      <div ref={ref} style={{ height: 600 }} />
    </>
  );
}
```

`<DocumentView source={file} />` is the same without controls.

### Options

- `onLink(url)`: links in a document never navigate the page. Clicks on http(s) and mailto links come here.
- `highlight(text, name)`: text and code show plain unless you pass a highlighter. It returns an element, or `{ element, destroy }` when it holds resources. Search reaches into its open shadow roots.
- `pdfWorker`: where pdf.js's worker is served from, if your bundler doesn't resolve it. The package exports it as `@glass-hq/documents/pdf.worker.min.mjs`.
- `format`, `name`, `mediaType`, `maxBytes`, `signal`: as for `toMarkdown`.

### Theming

The viewer's styles sit in a `documents` cascade layer, so any style of yours wins. These custom properties on the element cover the common cases:

| Property                              | What it sets                                   |
| ------------------------------------- | ---------------------------------------------- |
| `--documents-background`              | Behind the pages                               |
| `--documents-page-background`         | The paper of PDF, Word and slide pages         |
| `--documents-page-shadow`             | Around each page                               |
| `--documents-gap`, `--documents-padding` | Space between and around pages              |
| `--documents-match`, `--documents-match-current` | Search highlights                   |
| `--documents-font`, `--documents-mono` | Text in reading views, and text and code      |

The document itself keeps the colors and fonts its file gives it.

### Untrusted files

Every file is treated as hostile. Nothing in a document runs, and nothing loads from the network: macros, scripts, forms, embedded HTML and external media are never executed or fetched, links go through `onLink`, and formats without a layout engine are built node by node from the parsed model rather than from markup. Every format has a byte limit, and readers cap pages, slides and cells.

## Formats

<!-- formats:start -->
| Format | Extensions | Markdown | Rendered as |
| --- | --- | --- | --- |
| PDF | `.pdf` | Converted | Pages, through pdf.js |
| Word | `.docx`, `.docm`, `.dotx`, `.dotm` | Converted | Pages, through docx-preview |
| Word 97-2003 | `.doc`, `.dot` | Converted | Reading view, from the document model |
| OpenDocument Text | `.odt`, `.ott` | Converted | Reading view, from the document model |
| Rich Text | `.rtf` | Converted | Reading view, from the document model |
| EPUB | `.epub` | Converted | Reading view, from the document model |
| PowerPoint | `.pptx`, `.pptm`, `.ppsx`, `.ppsm`, `.potx`, `.potm` | Converted | Slides, through pptx-renderer |
| PowerPoint 97-2003 | `.ppt`, `.pps`, `.pot` | Converted | Reading view, from the document model |
| OpenDocument Presentation | `.odp`, `.otp` | Converted | Reading view, from the document model |
| Excel | `.xlsx`, `.xlsm`, `.xltx`, `.xltm` | Converted | Spreadsheet grid, with the styles, merges and charts the file has |
| Excel Binary | `.xlsb` | Converted | Spreadsheet grid, with the styles, merges and charts the file has |
| Excel 97-2003 | `.xls`, `.xlt` | Converted | Spreadsheet grid, with the styles, merges and charts the file has |
| OpenDocument Spreadsheet | `.ods`, `.ots` | Converted | Spreadsheet grid, with the styles, merges and charts the file has |
| CSV | `.csv` | Converted | Spreadsheet grid, with the styles, merges and charts the file has |
| TSV | `.tsv`, `.tab` | Converted | Spreadsheet grid, with the styles, merges and charts the file has |
| Markdown | `.md`, `.markdown`, `.mdown`, `.mkd` | As written | Formatted, as GitHub renders it |
| Text | `.txt`, `.text`, `.log` | As written | Text, or your highlighter |
| Image | `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.avif`, `.bmp`, `.ico`, `.heic`, `.heif` | A line describing the file | The image |
| SVG | `.svg` | A line describing the file | The image |
| Video | `.mp4`, `.m4v`, `.mov`, `.webm`, `.ogv`, `.mkv` | A line describing the file | The browser's video player |
| Audio | `.mp3`, `.wav`, `.ogg`, `.oga`, `.opus`, `.m4a`, `.aac`, `.flac`, `.weba` | A line describing the file | The browser's audio player |
| Font | `.ttf`, `.otf`, `.woff`, `.woff2` | A line describing the file | A sample sheet |
| File | anything else | A line describing the file | Text, or its first bytes |
<!-- formats:end -->

PDF to Markdown needs text: scanned pages are reported as `needsOcr`. They still render.

## The Rust core

The parser is upstream's, documented below as Firecrawl publishes it: as a crate, a Node.js package, a Python wheel and a WebAssembly module. This fork adds `to_workbook` to it, the spreadsheet model the viewer draws, built from the same readers as the Markdown, and a `pdf` feature (on by default) so builds that never convert PDFs can leave pdf-inspector out.

### Quick start

#### Agent skill

anydoc ships as an [Agent Skill](https://agentskills.io), so your agent can read any document it runs into:

```bash
npx skills add firecrawl/anydoc
```

The [skill](skills/convert-documents-to-markdown/SKILL.md) teaches the agent to convert documents with the anydoc CLI. Works with [Claude Code](https://claude.ai/code), [Codex](https://openai.com/codex/), [Cursor](https://cursor.com), [OpenCode](https://opencode.ai), and any other [compatible agent](https://agentskills.io/clients).

#### CLI

```bash
npx @firecrawl/anydoc report.docx               # Markdown to stdout
npx @firecrawl/anydoc slides.pptx -o slides.md  # or to a file
npx @firecrawl/anydoc - --format csv < data.csv # read stdin
npx @firecrawl/anydoc scan.pdf --ocr hosted     # scanned pages via Firecrawl Parse
```

`npx` downloads the prebuilt binary for your platform on first run. For a permanent `anydoc` command, install globally with `npm install -g @firecrawl/anydoc`. Run `anydoc --help` for all options.

#### Node.js

```bash
npm install @firecrawl/anydoc
```

```js
import { toDocument, toMarkdown, toMarkdownBytes } from '@firecrawl/anydoc';

// From a file path:
const markdown = await toMarkdown('report.docx');

// To enable OCR:
const markdown = await toMarkdown('report.docx', { ocr: 'hosted' );

// From bytes, with the format detected from the content:
const fromBytes = await toMarkdownBytes(bytes);

// Or name it, which signature-less formats (CSV) need:
const fromCsv = await toMarkdownBytes(bytes, 'csv');

// Or stop at the document model, which also carries embedded assets:
const document = await toDocument(bytes);
```

> Full API reference: [node/README.md](node/README.md)

#### Python

```bash
pip install firecrawl-anydoc
```

```python
import anydoc

# From a file path:
markdown = anydoc.to_markdown("report.docx")

# To enable OCR:
markdown = anydoc.to_markdown("report.docx", ocr="hosted")

# From bytes, with the format detected from the content:
markdown = anydoc.to_markdown_bytes(data)

# Or name it, which signature-less formats (CSV) need:
markdown = anydoc.to_markdown_bytes(data, "csv")

# Or stop at the document model, which also carries embedded assets:
document = anydoc.to_document(data)
```

> Full API reference: [python/README.md](python/README.md)

#### Browser (WebAssembly)

```bash
npm install @firecrawl/anydoc-wasm
```

```js
import init, { toMarkdownBytes, toDocument } from '@firecrawl/anydoc-wasm';

await init();

// From bytes, with the format detected from the content:
const markdown = toMarkdownBytes(bytes);

// Or name it, which signature-less formats (CSV) need:
const fromCsv = toMarkdownBytes(bytes, 'csv');

// Or stop at the document model, which also carries embedded assets:
const document = toDocument(bytes);
```

> Full API reference: [wasm/README.md](wasm/README.md)

#### Rust

```bash
cargo add anydoc
```

```rust
// From a file path:
let markdown = anydoc::to_markdown("report.docx")?;

// From bytes, with the format detected from the content:
let markdown = anydoc::to_markdown_bytes(&bytes, None)?;

// Or name it, which signature-less formats (CSV) need:
let markdown = anydoc::to_markdown_bytes(&bytes, anydoc::Format::Csv)?;

// Or stop at the document model, which also carries embedded assets:
let document = anydoc::to_document(&bytes, None)?;
```

### OCR

anydoc reads text-based PDFs locally but does no OCR, so a PDF with scanned or image-only pages fails with `NeedsOcr`. Opt in and those documents go to [Firecrawl Parse](https://firecrawl.dev/parse), which OCRs them and returns the same Markdown. No signup needed; set `FIRECRAWL_API_KEY` for higher limits.

|        | Opt in                                         | Key, else `FIRECRAWL_API_KEY` |
| ------ | ---------------------------------------------- | ----------------------------- |
| CLI    | `anydoc scan.pdf --ocr hosted`                 | `--api-key <key>`             |
| Node   | `toMarkdown('scan.pdf', { ocr: 'hosted' })`    | `apiKey`                      |
| Python | `anydoc.to_markdown("scan.pdf", ocr="hosted")` | `api_key`                     |

Only documents that need OCR leave the machine, and the whole document goes, since Parse has no page selection. If Parse cannot convert it, Node rejects with `code: 'hosted'` and Python raises `HostedError`. `--api-url`, `apiUrl` and `api_url`, else `FIRECRAWL_API_URL`, point at another Parse deployment. `--parse-mode`, `parseMode` and `parse_mode` pick the Parse PDF mode: `auto` (the default) extracts text and falls back to OCR, `fast` extracts text only, `ocr` OCRs every page. The Rust crate has no `ocr` option and never makes network calls.

### Features

- **One output for every format.** Each format parses into a shared document model and renders through a single Markdown serializer, so escaping, tables, heading anchors, and footnotes behave identically whether the input was a `.doc` from 2003 or a `.pptx` from yesterday.
- **Full document structure.** Headings with anchors, bold/italic/strikethrough, inline code and code blocks, links and internal cross-references, bulleted/numbered/nested/task lists with the source's own numbering, tables with merged cells and header rows, block quotes, footnotes and endnotes, and speaker notes.
- **Equations as LaTeX.** Word and PowerPoint (OMML), OpenDocument and EPUB (MathML), and RTF equations convert to GitHub-flavored math: `$...$` inline and `$$` blocks.
- **Embedded assets.** Images and embedded objects render as their alt text in the Markdown, and the raw bytes stay available on the document model, tagged with their media type. Images with an external URL become ordinary Markdown images.
- **Content-based format detection.** The format is read from the bytes themselves (PDF header, RTF open group, OLE stream names, ZIP package mimetype), so mislabeled files still convert correctly.
- **Fast.** Pure Rust, no ML models, no external services. Median conversion time is under 5ms per document.
- **Bindings that stay out of the way.** Node.js conversion runs on the libuv thread pool and never blocks the event loop; Python releases the GIL so other threads keep running. TypeScript types and Python stubs ship with the packages.
- **PDF support built in.** Text-based PDFs convert locally through [pdf-inspector](https://github.com/firecrawl/pdf-inspector), no OCR service required. Scanned pages can opt into [hosted OCR](#scanned-pdfs-ocr).
- **Agent ready.** Ships as an [Agent Skill](#agent-skill): one `npx skills add firecrawl/anydoc` and any agent can read office documents.

### Supported formats

| Format           | Extensions                                                 |
| ---------------- | ---------------------------------------------------------- |
| Word             | `.doc`, `.docx`, `.docm`                                   |
| PowerPoint       | `.ppt`, `.pps`, `.pot`, `.pptx`, `.pptm`, `.ppsx`, `.ppsm` |
| Excel            | `.xls`, `.xlsx`, `.xlsm`, `.xlsb`                          |
| OpenDocument     | `.odt`, `.ods`, `.odp`                                     |
| Rich Text Format | `.rtf`                                                     |
| EPUB             | `.epub`                                                    |
| CSV              | `.csv`                                                     |
| PDF              | `.pdf`                                                     |

### Benchmark

anydoc is measured against six other converters on 100 real-world documents spanning fourteen formats. Scores run from 0 to 100, higher is better; speed is the median time to convert one document.

| tool         | formats   | median ms | docs judged | score  | completeness | structure | formatting | cleanliness |
| ------------ | --------- | --------- | ----------- | ------ | ------------ | --------- | ---------- | ----------- |
| anydoc       | **14/14** | **4.4**   | 94          | **81** | **87**       | **79**    | **78**     | **81**      |
| libreoffice  | 12/14     | 1129.5    | 87          | 40     | 59           | 42        | 40         | 24          |
| unstructured | 8/14      | 572.9     | 58          | 63     | 76           | 59        | 51         | 63          |
| markitdown   | 6/14      | 134.8     | 33          | 65     | 78           | 66        | 60         | 52          |
| pandoc       | 5/14      | 102.1     | 34          | 56     | 74           | 57        | 56         | 38          |
| docling      | 4/14      | 513.6     | 21          | 57     | 60           | 60        | 57         | 51          |
| mammoth      | 1/14      | 52.5      | 8           | 70     | 84           | 71        | 75         | 51          |

Per format, like for like:

| format | anydoc | libreoffice | unstructured | markitdown | pandoc | docling | mammoth |
| ------ | ------ | ----------- | ------------ | ---------- | ------ | ------- | ------- |
| doc    | **87** | 57          | 67           | -          | -      | -       | -       |
| docm   | **84** | 48          | -            | -          | -      | -       | -       |
| docx   | **88** | 56          | 53           | 71         | 68     | 71      | 70      |
| epub   | **77** | -           | 72           | 72         | 52     | -       | -       |
| odp    | **86** | 23          | -            | -          | -      | -       | -       |
| ods    | **82** | 38          | -            | -          | -      | -       | -       |
| odt    | **80** | 51          | 68           | -          | 60     | -       | -       |
| ppt    | **80** | 26          | -            | -          | -      | -       | -       |
| pptx   | **74** | 24          | -            | 66         | -      | 52      | -       |
| rtf    | **88** | 53          | 46           | -          | 45     | -       | -       |
| xls    | **80** | 38          | 66           | 62         | -      | -       | -       |
| xlsm   | **76** | 32          | -            | -          | -      | -       | -       |
| xlsx   | **72** | 30          | 66           | 55         | -      | 47      | -       |

**How quality was scored:** an LLM judge (Claude Sonnet 5) compares two tools' outputs blind against ground truth: the document's first six pages, rendered to images by LibreOffice. Each output is scored on completeness, structure, formatting, and cleanliness. Every pair is judged twice with the outputs swapped to cancel position bias, for 482 verdicts in total. Each tool's `score` averages its per-format scores over the formats it supports, so a corpus heavy in one format can't skew it. It also means each row averages a different set of formats (mammoth's 69 is docx alone, while anydoc's 81 spans all fourteen), so the per-format table is the fair comparison.

Speed is one warm conversion per document on a Ryzen 9 9950X3D (Windows 11, 64 GB DDR5-6400). anydoc and the Python libraries are timed with process spawn excluded; the CLI tools include it, since that is how they are used. The harness lives in [`bench/`](bench/README.md); the corpus is not redistributable and is not in the repo.

**Best fit:** pipelines that receive a mixed bag of office documents and need one consistent, structured Markdown output. In this comparison, anydoc was the only tool to cover all fourteen formats, scored highest on every judged format, and converted documents an order of magnitude faster than the next-fastest tool.

### Format detection

The format is read from the file content, using the marker its specification designates: the PDF header, the RTF open group, OLE stream names, the ZIP package mimetype and content types. CSV has no such marker, so the extension or an explicit format names it instead.

```rust
Format::from_bytes(&bytes); // Some(Format::Docx), or None when nothing matches
Format::from_extension("pptm"); // Some(Format::Pptx)
Format::from_path(Path::new("report.odt")); // Some(Format::Odt)
```

The same three functions exist in Node (`formatFromBytes`, ...) and Python (`anydoc.format_from_bytes`, ...).

### Errors

A conversion returns `Err` only when no complete Markdown could come out of the file. `ConvertError` names what went wrong:

```rust
match anydoc::to_markdown(path) {
    Ok(markdown) => Some(markdown),
    // No document comes out of these, so record the file and take the next one.
    Err(
        error @ (ConvertError::Encrypted
        | ConvertError::Unsupported(_)
        | ConvertError::NeedsOcr { .. }),
    ) => {
        unconverted.push((path, error));
        None
    }
    Err(error) => return Err(error),
}
```

| Variant         | Meaning                                                             |
| --------------- | ------------------------------------------------------------------- |
| `Unsupported`   | Unknown format, or one that cannot be converted                     |
| `NeedsOcr`      | Scanned or image-only pages of a PDF, listed in `pages`             |
| `Malformed`     | Structurally unusable: no meaningful content could be extracted     |
| `Encrypted`     | Encrypted or password-protected                                     |
| `ResourceLimit` | Crossed a fixed safety limit (decompression, nesting, node count)   |
| `MissingPart`   | A part required for any meaningful output is absent                 |
| `Io`            | The file could not be read, from `to_markdown` only                 |

Node and wasm publish the variant name on `error.code`; Python raises one `anydoc.ConvertError` subclass per variant, or `OSError` when the file cannot be read.

anydoc converts locally and does not do OCR, so a PDF with scanned pages fails with `NeedsOcr`. Opt in with `ocr: 'hosted'` in Node, `ocr="hosted"` in Python or `--ocr hosted` on the CLI to send that document to [Firecrawl Parse](https://firecrawl.dev/parse). No signup needed. Set `FIRECRAWL_API_KEY` for higher limits.

### How it works

```
document bytes
  │
  ├─► format detection      → content markers, not the extension
  │
  ├─► format parser          → one per format (doc, docx, ppt, pptx, xls,
  │                            xlsx, odt/ods/odp, rtf, epub, csv)
  │         │
  │         └─► Document     → shared model: blocks, inlines, tables,
  │                            footnotes, assets
  │               │
  │               └─► GFM serializer → Markdown
  │
  └─► PDF → pdf-inspector    → Markdown directly
```

Because every format funnels through the same document model and serializer, output quirks get fixed once. A table-escaping fix for docx is automatically a table-escaping fix for rtf, odt, and everything else.

## Development

```bash
pnpm install
pnpm build        # the Rust core to WebAssembly, then the package
pnpm test
pnpm dev:playground
cargo test        # the Rust core
```

Publishing `@glass-hq/documents`: bump the version in `packages/documents/package.json` and push a `documents-v<version>` tag. Upstream's `v*` tags and release workflow are left as they are.

## License

[MIT](LICENSE). The parser is Firecrawl's anydoc; see [NOTICE](NOTICE).
