<script setup lang="ts">
import { computed } from "vue";
import { CONTEXTS, RESULTS, TYPES, type FightSummary } from "../api";
import { lwImage } from "../lw";

// Rangée façon historique Leek Wars : mon camp | icône du contexte | camp adverse,
// le résultat porté par un liseré et une teinte plutôt que par un badge.
const props = defineProps<{ fight: FightSummary }>();

const names = computed<[string, string]>(() => {
  const f = props.fight;
  if (f.type === 3) return ["Battle", "Royale"];
  // Anciennes analyses sans sideNames : poireaux de chaque camp.
  const raw = f.sideNames ?? [f.leeks1.map((l) => l.name).join(", "), f.leeks2.map((l) => l.name).join(", ")];
  const [a, b] = raw.map((n) => n || "?") as [string, string];
  return f.mySide === 2 ? [b, a] : [a, b];
});

const icon = computed(() => {
  const f = props.fight;
  // Arènes : battle royale, guerre, chasse au trésor, colosse.
  if (f.type === 3 || f.type >= 5) return "icon/black/sword-cross.png";
  if (f.context === 1) return "icon/black/flag-outline.png";
  if (f.context === 3) return "icon/black/trophy.png";
  if (f.type === 4) return "icon/black/star.png";
  return "icon/black/garden.png";
});

const title = computed(() => {
  const f = props.fight;
  return `${CONTEXTS[f.context] ?? f.context} · ${TYPES[f.type] ?? f.type} · ${RESULTS[f.result] ?? f.result}`;
});
</script>

<template>
  <div class="matchup" :class="fight.result" :title="title">
    <span class="side left">{{ names[0] }}</span>
    <span class="center"><img :src="lwImage(icon)" alt="" /></span>
    <span class="side right">{{ names[1] }}</span>
  </div>
</template>

<style scoped>
.matchup {
  --result: var(--neutral);
  display: flex;
  align-items: stretch;
  height: 34px;
  width: 320px;
  flex-shrink: 0;
  border: 1px solid var(--border);
  box-shadow: inset 4px 0 0 var(--result);
  background: var(--surface-2);
  white-space: nowrap;
}
.matchup.win { --result: var(--good); background: color-mix(in srgb, var(--good) 14%, var(--surface-2)); }
.matchup.loss { --result: var(--critical); background: color-mix(in srgb, var(--critical) 14%, var(--surface-2)); }
.matchup.draw { --result: var(--neutral); background: color-mix(in srgb, var(--neutral) 12%, var(--surface-2)); }
.matchup.pending { --result: var(--warning); }
.side { flex: 1 1 0; min-width: 0; overflow: hidden; text-overflow: ellipsis; align-self: center; padding: 0 8px; }
.left { text-align: right; padding-left: 12px; }
.right { text-align: left; }
.center {
  flex: 0 0 34px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-left: 1px solid var(--border);
  border-right: 1px solid var(--border);
}
.center img { width: 18px; height: 18px; opacity: 0.7; }
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) .center img { filter: invert(1); }
}
:root[data-theme="dark"] .center img { filter: invert(1); }
</style>
