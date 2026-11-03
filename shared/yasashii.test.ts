import { describe, expect, test } from "vite-plus/test";
import { checkStyle } from "./yasashii.ts";

const codes = (text: string, level: 1 | 2 | 3 | 4 = 2) =>
  checkStyle(text, level).map((i) => i.code);

describe("checkStyle", () => {
  test("やさしい文は問題なし", () => {
    expect(codes("ほとんどの場合、こうします。例外は少しです。")).toEqual([]);
  });
  test("長すぎる", () => {
    expect(codes("引っ越してきたことを、区役所に知らせるための大切な書類です", 1)).toContain(
      "too_long",
    );
  });
  test("尊敬語・謙譲語", () => {
    expect(codes("窓口にお越しください。")).toContain("keigo");
  });
  test("行政の言い回しは「」の中ならよい", () => {
    expect(codes("「当該」は「その」という意味です。")).toEqual([]);
    expect(codes("当該書類を出します。")).toContain("officialese");
  });
  test("レベル4は断定しない", () => {
    expect(codes("区役所は平日だけ開いています。", 4)).toContain("assertive");
    expect(codes("区役所は平日だけ開いていることが多いです。", 4)).toEqual([]);
  });
});
