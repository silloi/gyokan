/**
 * 行間（gyokan）のデータ型。クライアント・Worker・スクリプトで共有する。
 */

/** 補足のレベル（つまみ）。0 は「原文のみ」なので補足データには現れない */
export type Level = 1 | 2 | 3 | 4;
export type SliderLevel = 0 | Level;
export const LEVELS: readonly Level[] = [1, 2, 3, 4];

export const LEVEL_INFO: Record<SliderLevel, { name: string; description: string }> = {
  0: { name: "原文のみ", description: "何も足さない" },
  1: { name: "ことば", description: "難しい語・漢字の言い換え" },
  2: { name: "言い回し", description: "行政特有の言い回しの、実際の意味" },
  3: { name: "文脈", description: "この文が言いたいこと、義務の強さ" },
  4: { name: "書かれていない前提", description: "日本人なら暗黙に分かる前提・次にやること" },
};

export type BlockKind = "heading" | "paragraph" | "list-item" | "table-cell" | "term" | "other";

/** 文分割の結果。id は "s1", "s2", ... */
export interface SentenceRef {
  id: string;
  blockId: string;
  text: string;
  /** その文があるブロックの種類（見出しかどうかなど）。プロンプトの手がかりに使う */
  blockKind?: BlockKind;
}

/** 補足生成に渡すページ本文（文単位） */
export interface PageText {
  title: string;
  url?: string;
  sentences: SentenceRef[];
}

/**
 * 補足の根拠の種類。
 * - page: ページ内に根拠がある（evidence の引用が原文と一致することを機械的に確認する）
 * - general: ページには書いていない、日本の手続きの一般的な知識
 * - guess: 推測
 */
export type Grounding = "page" | "general" | "guess";

/** レベル3で使う「義務の強さ」 */
export type Force = "must" | "should" | "may" | "must_not" | "info" | "none";

export const FORCE_LABEL: Record<Force, string> = {
  must: "かならず",
  should: "なるべく",
  may: "してもよい",
  must_not: "してはいけない",
  info: "おしらせ",
  none: "",
};

export const GROUNDING_LABEL: Record<Grounding, string> = {
  page: "このページに書いてある",
  general: "一般的な知識（このページには書いていない）",
  guess: "推測",
};

export interface Evidence {
  sentenceId: string;
  /** 原文からの抜き出し（完全一致を検証する） */
  quote: string;
  /** 検証の結果。原文に見つかったら true */
  verified?: boolean;
}

export type Confidence = "high" | "medium" | "low";

export interface Note {
  id: string;
  level: Level;
  sentenceId: string;
  /** 補足をつける原文の部分（文中の完全一致）。空なら文全体 */
  anchor: string;
  /** レベル1: anchor の読み（ひらがな）。不要なら空 */
  reading: string;
  /** 短い補足（やさしい日本語） */
  text: string;
  /** クリックしたときに出す、少し長い説明。不要なら空 */
  detail: string;
  force: Force;
  grounding: Grounding;
  evidence: Evidence[];
  confidence: Confidence;
  /** 検証で見つかった問題（やさしい日本語の基準外、根拠の不一致など） */
  issues?: string[];
  /** 公的な用語集の該当項目（shared/glossary.ts が anchor から機械的に付ける） */
  refs?: NoteRef[];
}

/** 補足の参考にした公的な用語集の項目。出典の書き方は shared/glossary/sources.json */
export interface NoteRef {
  /** 用語集の id（sources.json の id） */
  source: string;
  term: string;
  text?: string;
  en?: string;
  url?: string;
}

export interface GeneratorInfo {
  /** claude-api: Worker / スクリプトから API で生成。claude-code-session: 開発セッションで Claude Code が作成 */
  kind: "claude-api" | "claude-code-session" | "manual";
  model?: string;
  promptVersion: string;
  note?: string;
}

export interface AnnotationSet {
  version: 1;
  pageHash: string;
  title: string;
  url?: string;
  generatedAt: string;
  generator: GeneratorInfo;
  sentences: SentenceRef[];
  notes: Note[];
}

/** /api/page の応答 */
export interface PageResponse {
  requestedUrl: string;
  finalUrl: string;
  title: string;
  html: string;
  /** assets: 同梱のデモページ（自分自身のオリジン）を静的ファイルから直接読んだ */
  fetchedVia: "browser-rendering" | "fetch" | "assets";
  /** Browser Rendering が使えずに fetch に切り替えた理由など */
  warnings: string[];
}

/** /api/annotate の応答 */
export interface AnnotateResponse {
  level: Level;
  pageHash: string;
  source: "fixture" | "imported" | "cache" | "claude";
  notes: Note[];
  generator?: GeneratorInfo;
}

export interface ApiError {
  error: string;
  message: string;
}
