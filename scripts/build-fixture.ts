/**
 * 補足の下書き（人や Claude Code が書いた JSON）を検証して、Worker に同梱する fixture にする。
 * 検証は Claude API の生成結果と同じ validate.ts（根拠の引用の照合・やさしい日本語のチェック）を使う。
 *
 *   vpx scripts/build-fixture.ts fixtures/drafts/kamome-tennyu.draft.json [--strict]
 *   vpx scripts/build-fixture.ts local-notes/drafts/isa-16-3.draft.json --api http://localhost:5173 --no-sentences
 *
 * --strict: 捨てた補足や基準外の補足が1つでもあれば失敗する（フックや CI 用）
 * --api: 下書きの source が URL のとき、起動中の行間の /api/page（Browser Rendering）で取得して文分割する
 * --no-sentences: 出力に本文（文の一覧）を含めない（実在のページの補足を手元に置くとき。本文は再配布しない）
 */
import { readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import {
  LEVELS,
  type AnnotationSet,
  type GeneratorInfo,
  type Level,
  type Note,
} from "../shared/types.ts";
import { styleProblems, validateNotes } from "../shared/validate.ts";
import { loadPage, parseArgs } from "./lib/page.ts";

interface DraftNote {
  sentenceId: string;
  anchor?: string;
  reading?: string;
  text: string;
  detail?: string;
  force?: string;
  grounding?: string;
  evidence?: { sentenceId: string; quote: string }[];
  confidence?: string;
}

interface Draft {
  /** 文分割に使うページ（HTML ファイルのパス） */
  source: string;
  /** 表示用のページの URL */
  url?: string;
  title?: string;
  generator: GeneratorInfo;
  notes: Partial<Record<`${Level}`, DraftNote[]>>;
}

const { positional, flags } = parseArgs(process.argv.slice(2));
const draftPath = positional[0];
if (!draftPath) {
  console.error("使い方: vpx scripts/build-fixture.ts <下書きの JSON> [--out <出力先>] [--strict]");
  process.exit(1);
}

const draft = JSON.parse(await readFile(draftPath, "utf8")) as Draft;
const { page, hash } = await loadPage(draft.source, {
  api: typeof flags.api === "string" ? flags.api : undefined,
});
page.url = draft.url;
if (draft.title) page.title = draft.title;

/** 下書きでは省略できる項目を埋める（レベル1・2の根拠は、既定で anchor そのもの） */
function withDefaults(n: DraftNote, level: Level) {
  const anchor = n.anchor ?? "";
  const evidence =
    n.evidence ?? (level <= 2 && anchor ? [{ sentenceId: n.sentenceId, quote: anchor }] : []);
  return {
    sentenceId: n.sentenceId,
    anchor,
    reading: n.reading ?? "",
    text: n.text,
    detail: n.detail ?? "",
    force: n.force ?? "none",
    grounding: n.grounding ?? (evidence.length ? "page" : "guess"),
    evidence,
    confidence: n.confidence ?? "high",
  };
}

const notes: Note[] = [];
let problems = 0;
for (const level of LEVELS) {
  const raw = (draft.notes[`${level}`] ?? []).map((n) => withDefaults(n, level));
  const { notes: ok, dropped } = validateNotes({ notes: raw }, page, level);
  for (const d of dropped) {
    problems++;
    console.error(`✗ L${level} 捨てた: ${d.reason}  ${JSON.stringify(d.raw).slice(0, 120)}`);
  }
  for (const n of ok) {
    for (const issue of n.issues ?? []) {
      if (
        styleProblems(n).includes(issue) ||
        issue.includes("見つからない") ||
        issue.includes("推測")
      )
        problems++;
      console.error(`! ${n.id} (${n.sentenceId}「${n.anchor || "文全体"}」): ${issue}`);
    }
  }
  notes.push(...ok);
  console.log(`L${level}: ${ok.length} 件（捨てた ${dropped.length} 件）`);
}

const set: AnnotationSet = {
  version: 1,
  pageHash: hash,
  title: page.title,
  url: draft.url,
  generatedAt: new Date().toISOString(),
  generator: draft.generator,
  sentences: flags["no-sentences"] ? [] : page.sentences,
  notes,
};
const out =
  typeof flags.out === "string"
    ? flags.out
    : join(
        dirname(dirname(draftPath)),
        basename(draftPath).replace(/\.draft\.json$/, ".annotations.json"),
      );
await writeFile(out, `${JSON.stringify(set, null, 2)}\n`);
console.log(`→ ${out}  pageHash=${hash}  合計 ${notes.length} 件  問題 ${problems} 件`);
if (flags.strict && problems > 0) process.exit(1);
