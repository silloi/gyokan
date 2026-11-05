/**
 * yasashii-refs（https://github.com/silloi/yasashii-refs）の公的な用語集から、
 * 補足の根拠に使う小さな用語集（shared/glossary/glossary.json）と出典の一覧（shared/glossary/sources.json）を作る。
 *
 * 使い方: vpx scripts/build-glossary.ts <yasashii-refs のディレクトリ>
 *
 * 使う資料（どれも再配布できる。出典は各 meta.json の attribution をそのまま使う）:
 * - plain-japanese-rewrites: やさしい日本語ガイドライン 別冊「書き換え例」（やさしい日本語での意味）
 * - mhlw-tagengo-yougo: 雇用管理に役立つ多言語用語集（やさしい日本語での説明と英語）
 * - jps-nenkin-yougo: 年金用語集（説明の最初の文）
 * - jlt-standard-dict: 法令用語日英標準対訳辞書（標準の英訳）
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { GlossaryEntry, GlossarySource } from "../shared/glossary-types.ts";

const dir = process.argv[2];
if (!dir) {
  console.error("使い方: vpx scripts/build-glossary.ts <yasashii-refs のディレクトリ>");
  process.exit(1);
}
const data = join(resolve(dir), "data");
const outDir = resolve(import.meta.dirname, "../shared/glossary");

function readJsonl<T>(name: string): T[] {
  return readFileSync(join(data, `${name}.jsonl`), "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as T);
}
function readMeta(name: string): {
  name: string;
  version: string;
  url: string;
  license: string;
  attribution: string;
} {
  return JSON.parse(readFileSync(join(data, `${name}.meta.json`), "utf8"));
}

/** 「選考試験（せんこうしけん）」のような、漢字の後ろの読みがなを外す */
function stripFurigana(s: string): string {
  return s.replace(/（[ぁ-んー]+）/g, "");
}
/** 改行を詰め、最初の文（長すぎるときは途中まで）を返す */
function firstSentences(s: string, max: number): string {
  const flat = s.replace(/\s*\n\s*/g, "").trim();
  let out = "";
  for (const m of flat.matchAll(/[^。]+。?/g)) {
    if (out && out.length + m[0].length > max) break;
    out += m[0];
    if (out.length >= max) break;
  }
  return out.length > max ? `${out.slice(0, max - 1)}…` : out;
}
const KANJI = /[一-鿿々]/;

const SOURCE_IDS = [
  "plain-japanese-rewrites",
  "mhlw-tagengo-yougo",
  "jps-nenkin-yougo",
  "jlt-standard-dict",
] as const;
const sources: GlossarySource[] = SOURCE_IDS.map((id) => {
  const m = readMeta(id);
  return {
    id,
    name: m.name,
    version: m.version,
    url: m.url,
    license: m.license,
    attribution: m.attribution,
  };
});
const entries: GlossaryEntry[] = [];

for (const r of readJsonl<{ term: string; reading?: string; plain: string }>(
  "plain-japanese-rewrites",
)) {
  entries.push({
    term: r.term,
    reading: r.reading,
    text: r.plain.replace(/\(No\.\d+\)/g, ""),
    source: "plain-japanese-rewrites",
  });
}

for (const r of readJsonl<{
  term: string;
  reading?: string;
  ja_easy?: { definition?: string };
  tr?: { en?: { term?: string } };
}>("mhlw-tagengo-yougo")) {
  const text = r.ja_easy?.definition ? stripFurigana(r.ja_easy.definition) : undefined;
  if (!text) continue;
  entries.push({
    term: r.term,
    reading: r.reading,
    text,
    en: r.tr?.en?.term,
    source: "mhlw-tagengo-yougo",
  });
}

for (const r of readJsonl<{ term: string; definition: string; url?: string }>("jps-nenkin-yougo")) {
  entries.push({
    term: r.term,
    text: firstSentences(r.definition, 160),
    source: "jps-nenkin-yougo",
    url: r.url,
  });
}

for (const r of readJsonl<{
  term: string;
  reading?: string;
  translations: { en: string; usage?: string }[];
}>("jlt-standard-dict")) {
  // 1字の語・漢字を含まない語（「及び」「又は」の英訳など）は、補足の手がかりにならないので外す
  if (r.term.length < 2 || !KANJI.test(r.term) || /^[及又並若]/.test(r.term)) continue;
  const en = r.translations
    .slice(0, 3)
    .map((t) => (t.usage ? `${t.en}（${t.usage}）` : t.en))
    .join("; ");
  entries.push({ term: r.term, reading: r.reading, en, source: "jlt-standard-dict" });
}

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "glossary.json"), `${JSON.stringify(entries)}\n`);
writeFileSync(join(outDir, "sources.json"), `${JSON.stringify(sources, null, 2)}\n`);
const counts = Object.fromEntries(
  SOURCE_IDS.map((id) => [id, entries.filter((e) => e.source === id).length]),
);
console.log(`${entries.length} 項目`, counts);
