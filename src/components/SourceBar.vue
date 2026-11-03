<script setup lang="ts">
import { ref, watch } from "vue";

const props = defineProps<{ busy: boolean; url: string }>();
const emit = defineEmits<{ openUrl: [url: string]; openText: [text: string] }>();

const mode = ref<"url" | "paste">("url");
const url = ref(props.url);
const text = ref("");
watch(
  () => props.url,
  (v) => (url.value = v),
);

const demoUrl = new URL("/demo/kamome-tennyu.html", location.origin).toString();

function submitUrl() {
  const v = url.value.trim();
  if (v) emit("openUrl", v);
}
function submitText() {
  const v = text.value.trim();
  if (v) emit("openText", v);
}
function openDemo() {
  url.value = demoUrl;
  mode.value = "url";
  emit("openUrl", demoUrl);
}
</script>

<template>
  <div class="source">
    <div class="source-tabs" role="tablist">
      <button type="button" role="tab" :aria-selected="mode === 'url'" @click="mode = 'url'">
        URL で読む
      </button>
      <button type="button" role="tab" :aria-selected="mode === 'paste'" @click="mode = 'paste'">
        文章を貼り付ける
      </button>
      <button type="button" class="demo" @click="openDemo">架空の区役所ページで試す</button>
    </div>
    <form v-if="mode === 'url'" class="source-form" @submit.prevent="submitUrl">
      <input
        v-model="url"
        type="url"
        inputmode="url"
        required
        placeholder="区役所・入管などのページの URL（https://www.city.〇〇.lg.jp/…）"
        aria-label="ページの URL"
      />
      <button type="submit" :disabled="busy">読む</button>
    </form>
    <form v-else class="source-form is-paste" @submit.prevent="submitText">
      <textarea
        v-model="text"
        rows="4"
        placeholder="ページの本文をここに貼り付けてください（個人情報は貼り付けないでください）"
        aria-label="本文"
      />
      <button type="submit" :disabled="busy">読む</button>
    </form>
  </div>
</template>
