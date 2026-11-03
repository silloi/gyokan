<script setup lang="ts">
import { computed } from "vue";
import { LEVEL_INFO, type Level, type SliderLevel } from "../../shared/types.ts";

export interface LevelStatus {
  state: "idle" | "loading" | "done" | "error";
  count: number;
  message?: string;
  source?: "fixture" | "imported" | "cache" | "claude";
}

const props = defineProps<{
  modelValue: SliderLevel;
  status: Record<Level, LevelStatus>;
  disabled?: boolean;
}>();
const emit = defineEmits<{ "update:modelValue": [value: SliderLevel] }>();

const STOPS: readonly SliderLevel[] = [0, 1, 2, 3, 4];
const SHORT: Record<SliderLevel, string> = {
  0: "原文のみ",
  1: "ことば",
  2: "言い回し",
  3: "文脈",
  4: "前提",
};
const current = computed(() => LEVEL_INFO[props.modelValue]);

function set(value: number) {
  emit("update:modelValue", Math.max(0, Math.min(4, value)) as SliderLevel);
}

function statusText(level: SliderLevel): string {
  if (level === 0) return "";
  const s = props.status[level as Level];
  if (s.state === "loading") return "作成中…";
  if (s.state === "error") return "作れません";
  if (s.state === "done") return `${s.count}件`;
  return "";
}
</script>

<template>
  <div class="dial" :class="{ 'is-disabled': disabled }">
    <div class="dial-head">
      <span class="dial-caption">行間のつまみ</span>
      <strong class="dial-name">{{ modelValue }}：{{ current.name }}</strong>
      <span class="dial-desc">{{ current.description }}</span>
    </div>
    <input
      class="dial-range"
      type="range"
      min="0"
      max="4"
      step="1"
      :value="modelValue"
      :disabled="disabled"
      :style="{ '--pos': `${modelValue * 25}%` }"
      aria-label="補足の量（0〜4）"
      :aria-valuetext="`レベル${modelValue} ${current.name}`"
      @input="set(Number(($event.target as HTMLInputElement).value))"
    />
    <ol class="dial-stops">
      <li
        v-for="s in STOPS"
        :key="s"
        class="stop"
        :class="[
          `stop-${s}`,
          { 'is-on': s > 0 && s <= modelValue, 'is-current': s === modelValue },
        ]"
      >
        <button type="button" :disabled="disabled" @click="set(s)">
          <span class="stop-name">{{ SHORT[s] }}</span>
          <span
            v-if="s > 0"
            class="stop-status"
            :data-state="status[s as Level].state"
            :title="status[s as Level].message"
            >{{ statusText(s) }}</span
          >
        </button>
      </li>
    </ol>
  </div>
</template>
