// Compiles the Rust core (wasm/) twice into packages/documents/src/core: `wasm` without the PDF
// engine, which every viewer and most conversions use, and `wasm-pdf` with it, loaded only to turn
// a PDF into Markdown. Skipped when the output is newer than every Rust source.
import { execFileSync } from "node:child_process";
import { readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const core = join(root, "packages/documents/src/core");

async function newest(directory) {
  let time = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === "target" || entry.name === "pkg" || entry.name === "www") continue;
    const path = join(directory, entry.name);
    time = Math.max(time, entry.isDirectory() ? await newest(path) : (await stat(path)).mtimeMs);
  }
  return time;
}

const sources = Math.max(await newest(join(root, "src")), await newest(join(root, "wasm")), (await stat(join(root, "Cargo.lock"))).mtimeMs);
for (const [folder, features] of [["wasm", ["--no-default-features"]], ["wasm-pdf", []]]) {
  const out = join(core, folder);
  const built = await stat(join(out, "anydoc_wasm_bg.wasm")).then((info) => info.mtimeMs, () => 0);
  if (built >= sources) continue;
  execFileSync("wasm-pack", ["build", "wasm", "--target", "web", "--release", "--out-dir", out, "--no-pack", "--", ...features], { cwd: root, stdio: "inherit" });
}
