/**
 * List numbers the way Word counts them. docx-preview numbers lists with CSS
 * counters, which miss Word's start overrides and restart rules; this walks
 * the rendered paragraphs in order and writes each one's marker instead.
 */

interface Level {
  readonly level: number;
  readonly start?: string | number;
  readonly format?: string;
  readonly text?: string;
  readonly restart?: number;
}
interface Numbering {
  readonly numberings: readonly { id: string; abstractId: string; overrides: readonly { level: number; start?: number; numberingLevel?: Level }[] }[];
  readonly abstractNumberings: readonly { id: string; levels: readonly Level[] }[];
}

const roman = (n: number) => {
  const table: [number, string][] = [[1000, "m"], [900, "cm"], [500, "d"], [400, "cd"], [100, "c"], [90, "xc"], [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"]];
  let out = "";
  for (const [value, digits] of table) for (; n >= value; n -= value) out += digits;
  return out;
};
const letters = (n: number) => {
  // Word repeats the letter past z: aa, bb, ...
  const letter = String.fromCharCode(97 + ((n - 1) % 26));
  return letter.repeat(Math.floor((n - 1) / 26) + 1);
};

function format(value: number, kind: string | undefined): string {
  switch (kind) {
    case "upperRoman": return roman(value).toUpperCase();
    case "lowerRoman": return roman(value);
    case "upperLetter": return letters(value).toUpperCase();
    case "lowerLetter": return letters(value);
    case "decimalZero": return String(value).padStart(2, "0");
    case "none": return "";
    default: return String(value);
  }
}

export function numberLists(root: HTMLElement, numbering: Numbering | undefined): void {
  if (!numbering) return;
  const abstracts = new Map(numbering.abstractNumberings.map((a) => [a.id, a]));
  const instances = new Map(numbering.numberings.map((n) => [n.id, n]));
  // Word counts per abstract list: two instances of one list share a count unless an override restarts it.
  const counts = new Map<string, (number | undefined)[]>();
  const started = new Set<string>();
  const levelOf = (numId: string, ilvl: number) => {
    const instance = instances.get(numId);
    const abstract = instance && abstracts.get(instance.abstractId);
    const override = instance?.overrides.find((o) => o.level === ilvl);
    const level = override?.numberingLevel ?? abstract?.levels.find((l) => l.level === ilvl);
    return { instance, level, start: override?.start ?? Number(level?.start ?? 1) };
  };
  for (const paragraph of root.querySelectorAll<HTMLElement>("p[class*='-num-']")) {
    const match = /-num-([^-\s]+)-(\d+)/u.exec(paragraph.className);
    if (!match) continue;
    const [, numId, levelText] = match as unknown as [string, string, string];
    const ilvl = Number(levelText);
    const { instance, level, start } = levelOf(numId, ilvl);
    if (!instance || !level || level.format === "bullet") continue;
    const state = counts.get(instance.abstractId) ?? [];
    counts.set(instance.abstractId, state);
    // A start override restarts the shared count the first time its instance is used.
    const override = instance.overrides.find((o) => o.level === ilvl && o.start !== undefined);
    if (override && !started.has(`${numId}:${ilvl}`)) {
      started.add(`${numId}:${ilvl}`);
      state[ilvl] = undefined;
    }
    state[ilvl] = state[ilvl] === undefined ? start : state[ilvl]! + 1;
    for (let deeper = ilvl + 1; deeper < state.length; deeper += 1) state[deeper] = undefined;
    const text = (level.text ?? `%${ilvl + 1}.`).replace(/%(\d)/gu, (_, n: string) => {
      const at = Number(n) - 1;
      const other = levelOf(numId, at);
      return format(state[at] ?? other.start, other.level?.format);
    });
    // Keep docx-preview's tab or space after the number.
    const original = getComputedStyle(paragraph, "::before").content;
    paragraph.dataset.marker = text + (original.includes("\t") || original.includes("\\9") ? "\t" : "");
  }
}
