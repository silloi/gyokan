/**
 * ページの DOM から「本文」のブロックと文を見つけ、ID を振る。
 *
 * - 原文のテキストは一切変えない。文の範囲を <gk-s data-s="s12"> で包むだけ（表示上の印）
 * - ブラウザ（iframe 内の document）と Node（jsdom）で同じ結果になるよう、CSS や表示状態には依存しない
 * - nav / aside / パンくずなどのページの枠は対象外。本文の範囲は main 要素などから推定する
 */
import { normalizeText, softenLineBreaks, splitSentences } from "./sentences.ts";
import type { BlockKind, SentenceRef } from "./types.ts";

export type { BlockKind };

export interface SegBlock {
  id: string;
  kind: BlockKind;
  /** 補足ブロックを差し込む基準の要素 */
  host: Element;
  /** 補足を host の中（末尾）に入れるか、host の直後に入れるか */
  placement: "inside" | "after";
  sentenceIds: string[];
}

export interface Segmentation {
  root: Element;
  blocks: SegBlock[];
  sentences: SentenceRef[];
}

export interface SegmentOptions {
  /** 本文の範囲を明示する（省略時は推定） */
  root?: Element;
}

const TEXT_NODE = 3;
const ELEMENT_NODE = 1;

/** 行間が差し込む UI 要素の印。テキスト収集の対象外にする */
export const UI_ATTR = "data-gk-ui";
/** 原文の文を包む要素 */
export const SENTENCE_TAG = "gk-s";

const BLOCK_TAGS = new Set([
  "address",
  "article",
  "aside",
  "blockquote",
  "body",
  "caption",
  "center",
  "dd",
  "details",
  "dialog",
  "dir",
  "div",
  "dl",
  "dt",
  "fieldset",
  "figcaption",
  "figure",
  "footer",
  "form",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hgroup",
  "hr",
  "legend",
  "li",
  "main",
  "menu",
  "nav",
  "ol",
  "p",
  "pre",
  "section",
  "summary",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "tr",
  "ul",
]);

/** 中身をテキストとして読まない要素 */
const SKIP_TAGS = new Set([
  "script",
  "style",
  "noscript",
  "template",
  "svg",
  "math",
  "canvas",
  "iframe",
  "frame",
  "object",
  "embed",
  "video",
  "audio",
  "select",
  "textarea",
  "button",
  "input",
  "head",
  "title",
  "meta",
  "link",
  "map",
  "area",
  "rt",
  "rp",
  "img",
  "picture",
  "source",
  "track",
]);

/** ページの枠（本文ではない部分）。どこにあっても対象外 */
const EXCLUDE_SELECTOR = [
  "nav",
  "aside",
  '[role="navigation"]',
  '[role="search"]',
  '[role="complementary"]',
  "[hidden]",
  '[aria-hidden="true"]',
  ".hidden",
  ".sr-only",
  ".visually-hidden",
  ".screen-reader-text",
  // パンくず（CMS によって名前が違う）
  '[class*="breadcrumb" i]',
  '[id*="breadcrumb" i]',
  '[class*="pankuzu" i]',
  '[id*="pankuzu" i]',
  '[class*="topicpath" i]',
  '[id*="topicpath" i]',
  '[class*="topic-path" i]',
  '[aria-label*="パンくず"]',
  '[aria-label*="breadcrumb" i]',
  // ページ末尾のアンケート（「このページは役に立ちましたか」）
  '[class*="survey" i]',
  '[id*="survey" i]',
  '[class*="enquete" i]',
  '[id*="enquete" i]',
  '[class*="questionnaire" i]',
].join(",");

/** 本文の範囲が body のときだけ対象外にする、ページ全体のヘッダー・フッター */
const PAGE_CHROME_SELECTOR = 'header, footer, [role="banner"], [role="contentinfo"]';

/** 本文の範囲をはっきり示す要素。上から順に試す */
const SEMANTIC_ROOTS = ["main", '[role="main"]'];

/** 日本の自治体・省庁の CMS でよく使われる本文の id。上から順に試す */
const CMS_ROOTS = [
  "#tmp_contents",
  "#main-contents",
  "#main_contents",
  "#mainContents",
  "#contents-main",
  "#main",
  "#contents",
  "#content",
  "article",
];

const HEADING = /^h[1-6]$/;

function isUi(el: Element): boolean {
  return el.hasAttribute(UI_ATTR);
}

function meaningfulLength(text: string | null): number {
  return (text ?? "").replace(/\s+/gu, "").length;
}

/** リンク以外の文字数（メニューやパンくずはほとんどリンクなので、本文の量の目安になる） */
function nonLinkLength(root: Element): number {
  let total = 0;
  const walk = (n: Node, inLink: boolean) => {
    if (n.nodeType === TEXT_NODE) {
      if (!inLink) total += meaningfulLength((n as Text).data);
      return;
    }
    if (n.nodeType !== ELEMENT_NODE) return;
    const el = n as Element;
    const tag = el.localName;
    if (
      SKIP_TAGS.has(tag) ||
      isUi(el) ||
      tag === "nav" ||
      tag === "header" ||
      tag === "footer" ||
      el.matches(EXCLUDE_SELECTOR)
    )
      return;
    for (const c of Array.from(el.childNodes)) walk(c, inLink || tag === "a");
  };
  walk(root, false);
  return total;
}

/**
 * main 要素などが無いページで、本文の範囲を推定する。
 * ページの見出し（ヘッダーの外にある最初の h1）から親をたどり、body の手前までの祖先のうち
 * 「リンク以外の文字数」が最大のものの 7 割以上を含む、いちばん内側の要素を本文とする。
 * （body 全体と比べないのは、ページ末尾の翻訳ウィジェットの言語一覧などで合計が大きく膨らむため）
 */
function guessContentRoot(doc: Document): Element | null {
  const body = doc.body;
  if (!body) return null;
  const inChrome = (el: Element) =>
    el.closest(
      'header, nav, footer, [role="banner"], [role="navigation"], [role="contentinfo"]',
    ) !== null;
  const start =
    Array.from(doc.querySelectorAll("h1")).find((h) => !inChrome(h)) ??
    Array.from(doc.querySelectorAll("h2")).find((h) => !inChrome(h));
  if (!start) return null;
  const chain: Element[] = [];
  for (let el = start.parentElement; el && el !== body; el = el.parentElement) chain.push(el);
  if (chain.length === 0) return null;
  const sizes = chain.map(nonLinkLength);
  const max = Math.max(...sizes);
  if (max < 100) return null;
  return chain[sizes.findIndex((n) => n >= max * 0.7)] ?? null;
}

export function findContentRoot(doc: Document): Element {
  for (const selector of SEMANTIC_ROOTS) {
    const el = doc.querySelector(selector);
    if (el && meaningfulLength(el.textContent) >= 50) return el;
  }
  for (const selector of CMS_ROOTS) {
    const el = doc.querySelector(selector);
    if (el && meaningfulLength(el.textContent) >= 50) return el;
  }
  return guessContentRoot(doc) ?? doc.body ?? doc.documentElement;
}

function containsBlock(el: Element): boolean {
  for (const child of Array.from(el.children)) {
    const tag = child.localName;
    if (BLOCK_TAGS.has(tag)) return true;
    if (!SKIP_TAGS.has(tag) && containsBlock(child)) return true;
  }
  return false;
}

interface RawBlock {
  container: Element;
  nodes: Node[];
  /** 連続したインライン要素がコンテナの中身すべてか */
  whole: boolean;
}

function collectBlocks(el: Element, out: RawBlock[], isExcluded: (el: Element) => boolean): void {
  // 文書の順序を保つため、インラインの流れは見つけた時点で out に入れる（whole は最後に決める）
  const mine: RawBlock[] = [];
  let run: Node[] = [];
  let hadBlockChild = false;
  const flush = () => {
    if (run.length) {
      const rb: RawBlock = { container: el, nodes: run, whole: false };
      mine.push(rb);
      out.push(rb);
    }
    run = [];
  };
  for (const child of Array.from(el.childNodes)) {
    if (child.nodeType === TEXT_NODE) {
      run.push(child);
      continue;
    }
    if (child.nodeType !== ELEMENT_NODE) continue;
    const c = child as Element;
    const tag = c.localName;
    if (isUi(c)) continue;
    if (SKIP_TAGS.has(tag)) {
      // 画像などはインラインの流れを切らない
      if (tag === "img" || tag === "picture") run.push(c);
      continue;
    }
    if (BLOCK_TAGS.has(tag) || containsBlock(c)) {
      hadBlockChild = true;
      flush();
      if (!isExcluded(c)) collectBlocks(c, out, isExcluded);
      continue;
    }
    if (isExcluded(c)) continue;
    run.push(c);
  }
  flush();
  if (!hadBlockChild && mine.length === 1) mine[0]!.whole = true;
}

/** テキスト収集の結果。node が null のものは <br>（改行1文字） */
export interface TextSeg {
  node: Text | null;
  start: number;
  end: number;
  /** node が null のとき（<br>）の、その要素 */
  br?: Element;
}

/** ノード列から、原文のテキストとテキストノードの位置を集める（UI 要素・読まない要素は除く） */
export function collectText(
  nodes: Iterable<Node>,
  isExcluded: (el: Element) => boolean = () => false,
): {
  segs: TextSeg[];
  /** 文分割用。HTML ソース中の改行は空白に置き換え、<br> だけを "\n" にしたもの */
  text: string;
  /** 原文そのまま（<br> は "\n"）。text と同じ長さ・同じ位置 */
  raw: string;
} {
  const segs: TextSeg[] = [];
  let text = "";
  let raw = "";
  const visit = (n: Node, pre: boolean) => {
    if (n.nodeType === TEXT_NODE) {
      const data = (n as Text).data;
      if (data.length) {
        segs.push({ node: n as Text, start: text.length, end: text.length + data.length });
        // HTML ソース中の改行は表示上ただの空白。文字数を変えずに空白へ置き換える（<pre> の中は改行のまま）
        text += pre ? data : data.replace(/[\n\r\t\f]/g, " ");
        raw += data;
      }
      return;
    }
    if (n.nodeType !== ELEMENT_NODE) return;
    const el = n as Element;
    const tag = el.localName;
    if (tag === "br") {
      segs.push({ node: null, start: text.length, end: text.length + 1, br: el });
      text += "\n";
      raw += "\n";
      return;
    }
    if (SKIP_TAGS.has(tag) || isUi(el) || isExcluded(el)) return;
    for (const c of Array.from(el.childNodes)) visit(c, pre || tag === "pre");
  };
  for (const n of nodes) {
    const parentPre = n.parentElement?.closest("pre") != null;
    visit(n, parentPre);
  }
  return { segs, text, raw };
}

export interface WrapRange {
  start: number;
  end: number;
  make: () => Element;
}

/**
 * テキスト上の範囲（複数・重なりなし）を、要素で包む。範囲が要素をまたぐ場合は、
 * テキストノードごとに分けて包む（同じ make() で作った要素が複数できる）。
 * 原文のテキストは変えない。
 */
export function wrapRanges(segs: TextSeg[], ranges: WrapRange[]): Element[] {
  const created: Element[] = [];
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  for (const seg of segs) {
    const node = seg.node;
    if (!node) continue;
    const pieces = sorted
      .filter((r) => r.start < seg.end && r.end > seg.start)
      .map((r) => ({
        a: Math.max(r.start, seg.start) - seg.start,
        b: Math.min(r.end, seg.end) - seg.start,
        make: r.make,
      }));
    // 後ろから切り出すと、元のノードが先頭部分として残り続ける
    const local: Element[] = [];
    for (let k = pieces.length - 1; k >= 0; k--) {
      const { a, b, make } = pieces[k]!;
      if (b < node.data.length) node.splitText(b);
      const piece = a > 0 ? node.splitText(a) : node;
      const wrapper = make();
      piece.parentNode!.insertBefore(wrapper, piece);
      wrapper.appendChild(piece);
      local.unshift(wrapper);
    }
    created.push(...local);
  }
  return created;
}

function blockKind(tag: string): BlockKind {
  if (HEADING.test(tag)) return "heading";
  if (tag === "li") return "list-item";
  if (tag === "td" || tag === "th") return "table-cell";
  if (tag === "dt" || tag === "dd") return "term";
  if (tag === "p") return "paragraph";
  return "other";
}

export function segmentDocument(doc: Document, options: SegmentOptions = {}): Segmentation {
  const root = options.root ?? findContentRoot(doc);
  const rootIsBody = root === doc.body || root === doc.documentElement;
  const isExcluded = (el: Element) =>
    el.matches(EXCLUDE_SELECTOR) || (rootIsBody && el.matches(PAGE_CHROME_SELECTOR));

  const rawBlocks: RawBlock[] = [];
  collectBlocks(root, rawBlocks, isExcluded);

  const blocks: SegBlock[] = [];
  const sentences: SentenceRef[] = [];

  for (const rb of rawBlocks) {
    const { segs, text, raw: original } = collectText(rb.nodes, isExcluded);
    const spans = splitSentences(softenLineBreaks(text));
    if (!spans.length) continue;

    const blockId = `b${blocks.length + 1}`;
    const tag = rb.container.localName;
    const kind = blockKind(tag);
    let host: Element;
    let placement: SegBlock["placement"];
    if (rb.whole) {
      host = rb.container;
      placement = HEADING.test(tag) ? "after" : "inside";
    } else {
      // コンテナの一部だけがインラインの流れのとき（例: <li>文<ul>…</ul></li>）は、その範囲を包む
      const run = doc.createElement("gk-run");
      run.setAttribute("style", "display: contents");
      rb.nodes[0]!.parentNode!.insertBefore(run, rb.nodes[0]!);
      for (const n of rb.nodes) run.appendChild(n);
      host = run;
      placement = "after";
    }
    host.setAttribute("data-gk-b", blockId);

    const ranges: WrapRange[] = [];
    const ids: string[] = [];
    for (const span of spans) {
      const id = `s${sentences.length + 1}`;
      ids.push(id);
      sentences.push({
        id,
        blockId,
        blockKind: kind,
        text: normalizeText(original.slice(span.start, span.end)),
      });
      ranges.push({
        start: span.start,
        end: span.end,
        make: () => {
          const el = doc.createElement(SENTENCE_TAG);
          el.setAttribute("data-s", id);
          return el;
        },
      });
    }
    wrapRanges(segs, ranges);
    blocks.push({ id: blockId, kind, host, placement, sentenceIds: ids });
  }

  return { root, blocks, sentences };
}

/** 文中の anchor（原文の一部）を探して要素で包む。見つからなければ空配列 */
export function wrapInSentence(
  doc: Document,
  sentenceId: string,
  anchor: string,
  make: () => Element,
): Element[] {
  const parts = Array.from(doc.querySelectorAll(`${SENTENCE_TAG}[data-s="${sentenceId}"]`));
  if (!parts.length || !anchor.trim()) return [];
  const { segs, text } = collectText(parts);
  const match = anchorPattern(anchor).exec(text);
  if (!match) return [];
  return wrapRanges(segs, [{ start: match.index, end: match.index + match[0].length, make }]);
}

/** 空白の違い（改行・インデント）を許して anchor を探す正規表現 */
export function anchorPattern(anchor: string): RegExp {
  // 文字のあいだの空白・改行・ゼロ幅の文字は無視する
  const gap = "[\\s\\u200b-\\u200d\\u2060\\ufeff]*";
  const chars = Array.from(anchor.replace(/[\s\u200b-\u200d\u2060\ufeff]+/gu, ""));
  return new RegExp(chars.map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(gap), "u");
}
