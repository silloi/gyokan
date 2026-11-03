/**
 * ページを文分割して、文 ID と本文を表示する（補足データや正解データを作るときの下準備）。
 *
 *   vpx scripts/segment-page.ts public/demo/kamome-tennyu.html
 *   vpx scripts/segment-page.ts https://www.moj.go.jp/isa/... --api http://localhost:5173 --json
 */
import { loadPage, parseArgs } from "./lib/page.ts";

const { positional, flags } = parseArgs(process.argv.slice(2));
const source = positional[0];
if (!source) {
  console.error(
    "使い方: vpx scripts/segment-page.ts <HTML ファイル | URL> [--api http://localhost:5173] [--url <ページの URL>] [--json]",
  );
  process.exit(1);
}

const { page, hash } = await loadPage(source, {
  api: typeof flags.api === "string" ? flags.api : undefined,
  url: typeof flags.url === "string" ? flags.url : undefined,
});

if (flags.json) {
  console.log(JSON.stringify({ pageHash: hash, ...page }, null, 2));
} else {
  console.log(`# ${page.title}`);
  console.log(`pageHash: ${hash}  文の数: ${page.sentences.length}`);
  let block = "";
  for (const s of page.sentences) {
    if (s.blockId !== block) {
      block = s.blockId;
      console.log(`[${s.blockId}] ${s.blockKind ?? ""}`);
    }
    console.log(`  ${s.id}: ${s.text}`);
  }
}
