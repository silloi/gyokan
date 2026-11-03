import { describe, expect, test } from "vite-plus/test";
import type { PageText } from "./types.ts";
import { validateNotes } from "./validate.ts";

const page: PageText = {
  title: "転入届",
  sentences: [
    { id: "s1", blockId: "b1", text: "転入届" },
    { id: "s2", blockId: "b2", text: "原則として、本人が届け出てください。" },
    { id: "s3", blockId: "b3", text: "受付時間は平日 午前8時30分から午後5時までです。" },
  ],
};

const base = { reading: "", detail: "", force: "none", confidence: "high" };

describe("validateNotes", () => {
  test("正しい補足はそのまま通り、根拠は verified になる", () => {
    const { notes, dropped } = validateNotes(
      {
        notes: [
          {
            ...base,
            sentenceId: "s2",
            anchor: "原則として",
            text: "ほとんどの場合、こうします。",
            grounding: "page",
            evidence: [{ sentenceId: "s2", quote: "原則として" }],
          },
        ],
      },
      page,
      2,
    );
    expect(dropped).toEqual([]);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({
      id: "L2-01",
      level: 2,
      grounding: "page",
      evidence: [{ verified: true }],
    });
    expect(notes[0]!.issues).toBeUndefined();
  });

  test("存在しない文 ID や、文に無い anchor（レベル1・2）は捨てる", () => {
    const { notes, dropped } = validateNotes(
      {
        notes: [
          { ...base, sentenceId: "s9", anchor: "x", text: "x", grounding: "page", evidence: [] },
          {
            ...base,
            sentenceId: "s2",
            anchor: "必要に応じて",
            text: "x",
            grounding: "page",
            evidence: [],
          },
        ],
      },
      page,
      2,
    );
    expect(notes).toEqual([]);
    expect(dropped).toHaveLength(2);
  });

  test("原文に無い引用は外し、根拠が無くなった page は推測に下げる", () => {
    const { notes } = validateNotes(
      {
        notes: [
          {
            ...base,
            sentenceId: "s3",
            anchor: "",
            text: "混む日は、待つ時間が長いことが多いです。",
            grounding: "page",
            evidence: [{ sentenceId: "s3", quote: "土曜日も開いています" }],
          },
        ],
      },
      page,
      4,
    );
    expect(notes[0]!.grounding).toBe("guess");
    expect(notes[0]!.evidence).toEqual([]);
    expect(notes[0]!.issues!.join("\n")).toContain("見つからない");
  });

  test("空白の違いは許す", () => {
    const { notes } = validateNotes(
      {
        notes: [
          {
            ...base,
            sentenceId: "s3",
            anchor: "",
            text: "平日の昼だけです。",
            force: "info",
            grounding: "page",
            evidence: [{ sentenceId: "s3", quote: "平日午前8時30分" }],
          },
        ],
      },
      page,
      3,
    );
    expect(notes[0]!.evidence[0]!.verified).toBe(true);
  });

  test("レベル3で force が無ければ info にする。レベル4の断定は issues に残す", () => {
    const l3 = validateNotes(
      {
        notes: [
          {
            ...base,
            sentenceId: "s2",
            anchor: "",
            text: "本人が行きます。",
            grounding: "page",
            evidence: [{ sentenceId: "s2", quote: "本人が届け出て" }],
          },
        ],
      },
      page,
      3,
    );
    expect(l3.notes[0]!.force).toBe("info");
    const l4 = validateNotes(
      {
        notes: [
          {
            ...base,
            sentenceId: "s3",
            anchor: "",
            text: "土曜日は開いていません。",
            grounding: "general",
            evidence: [],
          },
        ],
      },
      page,
      4,
    );
    expect(l4.notes[0]!.issues!.some((i) => i.startsWith("[assertive]"))).toBe(true);
  });
});
