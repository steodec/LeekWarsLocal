<script setup lang="ts">
// Icône Leek Wars d'une puce, d'une arme ou d'une caractéristique (masquée si l'image n'existe pas).
import { computed, ref } from "vue";
import { characIcon, itemIcon } from "../lw";
import { itemLabel } from "../format";

const props = defineProps<{ kind: "chip" | "weapon" | "charac" | string; name: string; size?: number; label?: boolean }>();
const missing = ref(false);
const src = computed(() => (props.kind === "charac" ? characIcon(props.name) : itemIcon(props.kind, props.name)));
const title = computed(() => itemLabel(props.name));
</script>

<template>
  <span class="item-icon" :class="kind" :title="title">
    <img v-if="!missing" :src="src" :alt="label ? '' : title" :style="{ height: `${size ?? 24}px` }" loading="lazy" @error="missing = true" />
    <span v-if="label || missing">{{ title }}</span>
  </span>
</template>

<style scoped>
.item-icon { display: inline-flex; align-items: center; gap: 6px; vertical-align: middle; white-space: nowrap; }
.item-icon img { width: auto; image-rendering: auto; flex: none; }
.item-icon.weapon img { max-width: 64px; object-fit: contain; }
</style>
