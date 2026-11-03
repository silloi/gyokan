/**
 * Claude API で、1ページ分のレベル1〜4の補足を作って JSON に保存する（Worker と同じ処理）。
 * デモ用に補足を前もって作っておくときや、評価用の予測を作るときに使う。
 *
 *   ANTHROPIC_API_KEY=... vpx scripts/annotate-page.ts public/demo/kamome-tennyu.html --out /tmp/kamome.json
 *   ANTHROPIC_API_KEY=... vpx scripts/annotate-page.ts https://www.moj.go.jp/isa/... --api http://localhost:5173
 *
 * オプション: --levels 1,2,3,4  --model claude-opus-5-5  --effort high  --no-repair
 * 費用の目安は実行後に表示する（トークン数）。
 */
import { writeFile } from "node:fs/promises";
import Anthropic from "@anthropic-ai/sdk";
import { generateNotes, type Effort, type GenerateResult } from "../shared/generate.ts";
import { LEVELS, type AnnotationSet, type Level } from "../shared/types.ts";
import { loadPage, parseArgs } from "./lib/page.ts";

const { positional, flags } = parseArgs(process.argv.slice(2));
const source = positional[0];
if (!source) {
  console.error(
    "使い方: vpx scripts/annotate-page.ts <HTML ファイル | URL> [--api <行間のオリジン>] [--out <出力先>] [--levels 1,2,3,4]",
  );
  process.exit(1);
}

const model = typeof flags.model === "string" ? flags.model : "claude-opus-5-5";
const effort = (typeof flags.effort === "string" ? flags.effort : "high") as Effort;
const levels = (
  typeof flags.levels === "string" ? flags.levels.split(",").map(Number) : [...LEVELS]
).filter((l): l is Level => LEVELS.includes(l as Level));

const { page, hash } = await loadPage(source, {
  api: typeof flags.api === "string" ? flags.api : undefined,
  url: typeof flags.url === "string" ? flags.url : undefined,
});
console.error(
  `${page.title}  文 ${page.sentences.length}  pageHash=${hash}  model=${model} effort=${effort}`,
);

// 認証は SDK の既定の順番で探す（ANTHROPIC_API_KEY → ANTHROPIC_AUTH_TOKEN → ant auth login のプロファイル）
const client = new Anthropic();
const started = Date.now();
// レベル別の「サブエージェント」を並列に呼ぶ。2つ目以降はページ本文のキャッシュが効くことがある
const results = await Promise.allSettled(
  levels.map((level) =>
    generateNotes(client, page, level, { model, effort, repair: !flags["no-repair"] }),
  ),
);

const notes: AnnotationSet["notes"] = [];
let generator: GenerateResult["generator"] | undefined;
const total = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  requests: 0,
};
results.forEach((r, i) => {
  const level = levels[i]!;
  if (r.status === "rejected") {
    console.error(`L${level}: 失敗 ${(r.reason as Error).message}`);
    return;
  }
  const { value } = r;
  generator = value.generator;
  notes.push(...value.notes);
  for (const k of Object.keys(total) as (keyof typeof total)[]) total[k] += value.usage[k];
  const issues = value.notes.filter((n) => n.issues?.length).length;
  console.error(
    `L${level}: ${value.notes.length} 件（捨てた ${value.dropped.length} 件、要確認 ${issues} 件）`,
  );
  for (const d of value.dropped) console.error(`   捨てた: ${d.reason}`);
});

const set: AnnotationSet = {
  version: 1,
  pageHash: hash,
  title: page.title,
  url: page.url,
  generatedAt: new Date().toISOString(),
  generator: generator ?? { kind: "claude-api", model, promptVersion: "unknown" },
  sentences: page.sentences,
  notes,
};
if (notes.length === 0) {
  console.error("補足を1件も作れませんでした（API キーや認証の設定を確認してください）");
  process.exit(1);
}
const json = `${JSON.stringify(set, null, 2)}\n`;
if (typeof flags.out === "string") {
  await writeFile(flags.out, json);
  console.error(`→ ${flags.out}`);
} else {
  process.stdout.write(json);
}
console.error(
  `トークン: 入力 ${total.inputTokens}（キャッシュ読み ${total.cacheReadTokens} / 書き ${total.cacheWriteTokens}）・出力 ${total.outputTokens}・リクエスト ${total.requests}・${Math.round((Date.now() - started) / 1000)} 秒`,
);
if (results.some((r) => r.status === "rejected")) process.exit(1);
