<script setup lang="ts">
import { computed, ref } from "vue";
import { state } from "../state";
import ResultBadge from "./ResultBadge.vue";

const open = ref(true);
const KIND: Record<string, string> = { solo: "Combats solo", farmer: "Combats éleveur", challenge: "Défis", test: "Tests d'IA", sync: "Synchronisation" };
// Tâches en cours + celles terminées depuis moins de 2 minutes.
const visible = computed(() => state.jobs.filter((j) => j.status === "running" || Date.now() - j.startedAt < 120_000).slice(0, 4));
</script>

<template>
  <aside v-if="visible.length" class="jobs">
    <button class="ghost head" @click="open = !open">
      Tâches ({{ visible.filter((j) => j.status === "running").length }} en cours) {{ open ? "▾" : "▸" }}
    </button>
    <template v-if="open">
      <div v-for="j in visible" :key="j.id" class="job">
        <div class="row">
          <strong>{{ KIND[j.kind] ?? j.kind }}</strong>
          <span class="spacer"></span>
          <span class="small" :class="j.status === 'error' ? 'err' : 'muted'">
            {{ j.status === "running" ? "en cours" : j.status === "done" ? "terminé" : "erreur" }}
          </span>
        </div>
        <div v-if="j.progress.total" class="bar"><div :style="{ width: (100 * j.progress.done) / j.progress.total + '%' }"></div></div>
        <div class="small muted">{{ j.progress.done }}/{{ j.progress.total }} · {{ j.error ?? j.lastLog }}</div>
        <div v-if="j.fights.length" class="fl">
          <a v-for="f in j.fights.slice(0, 12)" :key="f.id" :href="'#/fight/' + f.id" :title="f.opponent?.name ?? ''">
            <ResultBadge :result="f.result" short />
          </a>
        </div>
      </div>
    </template>
  </aside>
</template>

<style scoped>
.jobs { position: fixed; right: 16px; bottom: 16px; width: 320px; max-width: calc(100vw - 32px); z-index: 20; background: var(--surface-1); border: 1px solid var(--border); box-shadow: var(--shadow-pixel); border-color: var(--border-strong); padding: 8px 12px 12px; }
.head { width: 100%; text-align: left; padding: 4px 0; font-weight: 600; }
.job { border-top: 1px solid var(--border); padding-top: 8px; margin-top: 8px; display: flex; flex-direction: column; gap: 4px; }
.bar { height: 4px; background: var(--surface-3); overflow: hidden; }
.bar div { height: 100%; background: var(--accent); transition: width 0.3s; }
.fl { display: flex; gap: 4px; flex-wrap: wrap; }
.fl a:hover { text-decoration: none; }
.err { color: var(--critical); }
</style>
