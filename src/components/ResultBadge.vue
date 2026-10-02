<script setup lang="ts">
import { RESULTS } from "../api";

defineProps<{ result: string; short?: boolean }>();
const ICONS: Record<string, string> = { win: "✓", loss: "✕", draw: "=", pending: "…" };
</script>

<template>
  <span class="badge" :class="result">
    <span aria-hidden="true">{{ ICONS[result] ?? "?" }}</span>
    <span v-if="!short">{{ RESULTS[result] ?? result }}</span>
    <span v-else class="sr">{{ RESULTS[result] ?? result }}</span>
  </span>
</template>

<style scoped>
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
</style>
