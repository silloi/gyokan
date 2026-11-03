/**
 * 補足（*.annotations.json）を、起動中の行間の KV に取り込む（開発用の /api/dev/import を使う）。
 * Claude Code のセッションや人が作った補足を、API キーなしで表示するため。ページの本文は送らない。
 *
 *   vpx scripts/import-notes.ts local-notes/isa-16-3.annotations.json [--api http://localhost:5173]
 */
import { readFile } from "node:fs/promises";
import type { AnnotationSet } from "../shared/types.ts";
import { parseArgs } from "./lib/page.ts";

const { positional, flags } = parseArgs(process.argv.slice(2));
const api = typeof flags.api === "string" ? flags.api : "http://localhost:5173";
if (positional.length === 0) {
  console.error(
    "使い方: vpx scripts/import-notes.ts <*.annotations.json ...> [--api http://localhost:5173]",
  );
  process.exit(1);
}
for (const file of positional) {
  const set = JSON.parse(await readFile(file, "utf8")) as AnnotationSet;
  const res = await fetch(`${api}/api/dev/import`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pageHash: set.pageHash, notes: set.notes, generator: set.generator }),
  });
  const body = await res.text();
  if (!res.ok) {
    console.error(`${file}: 失敗 ${res.status} ${body}`);
    process.exit(1);
  }
  console.log(`${file}: ${body}`);
}
