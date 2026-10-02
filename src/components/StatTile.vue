<script setup lang="ts">
defineProps<{ label: string; value: string | number; hint?: string }>();
</script>

<template>
  <div class="tile">
    <div class="label">{{ label }}</div>
    <div class="value mono">{{ value }}</div>
    <div v-if="hint" class="hint">{{ hint }}</div>
  </div>
</template>

<style scoped>
.tile { background: var(--surface-1); border: 1px solid var(--border-strong); box-shadow: var(--shadow-pixel-small); padding: 12px 14px; }
.label { font-size: 12px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.03em; }
.value { font-family: var(--font-display); letter-spacing: var(--display-tracking); font-size: 26px; font-weight: 700; margin-top: 2px; color: var(--text-primary); }
.hint { font-size: 12px; color: var(--text-secondary); margin-top: 2px; }
</style>
