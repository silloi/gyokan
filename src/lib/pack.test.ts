import { describe, expect, test } from "vite-plus/test";
import { packRows, type PackItem } from "./pack.ts";

const GAP = 8;
const W = 600;

describe("packRows", () => {
  test("重ならなければ、上の段に横に並べる（階段状にしない）", () => {
    const items: PackItem[] = [
      { want: 0, width: 120, level: 1 },
      { want: 200, width: 150, level: 1 },
      { want: 420, width: 100, level: 1 },
    ];
    expect(packRows(items, W, GAP)).toEqual([
      { row: 0, x: 0 },
      { row: 0, x: 200 },
      { row: 0, x: 420 },
    ]);
  });

  test("重なるものだけ下の段に入れ、空いていれば上の段に戻る", () => {
    const items: PackItem[] = [
      { want: 0, width: 300, level: 1 },
      { want: 100, width: 100, level: 1 }, // 1つ目と重なる → 2段目
      { want: 320, width: 100, level: 1 }, // 1段目が空いている → 1段目
      { want: 250, width: 40, level: 1 }, // 1段目は重なる、2段目は空いている → 2段目
    ];
    expect(packRows(items, W, GAP)).toEqual([
      { row: 0, x: 0 },
      { row: 1, x: 100 },
      { row: 0, x: 320 },
      { row: 1, x: 250 },
    ]);
  });

  test("すき間が足りなければ、同じ段には入れない", () => {
    const items: PackItem[] = [
      { want: 0, width: 100, level: 1 },
      { want: 104, width: 50, level: 1 }, // 100 + 8 > 104
    ];
    expect(packRows(items, W, GAP).map((p) => p.row)).toEqual([0, 1]);
  });

  test("右端からはみ出すときは左へずらし、行より広いものは左端から（その段を1つで使う）", () => {
    const items: PackItem[] = [
      { want: 550, width: 120.4, level: 1 },
      { want: 30, width: 900, level: 3 },
    ];
    const [a, b] = packRows(items, W, GAP);
    expect(a).toEqual({ row: 0, x: 479 }); // 479 + 120.4 <= 600（丸めても右端を越えない）
    expect(b).toEqual({ row: 1, x: 0 });
  });

  test("低いレベルの補足の位置は、高いレベルの補足があっても変わらない", () => {
    const items: PackItem[] = [
      { want: 0, width: 200, level: 2 },
      { want: 100, width: 150, level: 1 },
      { want: 300, width: 120, level: 1 },
      { want: 0, width: 580, level: 4 },
      { want: 0, width: 80, level: 3 },
    ];
    const all = packRows(items, W, GAP);
    for (const k of [1, 2, 3]) {
      const visible = items.map((it, i) => ({ it, i })).filter(({ it }) => it.level <= k);
      const alone = packRows(
        visible.map(({ it }) => it),
        W,
        GAP,
      );
      visible.forEach(({ i }, j) => expect(all[i]).toEqual(alone[j]));
    }
    // レベル1の2つは1段目。レベル2は1段目と重なるので2段目。
    // レベル3は1段目の左（0〜80）が空いているので1段目。レベル4は行の幅いっぱいなので3段目
    expect(all.map((p) => p.row)).toEqual([1, 0, 0, 2, 0]);
  });

  test("見えるレベルの補足がある段は上から続く（見えない段が上に挟まらない）", () => {
    const items: PackItem[] = Array.from({ length: 12 }, (_, i) => ({
      want: (i * 97) % 500,
      width: 60 + ((i * 53) % 200),
      level: 1 + (i % 4),
    }));
    const packed = packRows(items, W, GAP);
    for (const k of [1, 2, 3, 4]) {
      const rows = new Set(packed.filter((_, i) => items[i]!.level <= k).map((p) => p.row));
      expect([...rows].sort((a, b) => a - b)).toEqual([...Array(rows.size).keys()]);
    }
  });
});
