/**
 * 用語集を引く（Worker とスクリプトで使う。データが大きいのでブラウザでは読まない）。
 *
 * 1. findTerms: ページの本文に出てくる用語集の語を探す（Claude への指示に参考として渡す）
 * 2. attachRefs: 語への補足（anchor）が用語集の語と同じなら、出典を補足に付ける（根拠パネルに出す）
 *
 * 出典は機械的に付ける（モデルの申告には頼らない）。どの補足にも、同じ規則で付く（取り込んだ補足・キャッシュも）。
 */
import entriesJson from "./glossary/glossary.json" with { type: "json" };
import type { GlossaryEntry, GlossarySourceId } from "./glossary-types.ts";
import type { Note, NoteRef, SentenceRef } from "./types.ts";

const ENTRIES = entriesJson as GlossaryEntry[];
/** 同じ語が複数の資料にあるときの優先順（やさしい日本語の説明がある資料を先に） */
const SOURCE_RANK: Record<GlossarySourceId, number> = {
  "plain-japanese-rewrites": 0,
  "mhlw-tagengo-yougo": 1,
  "jps-nenkin-yougo": 2,
  "jlt-standard-dict": 3,
};

let byTerm: Map<string, GlossaryEntry[]> | null = null;
let byFirstChar: Map<string, string[]> | null = null;

function index(): { byTerm: Map<string, GlossaryEntry[]>; byFirstChar: Map<string, string[]> } {
  if (!byTerm || !byFirstChar) {
    byTerm = new Map();
    for (const e of ENTRIES) {
      const list = byTerm.get(e.term) ?? [];
      list.push(e);
      byTerm.set(e.term, list);
    }
    for (const list of byTerm.values())
      list.sort((a, b) => SOURCE_RANK[a.source] - SOURCE_RANK[b.source]);
    byFirstChar = new Map();
    for (const term of byTerm.keys()) {
      const list = byFirstChar.get(term[0]!) ?? [];
      list.push(term);
      byFirstChar.set(term[0]!, list);
    }
    // 長い語から試す（「在留期間更新」を「在留」より先に）
    for (const list of byFirstChar.values()) list.sort((a, b) => b.length - a.length);
  }
  return { byTerm, byFirstChar };
}

export function lookupTerm(term: string): GlossaryEntry[] {
  return index().byTerm.get(term) ?? [];
}

export interface FoundTerm {
  term: string;
  entries: GlossaryEntry[];
  /** 最初に出てくる文 */
  sentenceId: string;
}

/**
 * 本文に出てくる用語集の語を、出てくる順に返す（同じ位置では最も長い語だけ）。
 * やさしい日本語の説明がある語を優先し、多すぎるときは max 件まで。
 */
export function findTerms(sentences: readonly SentenceRef[], max = 60): FoundTerm[] {
  const { byTerm, byFirstChar } = index();
  const found = new Map<string, FoundTerm>();
  for (const s of sentences) {
    const text = s.text;
    for (let i = 0; i < text.length;) {
      const candidates = byFirstChar.get(text[i]!);
      const hit = candidates?.find((t) => text.startsWith(t, i));
      if (!hit) {
        i++;
        continue;
      }
      if (!found.has(hit))
        found.set(hit, { term: hit, entries: byTerm.get(hit)!, sentenceId: s.id });
      i += hit.length;
    }
  }
  const all = [...found.values()];
  if (all.length <= max) return all;
  // やさしい説明がある語 → 長い語の順に残し、出てくる順に戻す
  const order = new Map(all.map((f, i) => [f.term, i]));
  return all
    .sort(
      (a, b) =>
        SOURCE_RANK[a.entries[0]!.source] - SOURCE_RANK[b.entries[0]!.source] ||
        b.term.length - a.term.length,
    )
    .slice(0, max)
    .sort((a, b) => order.get(a.term)! - order.get(b.term)!);
}

/** Claude への指示に添える用語集（ページ本文と同じく全レベル共通なので、キャッシュされる位置に置く） */
export function buildGlossaryBlock(found: readonly FoundTerm[]): string {
  if (found.length === 0) return "";
  const lines = [
    `<glossary>`,
    `このページに出てくる語のうち、公的な用語集にある語（参考。説明をそのまま写さず、読む人に合わせて言い換える。用語集と食い違うことは書かない）:`,
  ];
  for (const f of found) {
    const parts = f.entries.map((e) => {
      const bits = [e.text, e.en ? `英訳: ${e.en}` : ""].filter(Boolean).join(" ／ ");
      return `${bits}［${e.source}］`;
    });
    lines.push(
      `- ${f.term}${f.entries[0]!.reading ? `（${f.entries[0]!.reading}）` : ""}: ${parts.join(" ／ ")}`,
    );
  }
  lines.push(`</glossary>`);
  return lines.join("\n");
}

function toRef(e: GlossaryEntry): NoteRef {
  return {
    source: e.source,
    term: e.term,
    ...(e.text ? { text: e.text } : {}),
    ...(e.en ? { en: e.en } : {}),
    ...(e.url ? { url: e.url } : {}),
  };
}

/**
 * 語への補足（レベル1・2）の anchor が用語集の語と同じとき、または用語集の語が anchor の大部分を占めるとき、
 * 出典（refs）を付ける。すでに refs があるものはそのまま。
 */
export function attachRefs(notes: readonly Note[]): Note[] {
  return notes.map((n) => {
    if (n.refs || !n.anchor || (n.level !== 1 && n.level !== 2)) return n;
    let entries = lookupTerm(n.anchor);
    if (entries.length === 0) {
      const { byFirstChar } = index();
      for (let i = 0; i < n.anchor.length && entries.length === 0; i++) {
        const hit = byFirstChar
          .get(n.anchor[i]!)
          ?.find((t) => t.length >= n.anchor.length * 0.6 && n.anchor.startsWith(t, i));
        if (hit) entries = lookupTerm(hit);
      }
    }
    return entries.length ? { ...n, refs: entries.map(toRef) } : n;
  });
}
