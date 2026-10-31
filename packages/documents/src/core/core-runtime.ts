import type { InitInput } from "./wasm/anydoc_wasm.js";

/** One build of the Rust core: without the PDF engine, or with it. */
type CoreModule = typeof import("./wasm/anydoc_wasm.js");
export type CoreTask = "markdown" | "document" | "workbook";

const loaded = new Map<"core" | "pdf", Promise<CoreModule>>();

async function wasmBytes(url: URL): Promise<InitInput> {
  // Node's fetch can't read file: URLs.
  if (url.protocol !== "file:") return url;
  const { readFile } = await import(/* @vite-ignore */ "node:fs/promises");
  return readFile(url);
}

function load(build: "core" | "pdf"): Promise<CoreModule> {
  let module = loaded.get(build);
  if (!module) {
    // Each import is written out so bundlers see both builds and their wasm files.
    module = (build === "pdf"
      ? import("./wasm-pdf/anydoc_wasm.js").then(async (m) => {
          await m.default({ module_or_path: await wasmBytes(new URL("./wasm-pdf/anydoc_wasm_bg.wasm", import.meta.url)) });
          return m as CoreModule;
        })
      : import("./wasm/anydoc_wasm.js").then(async (m) => {
          await m.default({ module_or_path: await wasmBytes(new URL("./wasm/anydoc_wasm_bg.wasm", import.meta.url)) });
          return m;
        }));
    loaded.set(build, module);
  }
  return module;
}

/** Run one task on the Rust core. Only PDF to Markdown loads the larger build. */
export async function runCoreTask(task: CoreTask, bytes: Uint8Array, format: string): Promise<unknown> {
  const core = await load(task === "markdown" && format === "pdf" ? "pdf" : "core");
  const name = format as Parameters<CoreModule["toMarkdownBytes"]>[1];
  switch (task) {
    case "markdown":
      return core.toMarkdownBytes(bytes, name);
    case "document":
      return core.toDocument(bytes, name);
    case "workbook":
      return core.toWorkbook(bytes, name);
  }
}
