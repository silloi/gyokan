/**
 * 補足を iframe の中の文書に差し込む。原文のテキストは変えない（包む・あいだに足すだけ）。
 *
 * 補足は「各行の下」に入れる:
 * 1. 文字ごとの位置を測って、画面上の行の切れ目を求める（DOM は変えない）
 * 2. 補足がある行の終わり（次の行の最初の文字の直前）に、補足の行 <gk-line> を差し込む
 *    - <gk-line> は幅 100% のインラインブロック。そこはもともと行の終わりなので、折り返しは変わらない
 *      （ブロックにすると直前の行が「段落の最終行」扱いになり、両端揃えの字間が変わるため、インラインブロックにしている）
 *    - `contain: inline-size` により、補足の文字が親の幅（表の列幅など）に影響しない
 *    - 表示する補足が無い行は display: none（つまみ 0 では原文と同じ見た目）
 * 3. 単語への補足は、その単語の真下から始まるように左の余白を付ける
 * 画面の幅が変わると行の切れ目が変わるので、そのたびに測り直す（layout()）。
 */
import {
  SENTENCE_TAG,
  UI_ATTR,
  collectText,
  wrapInSentence,
  type SegBlock,
  type Segmentation,
  type TextSeg,
} from "../../shared/segment.ts";
import { FORCE_LABEL, LEVEL_INFO, type Note, type SliderLevel } from "../../shared/types.ts";

/** 補足の文字の大きさ（px）。frame.css の gk-line と合わせる */
const NOTE_FONT_PX = 12;
/** 語より左へずらしたとき、語の真下に印を付ける（ずれがこれより大きいとき） */
const PIN_THRESHOLD_PX = 6;

/** 補足に付けるバッジ（レベルは色で、どの語かは位置で分かるので、ラベルや語は書かない） */
function badgesOf(note: Note): { text: string; kind: string; before: boolean }[] {
  const badges: { text: string; kind: string; before: boolean }[] = [];
  if (note.level === 3 && note.force !== "none") {
    badges.push({ text: FORCE_LABEL[note.force], kind: note.force, before: true });
  }
  // レベル4は推測を含むので必ず「推測」を付ける。ほかのレベルも、ページに根拠が無いものは区別する
  if (note.level === 4 || note.grounding === "guess")
    badges.push({ text: "推測", kind: "guess", before: false });
  // ページの外の知識かどうかは、手続きの中身にかかわる文脈・前提でだけ示す（語や言い回しの意味の説明には付けない）。
  // 根拠パネルでは、どのレベルでも表示する
  if (note.grounding === "general" && note.level >= 3)
    badges.push({ text: "ページの外の知識", kind: "general", before: false });
  return badges;
}

/** 補足を1行で表示したときの幅の見積もり（和文はほぼ1文字＝1em。バッジや余白の分を足す） */
function estimateWidth(note: Note): number {
  const em = (text: string) =>
    Array.from(text).reduce((w, c) => w + (/[\x20-\x7e]/.test(c) ? 0.55 : 1), 0);
  // バッジは 10px の文字＋余白
  const badges = badgesOf(note).reduce((w, b) => w + b.text.length * (10 / NOTE_FONT_PX) + 1.2, 0);
  // 約物などで少し広がるので、1文字分の余裕を足す
  return NOTE_FONT_PX * (em(note.text) + badges + 1) + 12;
}

export interface RenderState {
  doc: Document;
  seg: Segmentation;
  notes: Map<string, Note>;
  /** 補足の要素（測り直しのたびに作り直さず、付け替える） */
  noteEls: Map<string, Element>;
  blockNotes: Map<string, Note[]>;
  blockOf: Map<string, SegBlock>;
  sentenceIndex: Map<string, number>;
}

export function createRenderState(doc: Document, seg: Segmentation): RenderState {
  const blocks = new Map(seg.blocks.map((b) => [b.id, b]));
  return {
    doc,
    seg,
    notes: new Map(),
    noteEls: new Map(),
    blockNotes: new Map(),
    blockOf: new Map(seg.sentences.map((s) => [s.id, blocks.get(s.blockId)!])),
    sentenceIndex: new Map(seg.sentences.map((s, i) => [s.id, i])),
  };
}

function el(
  doc: Document,
  tag: string,
  text?: string,
  attrs: Record<string, string> = {},
): Element {
  const e = doc.createElement(tag);
  if (text !== undefined) e.textContent = text;
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}

function noteElement(doc: Document, note: Note): Element {
  // 画面には補足の本文だけを出す（レベルは色、どの語への補足かは位置で分かる）。
  // レベルの名前と語は、読み上げ用のラベルとツールチップ、クリックしたときの根拠パネルに出す
  const label = `${LEVEL_INFO[note.level].name}${note.anchor ? `「${note.anchor}」` : ""}`;
  const root = el(doc, "gk-note", undefined, {
    [UI_ATTR]: "",
    "data-n": note.id,
    "data-level": String(note.level),
    "data-s": note.sentenceId,
    role: "button",
    tabindex: "0",
    title: label,
    "aria-label": `${label}の補足: ${note.text}`,
  });
  const inner = el(doc, "gk-in");
  const box = el(doc, "gk-box");
  const badges = badgesOf(note);
  for (const b of badges.filter((b) => b.before))
    box.append(el(doc, "gk-badge", b.text, { "data-kind": b.kind }));
  box.append(el(doc, "gk-t", note.text));
  for (const b of badges.filter((b) => !b.before))
    box.append(el(doc, "gk-badge", b.text, { "data-kind": b.kind }));
  inner.append(box);
  root.append(inner);
  return root;
}

/** 新しい補足を登録する（単語の印を付け、補足の要素を作る）。新しいものがあれば true */
export function addNotes(state: RenderState, notes: readonly Note[]): boolean {
  const { doc } = state;
  let added = false;
  for (const note of notes) {
    if (state.notes.has(note.id)) continue;
    const block = state.blockOf.get(note.sentenceId);
    if (!block) continue;
    state.notes.set(note.id, note);
    state.noteEls.set(note.id, noteElement(doc, note));
    const list = state.blockNotes.get(block.id) ?? [];
    list.push(note);
    state.blockNotes.set(block.id, list);
    if (note.anchor) {
      wrapInSentence(doc, note.sentenceId, note.anchor, () =>
        el(doc, "gk-a", undefined, { "data-n": note.id, "data-level": String(note.level) }),
      );
    }
    added = true;
  }
  return added;
}

interface VisualLine {
  /** ブロックのテキスト上の位置（この行の、測った最初の文字） */
  start: number;
  /** この行で、測った最後の文字の位置 */
  last: number;
  /** 行の最初の文字のテキストノードと、その中の位置。前の行の補足は、ふつうはここに差し込む */
  node: Text;
  index: number;
  /**
   * 前の行が <br> で終わっているときの、その <br>。前の行の補足は <br> の直前に差し込む。
   * （<br> の後ろに入れると、行頭の字下げの全角空白が補足の行の末尾にぶら下がって消え、次の行がずれる）
   */
  brBefore?: Element;
  bottom: number;
}

interface Measured {
  block: SegBlock;
  lines: VisualLine[];
  segOf: Map<Text, TextSeg>;
  leftOf: Map<number, number>;
}

const SPACE = /\s/u;

/** ブロックの文字の位置を測って、画面上の行に分ける（DOM は変えない） */
function measure(doc: Document, block: SegBlock): Measured {
  const segs = collectText(Array.from(block.host.childNodes)).segs;
  const range = doc.createRange();
  const rectOf = (node: Text, i: number) => {
    range.setStart(node, i);
    range.setEnd(node, i + 1);
    const r = range.getClientRects()[0];
    return r && (r.width > 0 || r.height > 0) ? r : null;
  };
  /** ブロックのテキストの1文字ずつ（<br> は node が null） */
  const chars: { node: Text | null; index: number; br?: Element }[] = [];
  const lines: VisualLine[] = [];
  const segOf = new Map<Text, TextSeg>();
  const leftOf = new Map<number, number>();
  let current: VisualLine | null = null;
  for (const seg of segs) {
    if (!seg.node) {
      chars.push({ node: null, index: 0, br: seg.br });
      continue;
    }
    const node = seg.node;
    segOf.set(node, seg);
    // 行の判定に使うのは文（gk-s）の中の文字だけ。スクリーンリーダー用の見えない文字などで狂わないように
    const inSentence = node.parentElement?.closest(SENTENCE_TAG) != null;
    for (let i = 0; i < node.data.length; i++) {
      const off = chars.length;
      chars.push({ node, index: i });
      if (!inSentence || SPACE.test(node.data[i]!)) continue;
      const r = rectOf(node, i);
      if (!r) continue;
      const mid = (r.top + r.bottom) / 2;
      if (!current || mid > current.bottom) {
        current = { start: off, last: off, node, index: i, bottom: r.bottom };
        lines.push(current);
      } else {
        current.bottom = Math.max(current.bottom, r.bottom);
        current.last = off;
      }
      leftOf.set(off, r.left);
    }
  }
  // 前の行が <br> で終わっているなら、補足はその <br> の直前に入れる（行頭の字下げを動かさないため）
  for (let k = 1; k < lines.length; k++) {
    const line = lines[k]!;
    for (let j = lines[k - 1]!.last + 1; j < line.start; j++) {
      const br = chars[j]?.br;
      if (br) {
        line.brBefore = br;
        break;
      }
    }
  }
  return { block, lines, segOf, leftOf };
}

function lineIndexAt(lines: VisualLine[], offset: number): number {
  let idx = 0;
  for (let k = 0; k < lines.length; k++) {
    if (lines[k]!.start <= offset) idx = k;
    else break;
  }
  return idx;
}

function firstText(root: Node): Text | null {
  if (root.nodeType === 3) return root as Text;
  for (const c of Array.from(root.childNodes)) {
    if (c.nodeType === 1 && (c as Element).hasAttribute(UI_ATTR)) continue;
    const t = firstText(c);
    if (t) return t;
  }
  return null;
}

function lastText(root: Node): Text | null {
  if (root.nodeType === 3) return root as Text;
  const children = Array.from(root.childNodes);
  for (let k = children.length - 1; k >= 0; k--) {
    const c = children[k]!;
    if (c.nodeType === 1 && (c as Element).hasAttribute(UI_ATTR)) continue;
    const t = lastText(c);
    if (t) return t;
  }
  return null;
}

/** 補足をどの行の下に置くか（単語への補足はその単語の行、文への補足は文の最後の行）と、左の位置 */
function placeNote(
  state: RenderState,
  m: Measured,
  note: Note,
): { line: number; left: number | null } | null {
  const { doc } = state;
  if (note.anchor) {
    const piece = doc.querySelector(`gk-a[data-n="${note.id}"]`);
    const t = piece ? firstText(piece) : null;
    const seg = t ? m.segOf.get(t) : undefined;
    if (t && seg) {
      let off = seg.start;
      while (off < seg.end && !m.leftOf.has(off)) off++;
      if (m.leftOf.has(off)) return { line: lineIndexAt(m.lines, off), left: m.leftOf.get(off)! };
    }
  }
  const parts = doc.querySelectorAll(`${SENTENCE_TAG}[data-s="${note.sentenceId}"]`);
  const t = parts.length ? lastText(parts[parts.length - 1]!) : null;
  const seg = t ? m.segOf.get(t) : undefined;
  if (!t || !seg) return null;
  let off = seg.end - 1;
  while (off > seg.start && !m.leftOf.has(off)) off--;
  return { line: lineIndexAt(m.lines, off), left: null };
}

/** 補足の行を差し込む位置を、インラインの要素の外へ出せるときは出す（リンクの中などに入れないため） */
function hoist(ref: Node, host: Element): { parent: Node; before: Node | null } {
  let node: Node = ref;
  while (node.parentNode && node.parentNode !== host) {
    const parent = node.parentNode;
    const prev = node.previousSibling;
    const atStart =
      prev === null ||
      (prev.nodeType === 3 && !(prev as Text).data.trim() && prev.previousSibling === null);
    if (!atStart) break;
    node = parent;
  }
  return { parent: node.parentNode!, before: node };
}

/** CSS の配置が flex / grid の要素の中では、行の途中にブロックを入れると並びが崩れるので、ブロックの後ろに置く */
function flowContainer(block: SegBlock): Element {
  return block.host.localName === "gk-run" ? block.host.parentElement! : block.host;
}

/** 要素の内容の左端と幅（枠線と内側の余白を除いたもの）。補足の行はここから始まる */
function contentBox(doc: Document, container: Element): { left: number; width: number } {
  const r = container.getBoundingClientRect();
  const cs = doc.defaultView?.getComputedStyle(container);
  const px = (v: string | undefined) => Number.parseFloat(v ?? "0") || 0;
  const left = r.left + px(cs?.borderLeftWidth) + px(cs?.paddingLeft);
  const right = r.right - px(cs?.borderRightWidth) - px(cs?.paddingRight);
  return { left, width: Math.max(0, right - left) };
}

function isFlowLayout(doc: Document, container: Element): boolean {
  const display = doc.defaultView?.getComputedStyle(container).display ?? "block";
  return !/flex|grid/.test(display);
}

/** 補足の行を作り直す。幅が変わったとき・補足が増えたときに呼ぶ */
export function layout(state: RenderState): void {
  const { doc } = state;
  doc.querySelectorAll("gk-line").forEach((e) => e.remove());

  // 1. まとめて測る（DOM を変える前に全部測ると、行の切れ目がずれない）
  const blocks = new Map(state.seg.blocks.map((b) => [b.id, b]));
  const plans: {
    m: Measured;
    byLine: Map<number, { note: Note; left: number | null }[]>;
    container: Element;
    inFlow: boolean;
    /** 行の左端（親要素の内容の左端）と、行の幅 */
    base: { left: number; width: number };
  }[] = [];
  for (const [blockId, notes] of state.blockNotes) {
    const block = blocks.get(blockId);
    if (!block) continue;
    const m = measure(doc, block);
    if (m.lines.length === 0) continue; // 画面に出ていないブロック
    const byLine = new Map<number, { note: Note; left: number | null }[]>();
    for (const note of notes) {
      const p = placeNote(state, m, note);
      if (!p) continue;
      const list = byLine.get(p.line) ?? [];
      list.push({ note, left: p.left });
      byLine.set(p.line, list);
    }
    const container = flowContainer(block);
    plans.push({
      m,
      byLine,
      container,
      inFlow: isFlowLayout(doc, container),
      base: contentBox(doc, container),
    });
  }

  // 2. 差し込む（同じブロックの中は後ろの行から。前の行の位置がずれないように）
  for (const { m, byLine, container, inFlow, base } of plans) {
    const lineNos = [...byLine.keys()].sort((a, b) => b - a);
    for (const lineNo of lineNos) {
      const items = byLine.get(lineNo)!;
      // 単語への補足は左から順に、文への補足はそのあとにレベル順で
      items.sort(
        (a, b) => (a.left ?? Infinity) - (b.left ?? Infinity) || a.note.level - b.note.level,
      );
      const levels = [...new Set(items.map((i) => i.note.level))].sort((a, b) => a - b).join(" ");
      const line = el(doc, "gk-line", undefined, {
        [UI_ATTR]: "",
        "data-line": `${m.block.id}-${lineNo + 1}`,
        // この行にある補足のレベル。表示中のレベルのものが無ければ、行ごと消す（CSS）
        "data-levels": levels,
      });
      const inner = el(doc, "gk-line-in");
      line.append(inner);
      for (const { note, left } of items) {
        const node = state.noteEls.get(note.id)!;
        inner.append(node);
        // 単語への補足は、その単語の真下から始める。ただし1行に収まらなくなるなら、収まるところまで左へ戻す
        const box = node.querySelector("gk-box") as HTMLElement;
        box.querySelector("gk-pin")?.remove();
        const want = left !== null && inFlow ? left - base.left : 0;
        const indent = Math.max(0, Math.min(want, base.width - estimateWidth(note)));
        box.style.setProperty("margin-left", `${Math.round(indent)}px`);
        // 左へずらしたときは、どの語への補足かが位置で分かるよう、語の真下に小さな印（▲）を付ける
        if (want - indent > PIN_THRESHOLD_PX) {
          const pin = el(doc, "gk-pin", undefined, { "aria-hidden": "true" }) as HTMLElement;
          pin.style.setProperty("left", `${Math.round(want - indent)}px`);
          box.prepend(pin);
        }
      }
      if (!inFlow) {
        container.after(line);
        continue;
      }
      const next = m.lines[lineNo + 1];
      if (next?.brBefore) {
        next.brBefore.parentNode!.insertBefore(line, next.brBefore);
      } else if (next) {
        const ref = next.index > 0 ? next.node.splitText(next.index) : next.node;
        const { parent, before } = hoist(ref, m.block.host);
        parent.insertBefore(line, before);
      } else {
        m.block.host.append(line);
      }
    }
  }
}

export function applyLevel(doc: Document, level: SliderLevel): void {
  const html = doc.documentElement;
  for (let i = 1; i <= 4; i++) html.classList.toggle(`gk-l${i}`, i <= level);
  html.setAttribute("data-gk-level", String(level));
}

function clearHighlight(doc: Document): void {
  doc.querySelectorAll("[data-gk-hl]").forEach((e) => e.removeAttribute("data-gk-hl"));
  doc.querySelectorAll("gk-note[data-selected]").forEach((e) => e.removeAttribute("data-selected"));
}

/** 選んだ補足と、その補足がついている原文の部分を目立たせる */
export function highlightNote(state: RenderState, noteId: string | null): void {
  const { doc } = state;
  clearHighlight(doc);
  if (!noteId) return;
  const note = state.notes.get(noteId);
  if (!note) return;
  state.noteEls.get(noteId)?.setAttribute("data-selected", "");
  const anchors = doc.querySelectorAll(`gk-a[data-n="${noteId}"]`);
  const targets = anchors.length
    ? anchors
    : doc.querySelectorAll(`${SENTENCE_TAG}[data-s="${note.sentenceId}"]`);
  targets.forEach((t) => t.setAttribute("data-gk-hl", ""));
}

/** 根拠の文までスクロールして、少しのあいだ目立たせる */
export function showSentence(doc: Document, sentenceId: string): void {
  const parts = doc.querySelectorAll(`${SENTENCE_TAG}[data-s="${sentenceId}"]`);
  if (!parts.length) return;
  parts[0]!.scrollIntoView({ block: "center", behavior: "smooth" });
  parts.forEach((p) => p.setAttribute("data-gk-hl", ""));
  setTimeout(() => parts.forEach((p) => p.removeAttribute("data-gk-hl")), 2400);
}

/** クリックされた要素から、補足の ID を探す（表示中のレベルのものだけ） */
export function noteIdAt(target: Element, level: SliderLevel): string | null {
  const hit = target.closest("gk-note[data-n], gk-a[data-n]");
  if (!hit) return null;
  return Number(hit.getAttribute("data-level")) <= level ? hit.getAttribute("data-n") : null;
}
