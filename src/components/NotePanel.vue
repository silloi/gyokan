<script setup lang="ts">
import { computed } from "vue";
import {
  FORCE_LABEL,
  GROUNDING_LABEL,
  LEVEL_INFO,
  type Level,
  type Note,
} from "../../shared/types.ts";
import sourcesJson from "../../shared/glossary/sources.json";
import type { GlossarySource } from "../../shared/glossary-types.ts";

const SOURCES = new Map<string, GlossarySource>(
  (sourcesJson as GlossarySource[]).map((s) => [s.id, s]),
);

const props = defineProps<{
  note: Note | null;
  sentences: ReadonlyMap<string, string>;
  sourceUrl?: string;
  counts: Record<Level, number>;
}>();
const emit = defineEmits<{ close: []; showSentence: [sentenceId: string] }>();

const isGuess = computed(
  () => props.note && (props.note.level === 4 || props.note.grounding !== "page"),
);
const LEVELS: Level[] = [1, 2, 3, 4];
</script>

<template>
  <aside class="panel" :class="{ 'has-note': note }" aria-live="polite">
    <template v-if="note">
      <header class="panel-head">
        <span class="chip" :data-level="note.level">{{ LEVEL_INFO[note.level].name }}</span>
        <span
          v-if="note.level === 3 && note.force !== 'none'"
          class="badge"
          :data-kind="note.force"
          >{{ FORCE_LABEL[note.force] }}</span
        >
        <span v-if="isGuess" class="badge" data-kind="guess">推測</span>
        <button type="button" class="close" aria-label="閉じる" @click="emit('close')">×</button>
      </header>

      <p v-if="note.anchor" class="anchor">
        「{{ note.anchor }}」<span v-if="note.reading" class="reading">（{{ note.reading }}）</span>
      </p>
      <p class="text">{{ note.text }}</p>
      <p v-if="note.detail" class="detail">{{ note.detail }}</p>

      <section class="evidence">
        <h3>根拠：原文のどこから読み取ったか</h3>
        <p class="grounding" :data-kind="note.grounding">{{ GROUNDING_LABEL[note.grounding] }}</p>
        <ul v-if="note.evidence.length">
          <li v-for="(e, i) in note.evidence" :key="i">
            <blockquote>{{ e.quote }}</blockquote>
            <button type="button" class="link" @click="emit('showSentence', e.sentenceId)">
              ページで見る
            </button>
          </li>
        </ul>
        <p v-else class="muted">このページの中には、はっきりした根拠がありません。</p>
        <p class="target">
          補足をつけた文：
          <button type="button" class="link" @click="emit('showSentence', note.sentenceId)">
            {{ sentences.get(note.sentenceId) }}
          </button>
        </p>
      </section>

      <section v-if="note.refs?.length" class="refs">
        <h3>公的な用語集では</h3>
        <ul>
          <li v-for="(r, i) in note.refs" :key="i">
            <p v-if="r.text">{{ r.text }}</p>
            <p v-if="r.en" class="en" lang="en">{{ r.en }}</p>
            <p class="cite">
              <a
                :href="r.url ?? SOURCES.get(r.source)?.url"
                target="_blank"
                rel="noopener noreferrer"
                >{{ SOURCES.get(r.source)?.name ?? r.source }}</a
              >
              <span class="attribution">{{ SOURCES.get(r.source)?.attribution }}</span>
            </p>
          </li>
        </ul>
      </section>

      <details v-if="note.issues?.length" class="issues">
        <summary>自動チェックのメモ（{{ note.issues.length }}件）</summary>
        <ul>
          <li v-for="(issue, i) in note.issues" :key="i">{{ issue }}</li>
        </ul>
      </details>
    </template>

    <template v-else>
      <h2 class="panel-title">行間の読み方</h2>
      <p>
        上のつまみを右に動かすと、行間に補足が増えます。補足をクリックすると、ここに根拠（原文のどこから読み取ったか）が出ます。
      </p>
      <ul class="legend">
        <li v-for="lv in LEVELS" :key="lv">
          <span class="chip" :data-level="lv">{{ LEVEL_INFO[lv].name }}</span>
          <span>{{ LEVEL_INFO[lv].description }}</span>
          <span class="count">{{ counts[lv] }}件</span>
        </li>
      </ul>
      <p class="muted">
        <span class="badge" data-kind="guess">推測</span>
        がついた補足は、ページに書かれていないことを含みます。
      </p>
    </template>

    <footer class="caution">
      補足は
      AI（Claude）が作った参考情報で、公式の情報ではありません。手続きの前に、かならず窓口や公式のページで確かめてください。
      <a v-if="sourceUrl" :href="sourceUrl" target="_blank" rel="noopener noreferrer"
        >元のページを開く</a
      >
    </footer>
  </aside>
</template>
