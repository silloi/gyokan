import { describe, expect, it } from "vite-plus/test";
import { attachRefs, buildGlossaryBlock, findTerms, lookupTerm } from "./glossary.ts";
import sources from "./glossary/sources.json" with { type: "json" };
import type { Note } from "./types.ts";

const note = (over: Partial<Note>): Note => ({
  id: "L1-1",
  level: 1,
  sentenceId: "s1",
  anchor: "",
  reading: "",
  text: "",
  detail: "",
  force: "none",
  grounding: "page",
  evidence: [],
  confidence: "high",
  ...over,
});

describe("用語集", () => {
  it("どの項目にも出典がある", () => {
    const ids = new Set(sources.map((s) => s.id));
    for (const s of sources) expect(s.attribution).toMatch(/^出典：/);
    expect(lookupTerm("育児休業").every((e) => ids.has(e.source))).toBe(true);
  });

  it("やさしい日本語の説明がある資料を先に返す", () => {
    const [first] = lookupTerm("育児休業");
    expect(first?.source).toBe("plain-japanese-rewrites");
  });

  it("本文から長い語を優先して見つける", () => {
    const found = findTerms([
      { id: "s1", blockId: "b1", text: "育児休業給付金をもらうには、申請が必要です。" },
    ]);
    const terms = found.map((f) => f.term);
    expect(terms).toContain("育児休業給付金");
    expect(terms).not.toContain("育児休業");
    expect(buildGlossaryBlock(found)).toContain("<glossary>");
  });

  it("語への補足の anchor が用語集の語なら出典を付け、文への補足には付けない", () => {
    const [a, b, c] = attachRefs([
      note({ anchor: "育児休業" }),
      note({ level: 3, anchor: "" }),
      note({ anchor: "あいうえお" }),
    ]);
    expect(a?.refs?.[0]?.source).toBe("plain-japanese-rewrites");
    expect(b?.refs).toBeUndefined();
    expect(c?.refs).toBeUndefined();
  });
});
