/**
 * 補足の文章が「やさしい日本語」の基準に収まっているかを機械的に確かめる。
 * SPEC 7章の「フック」に当たる。生成のたびに走らせ、外れたものは書き直しを依頼する。
 *
 * ここにあるのは最初の叩き台。語彙レベル（N3〜N4）の判定には、使用条件を確認した語彙表が必要（PROGRESS.md 参照）。
 */
import type { Level } from "./types.ts";

export interface StyleIssue {
  code:
    | "too_long"
    | "sentence_too_long"
    | "keigo"
    | "double_negative"
    | "officialese"
    | "kanji_heavy"
    | "assertive";
  message: string;
}

/** 補足の本文の文字数の上限 */
export const MAX_TEXT_CHARS: Record<Level, number> = { 1: 25, 2: 60, 3: 60, 4: 70 };
export const MAX_DETAIL_CHARS = 200;
/** 1文の文字数の上限 */
export const MAX_SENTENCE_CHARS = 40;

const KEIGO = /いたし|ございま|申し上げ|お越し|ご来庁|ご提出|いただ[きくけ]|くださいませ|致し|賜/;
const DOUBLE_NEGATIVE = /ないわけではない|ないことはない|なくはない|ざるを得ない|ないとは限らない/;
/** 説明に使うと、かえって難しくなる行政の言い回し（「」の中で引用するのはよい） */
const OFFICIALESE = [
  "当該",
  "及び",
  "並びに",
  "若しくは",
  "又は",
  "に係る",
  "の際",
  "につき",
  "を要する",
  "速やかに",
  "遅滞なく",
  "に鑑み",
];
/** レベル4（推測を含む）で、断定を避けていることを示す言い方 */
const HEDGE =
  /ことが多い|かもしれ|と思われ|場合があ|ことがあ|多くの|たいてい|ことも|でしょう|ようです|ほうがよい|ほうがいい|確認|とよい|しましょう/;

function stripQuotes(text: string): string {
  return text.replace(/「[^「」]*」/g, "「」").replace(/『[^『』]*』/g, "『』");
}

function sentencesOf(text: string): string[] {
  return text
    .split(/(?<=[。！？!?])/u)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function checkStyle(
  text: string,
  level: Level,
  kind: "text" | "detail" = "text",
): StyleIssue[] {
  const issues: StyleIssue[] = [];
  const body = stripQuotes(text);
  const max = kind === "text" ? MAX_TEXT_CHARS[level] : MAX_DETAIL_CHARS;
  if (text.length > max)
    issues.push({ code: "too_long", message: `${kind} が ${text.length} 字（上限 ${max} 字）` });
  for (const s of sentencesOf(body)) {
    if (s.length > MAX_SENTENCE_CHARS) {
      issues.push({
        code: "sentence_too_long",
        message: `1文が ${s.length} 字（上限 ${MAX_SENTENCE_CHARS} 字）:「${s.slice(0, 20)}…」`,
      });
    }
  }
  const keigo = body.match(KEIGO);
  if (keigo) issues.push({ code: "keigo", message: `尊敬語・謙譲語「${keigo[0]}」を使っている` });
  const dn = body.match(DOUBLE_NEGATIVE);
  if (dn) issues.push({ code: "double_negative", message: `二重否定「${dn[0]}」` });
  const off = OFFICIALESE.find((w) => body.includes(w));
  if (off)
    issues.push({ code: "officialese", message: `説明に行政の言い回し「${off}」を使っている` });
  const letters = Array.from(body).filter((c) => /[\p{L}]/u.test(c));
  const kanji = letters.filter((c) => /\p{Script=Han}/u.test(c)).length;
  // 短い言い換え（「会社員などが入る年金」など）は1語で比率が大きく動くので、ある程度の長さがあるときだけ見る
  if (letters.length >= 15 && kanji / letters.length > 0.45) {
    issues.push({
      code: "kanji_heavy",
      message: `漢字が多い（${Math.round((kanji / letters.length) * 100)}%）`,
    });
  }
  if (level === 4 && kind === "text" && !HEDGE.test(text)) {
    issues.push({
      code: "assertive",
      message: "推測を含むレベル4なのに断定している（「〜ことが多いです」などにする）",
    });
  }
  return issues;
}
