import { describe, expect, test } from "vite-plus/test";
import { normalizeText, softenLineBreaks, splitSentences } from "./sentences.ts";

const split = (text: string) => splitSentences(text).map((s) => text.slice(s.start, s.end));

describe("splitSentences", () => {
  test("句点で区切る", () => {
    expect(split("転入届を出してください。14日以内です。")).toEqual([
      "転入届を出してください。",
      "14日以内です。",
    ]);
  });

  test("かっこの中の句点では区切らない", () => {
    expect(split("「必ず来てください。」と書いてあります。次の文です。")).toEqual([
      "「必ず来てください。」と書いてあります。",
      "次の文です。",
    ]);
    expect(split("本人確認書類（運転免許証など。コピーは不可）が必要です。")).toEqual([
      "本人確認書類（運転免許証など。コピーは不可）が必要です。",
    ]);
  });

  test("閉じかっこは前の文に含める", () => {
    expect(split("（14日以内に届け出てください。）次へ。")).toEqual([
      "（14日以内に届け出てください。）",
      "次へ。",
    ]);
  });

  test("対応しないかっこがあっても区切れる", () => {
    expect(split("注意（その1。ここから先は別の文。")).toEqual([
      "注意（その1。",
      "ここから先は別の文。",
    ]);
  });

  test("改行は必ず区切りになる", () => {
    expect(split("届出期間\n14日以内")).toEqual(["届出期間", "14日以内"]);
  });

  test("空白や記号だけの断片は文にしない", () => {
    expect(split("  ・  \n※")).toEqual([]);
    expect(split("！？")).toEqual([]);
  });

  test("連続する終止記号はまとめる", () => {
    expect(split("ご注意ください！！次。")).toEqual(["ご注意ください！！", "次。"]);
  });
});

describe("normalizeText", () => {
  test("和文の間の折り返し（改行と字下げ）を消す", () => {
    expect(normalizeText("転入届を\n    提出してください。")).toBe("転入届を提出してください。");
  });
  test("原文の半角空白は1つにして残す", () => {
    expect(normalizeText("午前 8時30分 から   午後 5時")).toBe("午前 8時30分 から 午後 5時");
  });
  test("全角空白は前後だけ取る", () => {
    expect(normalizeText("　平日　午前")).toBe("平日　午前");
  });
});

describe("丸かっこの後ろに文が続くとき", () => {
  test("「（…。）、」「（…。）又は」では区切らない", () => {
    expect(
      split(
        "出頭は要しないものの（出頭していただく場合もあります。）、日本に滞在していることが必要です。",
      ),
    ).toHaveLength(1);
    expect(split("活動（公用を除く。）又は地位（永住者を除く。）を有すること。")).toHaveLength(1);
  });
  test("「（…。）次の文」は区切る", () => {
    expect(split("（14日以内に届け出てください。）次へ。")).toHaveLength(2);
  });
});

describe("softenLineBreaks", () => {
  const lines = (text: string) =>
    splitSentences(softenLineBreaks(text)).map((s) => text.slice(s.start, s.end));
  test("文の途中の改行（<br>）は区切りにしない", () => {
    expect(
      lines("文書が外国語の場合は、翻訳者\nを明らかにした日本語の訳文を添付してください。"),
    ).toHaveLength(1);
    expect(lines("お時間がかかる\n場合があります。")).toHaveLength(1);
    expect(lines("必要書類など発行手続きの\n詳細については、こちらをご覧ください。")).toHaveLength(
      1,
    );
  });
  test("住所の行・箇条書き・文の終わりの改行は区切りのまま", () => {
    expect(
      lines("かもめ区役所 本庁舎2階 区民課 住民記録係\n各出張所でも受け付けています。"),
    ).toHaveLength(2);
    expect(
      lines(
        "転出証明書（前の住所の役所で交付されたもの）\n※マイナンバーカードを利用した方は不要です。",
      ),
    ).toHaveLength(2);
    expect(lines("在留カードをお持ちください。\n次の書類も必要です。")).toHaveLength(2);
    expect(lines("届出期間\n14日以内")).toHaveLength(2);
    expect(
      lines("（１）手数料額について\n許可を受ける在留期間に応じて手数料額が異なります。"),
    ).toHaveLength(2);
    // 行頭に（HTML ソースの改行による）空白があっても見出しと判断する
    expect(
      lines(
        "異なります。\n \n （１）手数料額について\n \u3000\u3000許可を受ける在留期間に応じます。",
      ),
    ).toHaveLength(3);
  });
  test("文字数は変わらない", () => {
    const t = "翻訳者\nを明らかに";
    expect(softenLineBreaks(t)).toHaveLength(t.length);
  });
});

describe("normalizeText（ゼロ幅・全角空白の折り返し）", () => {
  test("ゼロ幅スペースを取り除く", () => {
    expect(normalizeText("\u200b\u3000（２）弁護士又は行政書士\u200b\u200b")).toBe(
      "（２）弁護士又は行政書士",
    );
  });
  test("全角空白をはさんだ折り返しも取り除く", () => {
    expect(normalizeText("次の書類は必\u3000\n\t\u3000\u3000要ありません。")).toBe(
      "次の書類は必要ありません。",
    );
  });
});
