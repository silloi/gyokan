<script setup lang="ts">
import { computed, onMounted, reactive, ref, shallowRef } from "vue";
import {
  LEVELS,
  type Level,
  type Note,
  type PageText,
  type SentenceRef,
  type SliderLevel,
} from "../shared/types.ts";
import LevelDial, { type LevelStatus } from "./components/LevelDial.vue";
import NotePanel from "./components/NotePanel.vue";
import PageView from "./components/PageView.vue";
import SourceBar from "./components/SourceBar.vue";
import { ApiRequestError, fetchNotes, fetchPage } from "./lib/api.ts";
import { textToHtml } from "./lib/paste.ts";

interface LoadedPage {
  html: string;
  baseUrl: string;
  title: string;
  /** URL で開いたときの元のページ（貼り付けのときは無し） */
  sourceUrl?: string;
  via: "browser-rendering" | "fetch" | "paste";
  warnings: string[];
}

const page = shallowRef<LoadedPage | null>(null);
const pageText = shallowRef<PageText | null>(null);
const notes = shallowRef<Note[]>([]);
const level = ref<SliderLevel>(0);
const selectedId = ref<string | null>(null);
const focus = ref<{ sentenceId: string; nonce: number } | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);
const currentUrl = ref("");
const status = reactive<Record<Level, LevelStatus>>({
  1: { state: "idle", count: 0 },
  2: { state: "idle", count: 0 },
  3: { state: "idle", count: 0 },
  4: { state: "idle", count: 0 },
});
let controller: AbortController | null = null;

const selectedNote = computed(() => notes.value.find((n) => n.id === selectedId.value) ?? null);
const sentenceMap = computed(
  () => new Map((pageText.value?.sentences ?? []).map((s) => [s.id, s.text])),
);
const counts = computed(
  () => Object.fromEntries(LEVELS.map((lv) => [lv, status[lv].count])) as Record<Level, number>,
);
const viaLabel = computed(() => {
  const via = page.value?.via;
  if (via === "browser-rendering") return "Browser Rendering で取得";
  if (via === "fetch") return "通常の取得（JavaScript なし）";
  if (via === "paste") return "貼り付けた文章";
  return "";
});

function reset() {
  controller?.abort();
  controller = new AbortController();
  page.value = null;
  pageText.value = null;
  notes.value = [];
  selectedId.value = null;
  error.value = null;
  for (const lv of LEVELS)
    Object.assign(status[lv], { state: "idle", count: 0, message: undefined, source: undefined });
}

function setQuery(url: string | null) {
  const q = new URL(location.href);
  if (url) q.searchParams.set("url", url);
  else q.searchParams.delete("url");
  history.replaceState(null, "", q);
}

async function openUrl(url: string) {
  reset();
  currentUrl.value = url;
  loading.value = true;
  setQuery(url);
  try {
    const res = await fetchPage(url, controller!.signal);
    page.value = {
      html: res.html,
      baseUrl: res.finalUrl,
      title: res.title,
      sourceUrl: res.finalUrl,
      via: res.fetchedVia,
      warnings: res.warnings,
    };
  } catch (e) {
    if ((e as Error).name === "AbortError") return;
    error.value = e instanceof ApiRequestError ? e.message : "ページを読めませんでした";
  } finally {
    loading.value = false;
  }
}

function openText(text: string) {
  reset();
  currentUrl.value = "";
  setQuery(null);
  page.value = {
    html: textToHtml(text),
    baseUrl: `${location.origin}/`,
    title: "貼り付けた文章",
    via: "paste",
    warnings: [],
  };
}

async function loadLevel(lv: Level, target: PageText, signal: AbortSignal) {
  status[lv].state = "loading";
  try {
    const res = await fetchNotes(target, lv, signal);
    if (signal.aborted) return;
    notes.value = [...notes.value, ...res.notes];
    Object.assign(status[lv], { state: "done", count: res.notes.length, source: res.source });
  } catch (e) {
    if (signal.aborted) return;
    Object.assign(status[lv], {
      state: "error",
      message: e instanceof ApiRequestError ? e.message : "補足を作れませんでした",
    });
  }
}

function onReady(payload: { title: string; sentences: SentenceRef[] }) {
  if (!page.value) return;
  const target: PageText = {
    title: page.value.title || payload.title,
    url: page.value.sourceUrl,
    sentences: payload.sentences,
  };
  pageText.value = target;
  if (!payload.sentences.length) {
    error.value = "本文が見つかりませんでした";
    return;
  }
  // つまみを動かしたときにすぐ見えるよう、全レベルを並列で取りに行く
  const signal = controller!.signal;
  for (const lv of LEVELS) void loadLevel(lv, target, signal);
}

function onNavigate(url: string) {
  const current = page.value?.sourceUrl ? new URL(page.value.sourceUrl) : null;
  const next = new URL(url);
  if (current && next.host === current.host && /^https?:$/.test(next.protocol))
    void openUrl(next.toString());
  else window.open(next.toString(), "_blank", "noopener,noreferrer");
}

function showSentence(sentenceId: string) {
  focus.value = { sentenceId, nonce: Date.now() };
}

const levelErrors = computed(() => {
  const msgs = new Set(
    LEVELS.filter((lv) => status[lv].state === "error").map((lv) => status[lv].message ?? ""),
  );
  return [...msgs].filter(Boolean);
});

onMounted(() => {
  const url = new URL(location.href).searchParams.get("url");
  if (url) void openUrl(url);
});
</script>

<template>
  <div class="app">
    <header class="app-head">
      <div class="brand">
        <span class="logo" aria-hidden="true">行間</span>
        <span class="brand-text">
          <strong>行間 <small>ぎょうかん</small></strong>
          <span>原文はそのままに、行と行のあいだに補足を</span>
        </span>
      </div>
      <SourceBar :busy="loading" :url="currentUrl" @open-url="openUrl" @open-text="openText" />
    </header>

    <div class="controls">
      <LevelDial v-model="level" :status="status" :disabled="!page" />
      <div class="meta">
        <p v-if="page" class="meta-line">
          <span class="meta-title">{{ page.title }}</span>
          <span class="meta-via">{{ viaLabel }}</span>
        </p>
        <p v-for="(w, i) in page?.warnings ?? []" :key="i" class="notice is-warn">{{ w }}</p>
        <p v-for="(m, i) in levelErrors" :key="`e${i}`" class="notice is-warn">{{ m }}</p>
        <p v-if="error" class="notice is-error">{{ error }}</p>
      </div>
    </div>

    <main class="workspace" :class="{ 'has-selection': selectedNote }">
      <section class="viewer">
        <PageView
          v-if="page"
          :html="page.html"
          :base-url="page.baseUrl"
          :notes="notes"
          :level="level"
          :selected-id="selectedId"
          :focus="focus"
          @ready="onReady"
          @select="selectedId = $event"
          @navigate="onNavigate"
        />
        <div v-else class="empty">
          <p v-if="loading" class="loading">ページを読み込んでいます…</p>
          <template v-else>
            <h1>区役所や入管のページを、行間つきで読む</h1>
            <p>
              ページの URL
              を入れるか、本文を貼り付けてください。原文は変えずに、つまみで補足の量を選べます。
            </p>
            <ol class="levels-intro">
              <li><b>ことば</b>：難しい語の言い換え</li>
              <li><b>言い回し</b>：「原則として」「ご遠慮ください」の本当の意味</li>
              <li><b>文脈</b>：この文が言いたいこと、義務の強さ</li>
              <li><b>書かれていない前提</b>：日本人なら分かる前提・次にやること（推測を含む）</li>
            </ol>
          </template>
        </div>
      </section>
      <NotePanel
        :note="selectedNote"
        :sentences="sentenceMap"
        :source-url="page?.sourceUrl"
        :counts="counts"
        @close="selectedId = null"
        @show-sentence="showSentence"
      />
    </main>
  </div>
</template>
