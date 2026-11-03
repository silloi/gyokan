/**
 * 1つの行の下に入れる補足を、段（行の下の小さな行）に詰めて並べる。DOM を使わない計算だけの部分。
 *
 * - 補足は、語の真下から始める。行の右端からはみ出すときだけ、収まるところまで左へずらす
 * - ほかの補足と重ならない、いちばん上の段に入れる（上が空いていれば上に詰める）
 * - レベルの低い順に置き、同じレベルの中では左から順に置く。
 *   こうすると、つまみをレベル k にしたときに見える補足（レベル k 以下）の位置は、それより上のレベルの補足に左右されない。
 *   つまみを動かしても、すでに見えている補足は動かず、新しく出る補足が空いたところや下の段に入る。
 *   レベル k 以下の補足がある段はいつも上から続いて並ぶので、見えない段（高さ 0）が見える段の上に挟まることもない。
 */

export interface PackItem {
  /** 語の左端の位置（行の左端からの px）。文への補足は 0 */
  want: number;
  /** 補足を1行で表示したときの幅（px） */
  width: number;
  level: number;
}

export interface Packed {
  /** 何段目に入れるか（0 がいちばん上） */
  row: number;
  /** 左端の位置（行の左端からの px） */
  x: number;
}

/**
 * @param lineWidth 行の幅（px）。これより広い補足は、行の左端から折り返して表示する（その段を1つで使う）
 * @param gap 同じ段に並べる補足どうしのすき間（px）
 */
export function packRows(items: readonly PackItem[], lineWidth: number, gap: number): Packed[] {
  const order = items
    .map((_, i) => i)
    .sort((a, b) => items[a]!.level - items[b]!.level || items[a]!.want - items[b]!.want || a - b);
  const rows: { start: number; end: number }[][] = [];
  const out: Packed[] = Array.from({ length: items.length });
  for (const i of order) {
    const item = items[i]!;
    const width = Math.min(item.width, lineWidth);
    // 右端からはみ出さないよう、必要なら左へずらす（整数に丸めても右端を越えないよう、切り捨てる）
    const x = Math.max(0, Math.min(Math.round(item.want), Math.floor(lineWidth - width)));
    const end = x + width;
    let row = rows.findIndex((placed) =>
      placed.every((p) => end + gap <= p.start || p.end + gap <= x),
    );
    if (row < 0) {
      row = rows.length;
      rows.push([]);
    }
    rows[row]!.push({ start: x, end });
    out[i] = { row, x };
  }
  return out;
}
