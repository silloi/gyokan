<script setup lang="ts">
/**
 * 原文のページを sandbox 付き iframe に表示し、文分割・補足の差し込み・つまみの反映を行う。
 * iframe の中ではスクリプトは動かない（sandbox に allow-scripts を付けない）。操作はすべて親側から行う。
 * 補足は「行の下」に入れるので、iframe の幅が変わったり、Web フォントが読み込まれたりしたら測り直す。
 */
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { segmentDocument } from "../../shared/segment.ts";
import type { Note, SentenceRef, SliderLevel } from "../../shared/types.ts";
import { DOC_MARK, prepareDocument } from "../lib/frame.ts";
import {
  addNotes,
  applyLevel,
  createRenderState,
  forgetWidths,
  highlightNote,
  layout,
  noteIdAt,
  showSentence,
  type RenderState,
} from "../lib/render.ts";

const props = defineProps<{
  html: string | null;
  baseUrl: string;
  notes: readonly Note[];
  level: SliderLevel;
  selectedId: string | null;
  focus: { sentenceId: string; nonce: number } | null;
}>();
const emit = defineEmits<{
  ready: [payload: { title: string; sentences: SentenceRef[] }];
  select: [noteId: string | null];
  navigate: [url: string];
}>();

const frame = ref<HTMLIFrameElement | null>(null);
let state: RenderState | null = null;
const processed = new WeakSet<Document>();
let lastWidth = 0;
let relayoutTimer: ReturnType<typeof setTimeout> | undefined;

function relayout() {
  if (!state) return;
  const started = performance.now();
  layout(state);
  highlightNote(state, props.selectedId);
  if (import.meta.env.DEV) {
    console.debug(
      `[gyokan] layout ${Math.round(performance.now() - started)}ms (${state.notes.size} notes)`,
    );
  }
}

// 幅が変わると行の切れ目が変わるので、少し待ってから測り直す
const resizeObserver = new ResizeObserver((entries) => {
  const width = Math.round(entries[0]?.contentRect.width ?? 0);
  if (!width || width === lastWidth) return;
  lastWidth = width;
  clearTimeout(relayoutTimer);
  relayoutTimer = setTimeout(relayout, 150);
});

function loadDocument() {
  state = null;
  if (frame.value && props.html != null) {
    frame.value.srcdoc = prepareDocument(props.html, props.baseUrl);
  }
}
// html を持った状態でマウントされるので、初回はマウント時に読み込む
onMounted(() => {
  loadDocument();
  if (frame.value) resizeObserver.observe(frame.value);
});
watch(() => [props.html, props.baseUrl], loadDocument);

function onClick(ev: MouseEvent) {
  const target = ev.target as Element | null;
  if (!target || typeof target.closest !== "function") return;
  const noteId = noteIdAt(target, props.level);
  if (noteId) {
    ev.preventDefault();
    emit("select", noteId);
    return;
  }
  const link = target.closest("a[href]") as HTMLAnchorElement | null;
  if (link) {
    ev.preventDefault();
    const raw = link.getAttribute("href") ?? "";
    if (raw.startsWith("#")) {
      const id = decodeURIComponent(raw.slice(1));
      if (id) link.ownerDocument.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
      return;
    }
    emit("navigate", link.href);
    return;
  }
  if (!target.closest("gk-line")) emit("select", null);
}

function onKeydown(ev: KeyboardEvent) {
  if (ev.key !== "Enter" && ev.key !== " ") return;
  const target = ev.target as Element | null;
  const noteId =
    target && typeof target.closest === "function" ? noteIdAt(target, props.level) : null;
  if (noteId) {
    ev.preventDefault();
    emit("select", noteId);
  }
}

function onLoad() {
  const doc = frame.value?.contentDocument;
  // 最初の about:blank や、同じ文書の二重処理は無視する
  if (!doc || processed.has(doc) || !doc.documentElement?.hasAttribute(DOC_MARK)) return;
  processed.add(doc);
  const seg = segmentDocument(doc);
  state = createRenderState(doc, seg);
  doc.addEventListener("click", onClick, true);
  doc.addEventListener("keydown", onKeydown, true);
  applyLevel(doc, props.level);
  addNotes(state, props.notes);
  relayout();
  // Web フォントで字の幅が変わると折り返しも補足の幅も変わるので、読み込み後に測り直す
  doc.fonts?.ready
    .then(() => {
      if (state?.doc !== doc) return;
      forgetWidths(state);
      relayout();
    })
    .catch(() => undefined);
  emit("ready", { title: doc.title, sentences: seg.sentences });
}

// レベルごとの補足は続けて届くので、少し待ってまとめて測り直す（遅い端末で1回 100〜200ms かかるため）
watch(
  () => props.notes,
  (notes) => {
    if (state && addNotes(state, notes)) {
      clearTimeout(relayoutTimer);
      relayoutTimer = setTimeout(relayout, 60);
    }
  },
);
watch(
  () => props.level,
  (level) => state && applyLevel(state.doc, level),
);
watch(
  () => props.selectedId,
  (id) => state && highlightNote(state, id),
);
watch(
  () => props.focus,
  (f) => {
    if (state && f) showSentence(state.doc, f.sentenceId);
  },
);

onBeforeUnmount(() => {
  resizeObserver.disconnect();
  clearTimeout(relayoutTimer);
  state = null;
});
</script>

<template>
  <iframe
    ref="frame"
    class="page-frame"
    sandbox="allow-same-origin"
    title="原文のページ（行間つき）"
    @load="onLoad"
  />
</template>
