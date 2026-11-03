/**
 * 日本語テキストの文分割（純粋関数）。DOM には依存しない。
 *
 * ルール:
 * - 「。」「！」「？」(半角 ! ? も) で文を区切る。直後の閉じかっこ・連続する終止記号は前の文に含める
 * - かっこ（「」『』（）など）の中の「。」では区切らない。ただし対応する閉じかっこが無いものは無視する
 * - 改行（<br> など）は必ず文の区切りにする
 * - 前後の空白は文に含めない。記号だけの断片は文として扱わない
 */

export interface Span {
  start: number;
  end: number;
}

const TERMINATORS = new Set(["。", "！", "？", "!", "?"]);
const PAIRS: Record<string, string> = {
  "「": "」",
  "『": "』",
  "（": "）",
  "(": ")",
  "［": "］",
  "【": "】",
  "〔": "〕",
  "〈": "〉",
  "《": "》",
  "｛": "｝",
};
const CLOSERS = new Set(Object.values(PAIRS));
const TRAILING = new Set([...CLOSERS, "”", "’", "』", "」"]);

const WS = /\s/u;
/** 閉じかっこの直後にこの文字が来たら、文はまだ続いている（読点・ひらがな・「又は」「及び」など） */
const CONTINUES = /^[、，,\p{Script=Hiragana}又及若並]/u;
/** 行頭にあると、前の行とは別の項目だとわかる記号（箇条書き・注記・番号） */
const LINE_MARKER = /^[・※●○◎■□◆◇★☆▶▷►＊*\-－‐−→⇒【〔［[（(①-⑳]|^\d+[.．、)）]/u;
/** 行末にあると、次の行へ文が続いているとわかる文字（ひらがな・読点） */
const LINE_CONTINUES_AFTER = /[\p{Script=Hiragana}、，,]$/u;
/** 行頭にあると、前の行の続きだとわかる文字（助詞・読点・閉じかっこ） */
const LINE_CONTINUES_BEFORE = /^[をにがはのとでもへや、，,）)」』]/u;
const ZERO_WIDTH = /[​-‍⁠﻿]/gu;
/** 文字・数字が1つでもあれば「文」とみなす（記号や空白だけの断片を除く） */
const HAS_CONTENT = /[\p{L}\p{N}]/u;

/** 対応が取れているかっこの位置を求める */
function matchedBrackets(text: string): Set<number> {
  const matched = new Set<number>();
  const stack: { ch: string; index: number }[] = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === "\n") {
      stack.length = 0; // 改行をまたぐかっこは対応させない
      continue;
    }
    if (ch in PAIRS) {
      stack.push({ ch, index: i });
    } else if (CLOSERS.has(ch)) {
      // 同じ種類の開きかっこまでさかのぼる（途中の対応しない開きかっこは捨てる）
      for (let k = stack.length - 1; k >= 0; k--) {
        if (PAIRS[stack[k]!.ch] === ch) {
          matched.add(stack[k]!.index);
          matched.add(i);
          stack.length = k;
          break;
        }
      }
    }
  }
  return matched;
}

export function splitSentences(text: string): Span[] {
  const spans: Span[] = [];
  const matched = matchedBrackets(text);

  const push = (from: number, to: number) => {
    let s = from;
    let e = to;
    while (s < e && WS.test(text[s]!)) s++;
    while (e > s && WS.test(text[e - 1]!)) e--;
    if (e > s && HAS_CONTENT.test(text.slice(s, e))) spans.push({ start: s, end: e });
  };

  let start = 0;
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === "\n") {
      push(start, i);
      start = i + 1;
      depth = 0;
      continue;
    }
    if (matched.has(i)) {
      if (ch in PAIRS) {
        depth++;
      } else {
        depth = Math.max(0, depth - 1);
        // 「（〜。）」のように丸かっこの中が句点で終わる場合は、独立した文として閉じかっこの後で区切る。
        // ただし「（〜。）、日本に…」「（〜除く。）又は…」のように後ろへ文が続くときは区切らない
        // （「〜。」と書いてある、のようなかぎかっこは文が続くので、もともと区切らない）
        if (
          depth === 0 &&
          (ch === "）" || ch === ")") &&
          TERMINATORS.has(text[i - 1]!) &&
          !CONTINUES.test(
            text
              .slice(i + 1)
              .trimStart()
              .slice(0, 1),
          )
        ) {
          push(start, i + 1);
          start = i + 1;
        }
      }
      continue;
    }
    if (depth === 0 && TERMINATORS.has(ch)) {
      let j = i + 1;
      while (
        j < text.length &&
        (TERMINATORS.has(text[j]!) || (TRAILING.has(text[j]!) && !matched.has(j)))
      )
        j++;
      push(start, j);
      start = j;
      i = j - 1;
    }
  }
  push(start, text.length);
  return spans;
}

/**
 * <br> による改行のうち、文の途中で折り返しているだけのもの（CMS で見た目を整えるために入れたもの）を、
 * 文の区切りにしないよう空白に置き換える（文字数は変えない）。
 * 例: 「文書が外国語の場合は、翻訳者<br>を明らかにした…」「お時間がかかる<br>場合があります。」
 * 住所の行（「…住民記録係<br>各出張所でも…」）や箇条書き（「…<br>※…」）は区切りのまま残す。
 */
export function softenLineBreaks(text: string): string {
  const lines = text.split("\n");
  if (lines.length < 2) return text;
  let out = lines[0]!;
  for (let k = 1; k < lines.length; k++) {
    const prev = lines[k - 1]!.replace(/^[\s　]+|[\s　]+$/gu, "");
    const next = lines[k]!.replace(/^[\s　]+/u, "");
    // 「（１）手数料額について」のような、番号や記号で始まる短い行は見出しなので区切る
    const prevIsLabel = LINE_MARKER.test(prev) && prev.length <= 24;
    const soft =
      prev.length > 0 &&
      next.length > 0 &&
      !prevIsLabel &&
      !TERMINATORS.has(prev.at(-1)!) &&
      !LINE_MARKER.test(next) &&
      (LINE_CONTINUES_AFTER.test(prev) || LINE_CONTINUES_BEFORE.test(next));
    out += (soft ? " " : "\n") + lines[k]!;
  }
  return out;
}

const CJK = "[\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}ー、。「」『』（）・：]";
/** 和文の文字のあいだにある、改行を含む空白（HTML ソースの折り返し・<br> の折り返し。全角空白の字下げも含む） */
const SOURCE_WRAP = new RegExp(
  `(?<=${CJK})[ \\t\\f\\u00a0\\u3000]*[\\n\\r][ \\t\\n\\r\\f\\u00a0\\u3000]*(?=${CJK})`,
  "gu",
);

/**
 * 表示・プロンプト用に空白を整える。
 * - ゼロ幅の文字（U+200B など）は取り除く
 * - HTML ソースの折り返し（和文の文字のあいだの改行と字下げ）は取り除く
 * - それ以外の半角空白の連続は1つにする（「平日 午前」のような原文の空白は残す）
 * - 全角空白は前後だけ取り除く
 */
export function normalizeText(text: string): string {
  return text
    .replace(ZERO_WIDTH, "")
    .replace(SOURCE_WRAP, "")
    .replace(/[ \t\n\r\f ]+/g, " ")
    .trim();
}
