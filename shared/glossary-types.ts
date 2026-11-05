/**
 * 用語集（yasashii-refs の公的な用語集から作ったもの）の型。
 * データ本体（shared/glossary/glossary.json）は大きいので Worker とスクリプトだけが読む。
 * 出典の一覧（shared/glossary/sources.json）は小さいので、ブラウザの根拠パネルでも使う。
 */
export type GlossarySourceId =
  | "plain-japanese-rewrites"
  | "mhlw-tagengo-yougo"
  | "jps-nenkin-yougo"
  | "jlt-standard-dict";

export interface GlossarySource {
  id: GlossarySourceId;
  name: string;
  version: string;
  url: string;
  license: string;
  /** 出典の書き方（加工したことも含む）。表示するときはこれをそのまま使う */
  attribution: string;
}

export interface GlossaryEntry {
  term: string;
  reading?: string;
  /** やさしい日本語の説明、または用語集の説明（最初の文） */
  text?: string;
  /** 標準の英訳 */
  en?: string;
  source: GlossarySourceId;
  /** 項目ごとのページがあるとき */
  url?: string;
}
