/**
 * モデルが出した補足を検証して、表示できる形に整える。
 *
 * - 文 ID が存在しない補足は捨てる
 * - anchor が文の中に無いときは、レベル1・2では捨て、レベル3・4では文全体への補足にする
 * - evidence の引用が原文に本当にあるか（空白の違い以外は完全一致）を確かめる。無い引用は捨てる
 * - grounding が "page" なのに確かめられた根拠が無いときは "guess" に下げる（勝手な断定を防ぐ）
 * - やさしい日本語の基準（yasashii.ts）から外れたものは issues に記録する
 */
import { checkStyle } from "./yasashii.ts";
import type { Confidence, Evidence, Force, Grounding, Level, Note, PageText } from "./types.ts";

const FORCES: readonly Force[] = ["must", "should", "may", "must_not", "info", "none"];
const GROUNDINGS: readonly Grounding[] = ["page", "general", "guess"];
const CONFIDENCES: readonly Confidence[] = ["high", "medium", "low"];

export interface DroppedNote {
  reason: string;
  raw: unknown;
}

export interface ValidationResult {
  notes: Note[];
  dropped: DroppedNote[];
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function pick<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(v as T) ? (v as T) : fallback;
}

/** 空白の違いを無視して部分一致するか */
export function containsLoosely(haystack: string, needle: string): boolean {
  const squash = (s: string) => s.replace(/[\s\u200b-\u200d\u2060\ufeff]+/gu, "");
  const n = squash(needle);
  return n.length > 0 && squash(haystack).includes(n);
}

export function validateNotes(
  raw: unknown,
  page: PageText,
  level: Level,
  idPrefix = `L${level}`,
): ValidationResult {
  const sentences = new Map(page.sentences.map((s) => [s.id, s.text]));
  const items = Array.isArray((raw as { notes?: unknown })?.notes)
    ? (raw as { notes: unknown[] }).notes
    : [];
  const notes: Note[] = [];
  const dropped: DroppedNote[] = [];

  for (const item of items) {
    const o = (item ?? {}) as Record<string, unknown>;
    const sentenceId = str(o.sentenceId);
    const sentence = sentences.get(sentenceId);
    if (sentence === undefined) {
      dropped.push({ reason: `存在しない文 ID: ${sentenceId}`, raw: item });
      continue;
    }
    const text = str(o.text);
    if (!text) {
      dropped.push({ reason: "text が空", raw: item });
      continue;
    }
    const issues: string[] = [];

    let anchor = str(o.anchor);
    if (anchor && !containsLoosely(sentence, anchor)) {
      if (level <= 2) {
        dropped.push({ reason: `anchor「${anchor}」が ${sentenceId} に無い`, raw: item });
        continue;
      }
      issues.push(`anchor「${anchor}」が文に無いので、文全体への補足にした`);
      anchor = "";
    }
    if (level <= 2 && !anchor) {
      dropped.push({ reason: "レベル1・2なのに anchor が空", raw: item });
      continue;
    }

    let reading = str(o.reading);
    if (reading && !/^[\p{Script=Hiragana}\p{Script=Katakana}ー・\s]+$/u.test(reading)) {
      issues.push(`reading「${reading}」がかなではないので消した`);
      reading = "";
    }
    if (level !== 1) reading = "";

    const evidence: Evidence[] = [];
    if (Array.isArray(o.evidence)) {
      for (const e of o.evidence as Record<string, unknown>[]) {
        const sid = str(e?.sentenceId);
        const quote = str(e?.quote);
        const target = sentences.get(sid);
        if (target !== undefined && quote && containsLoosely(target, quote)) {
          evidence.push({ sentenceId: sid, quote, verified: true });
        } else {
          issues.push(
            `根拠の引用「${quote.slice(0, 30)}」が ${sid || "(ID なし)"} に見つからないので外した`,
          );
        }
      }
    }

    let grounding = pick(o.grounding, GROUNDINGS, "guess");
    if (grounding === "page" && evidence.length === 0) {
      issues.push("ページ内の根拠を確かめられないので「推測」にした");
      grounding = "guess";
    }

    let force = pick(o.force, FORCES, "none");
    if (level === 3 && force === "none") {
      issues.push("レベル3なのに force が無いので info にした");
      force = "info";
    }
    if (level !== 3) force = "none";

    const detail = str(o.detail);
    for (const issue of checkStyle(text, level, "text"))
      issues.push(`[${issue.code}] ${issue.message}`);
    if (detail)
      for (const issue of checkStyle(detail, level, "detail"))
        issues.push(`[${issue.code}] ${issue.message}`);

    notes.push({
      id: `${idPrefix}-${String(notes.length + 1).padStart(2, "0")}`,
      level,
      sentenceId,
      anchor,
      reading,
      text,
      detail,
      force,
      grounding,
      evidence,
      confidence: pick(o.confidence, CONFIDENCES, "medium"),
      ...(issues.length ? { issues } : {}),
    });
  }
  return { notes, dropped };
}

/** 書き直しの対象にする問題（やさしい日本語の基準・断定） */
export function styleProblems(note: Note): string[] {
  return (note.issues ?? []).filter((i) => i.startsWith("["));
}
