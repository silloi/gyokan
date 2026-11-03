import { readFile, readdir } from "node:fs/promises";
import { describe, expect, test } from "vite-plus/test";
import { pageHash } from "../shared/hash.ts";
import { LEVELS, type AnnotationSet } from "../shared/types.ts";
import { styleProblems, validateNotes } from "../shared/validate.ts";
import { loadPage } from "../scripts/lib/page.ts";

const DIR = new URL("./", import.meta.url);
const files = (await readdir(DIR)).filter((f) => f.endsWith(".annotations.json"));

/** fixture ごとの元ページ（同梱のデモページ） */
const SOURCES: Record<string, string> = {
  "kamome-tennyu.annotations.json": "public/demo/kamome-tennyu.html",
};

describe.each(files)("%s", (file) => {
  test("元ページを文分割した結果とハッシュが一致する（文分割の変更で fixture が使われなくなるのを防ぐ）", async () => {
    const set = JSON.parse(await readFile(new URL(file, DIR), "utf8")) as AnnotationSet;
    const source = SOURCES[file];
    expect(source, `${file} の元ページを SOURCES に書いてください`).toBeDefined();
    const { page, hash } = await loadPage(source!);
    expect(page.sentences).toEqual(set.sentences);
    expect(hash).toBe(set.pageHash);
    expect(await pageHash(set.sentences)).toBe(set.pageHash);
  });

  test("すべての補足が検証を通り、やさしい日本語の基準内にある", async () => {
    const set = JSON.parse(await readFile(new URL(file, DIR), "utf8")) as AnnotationSet;
    const page = { title: set.title, sentences: set.sentences };
    for (const level of LEVELS) {
      const mine = set.notes.filter((n) => n.level === level);
      const { notes, dropped } = validateNotes({ notes: mine }, page, level);
      expect(dropped).toEqual([]);
      expect(
        notes.flatMap((n) => styleProblems(n).map((p) => `${n.sentenceId} ${n.anchor}: ${p}`)),
      ).toEqual([]);
    }
  });
});
