/**
 * Word draws many bullets and check marks with Symbol and Wingdings, fonts
 * browsers don't have, by private-use code points (U+F020–U+F0FF) that mean
 * nothing in any other font. These are their Unicode equivalents.
 */
const symbol: Record<number, string> = {
  0xb7: "•", 0xa7: "▪", 0x6f: "○", 0xa8: "◆", 0xd8: "➢", 0xe0: "◊", 0xae: "→", 0xac: "←",
  0xad: "↑", 0xaf: "↓", 0xb0: "°", 0xb1: "±", 0xb4: "×", 0xb8: "÷", 0xb9: "≠", 0xa3: "≤", 0xb3: "≥",
  0xa5: "∞", 0xd6: "√", 0xe5: "∑", 0xd5: "∏", 0x70: "π", 0x61: "α", 0x62: "β", 0x67: "γ", 0x64: "δ",
  0x6d: "μ", 0x73: "σ", 0x57: "Ω", 0x44: "Δ", 0xa9: "♦", 0xaa: "♥", 0xab: "♠", 0xa2: "′",
};
const wingdings: Record<number, string> = {
  0x9f: "•", 0x6c: "●", 0x6e: "■", 0x71: "❑", 0x75: "◆", 0x76: "❖", 0xa7: "▪", 0xa8: "◻", 0xd8: "➢",
  0xe0: "➔", 0xe8: "➔", 0xf0: "⇨", 0xfc: "✓", 0xfb: "✗", 0xfd: "☒", 0xfe: "☑", 0xa1: "○", 0x77: "⬥",
  0x4a: "☺", 0x4c: "☹", 0x22: "✂", 0x28: "☎", 0x2a: "✉", 0x3f: "✍", 0x46: "☞", 0x43: "👍", 0x51: "✈",
  0xb2: "✧", 0xab: "★", 0x6f: "□", 0x70: "◼", 0x73: "⧫", 0x74: "⬥", 0xef: "⇦", 0xf1: "⇧", 0xf2: "⇩",
};

/** LibreOffice's symbol fonts, which its exports name for bullets. */
const starbats: Record<number, string> = { ...wingdings, 0x6c: "●", 0x6e: "■", 0x75: "◆", 0x76: "❖", 0xb7: "•", 0x9f: "•" };

const fonts: Record<string, Record<number, string>> = {
  symbol,
  wingdings,
  "wingdings 2": wingdings,
  "wingdings 3": wingdings,
  webdings: wingdings,
  starbats,
  starsymbol: starbats,
  opensymbol: starbats,
};

const mapText = (text: string, table: Record<number, string>) =>
  text.replace(/[-]/gu, (char) => table[char.charCodeAt(0) - 0xf000] ?? "•");

const tableFor = (family: string) => fonts[family.split(",")[0]!.trim().replace(/["']/gu, "").toLowerCase()];

/** Replace symbol-font characters with Unicode ones, in list markers and in text. */
export function mapSymbolFonts(root: ParentNode): void {
  for (const style of root.querySelectorAll("style")) {
    // A rule is a run of declarations; map the content of rules that pick a symbol font.
    style.textContent = (style.textContent ?? "").replace(/\{[^{}]*\}/gu, (rule) => {
      const family = /font-family:\s*([^;}]+)/iu.exec(rule)?.[1];
      const table = family ? tableFor(family) : undefined;
      if (!table) return rule.replace(/[-]/gu, (char) => symbol[char.charCodeAt(0) - 0xf000] ?? "•");
      return mapText(rule, table).replace(/font-family:\s*[^;}]+;?/iu, "");
    });
  }
  for (const element of root.querySelectorAll<HTMLElement>("[style*='font-family']")) {
    const table = tableFor(element.style.fontFamily);
    if (!table) continue;
    element.style.removeProperty("font-family");
    const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) node.nodeValue = mapText(node.nodeValue ?? "", table);
  }
}
