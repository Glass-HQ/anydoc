// Writes the format table into README.md between its markers, from the built package's registry.
// `--check` fails instead when the README is out of date.
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const { formatTable } = await import(join(root, "packages/documents/dist/core/format-table.js"));
const path = join(root, "README.md");
const readme = await readFile(path, "utf8");
const next = readme.replace(/(<!-- formats:start -->\n)[\s\S]*?(<!-- formats:end -->)/u, `$1${formatTable()}\n$2`);
if (process.argv.includes("--check")) {
  if (next !== readme) {
    console.error("README.md's format table is out of date: run `node scripts/format-table.mjs`.");
    process.exit(1);
  }
} else await writeFile(path, next);
