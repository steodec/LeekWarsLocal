<script setup lang="ts">
// Barres horizontales empilées victoires / égalités / défaites par catégorie.
// Les couleurs de statut sont toujours accompagnées du taux et des effectifs en texte.
import { computed, ref } from "vue";
import { fmtPct } from "../format";

interface Row { bucket: string; fights: number; wins: number; losses: number; draws: number; winrate: number }
const props = defineProps<{ rows: Row[]; labelWidth?: number }>();
const hover = ref<{ row: Row; x: number; y: number } | null>(null);
const max = computed(() => Math.max(1, ...props.rows.map((r) => r.fights)));

function onMove(e: MouseEvent, row: Row) {
  const box = (e.currentTarget as HTMLElement).closest(".bars")!.getBoundingClientRect();
  hover.value = { row, x: e.clientX - box.left, y: e.clientY - box.top };
}
</script>

<template>
  <div class="bars" @mouseleave="hover = null">
    <div v-if="!rows.length" class="empty">Pas encore de données</div>
    <div v-for="r in rows" :key="r.bucket" class="line" @mousemove="onMove($event, r)">
      <div class="lbl" :style="{ width: (labelWidth ?? 110) + 'px' }">{{ r.bucket }}</div>
      <div class="track">
        <div class="stack" :style="{ width: (100 * r.fights) / max + '%' }">
          <div v-if="r.wins" class="seg win" :style="{ flex: r.wins }"></div>
          <div v-if="r.draws" class="seg draw" :style="{ flex: r.draws }"></div>
          <div v-if="r.losses" class="seg loss" :style="{ flex: r.losses }"></div>
        </div>
      </div>
      <div class="val mono">{{ fmtPct(r.winrate) }} <span class="muted">· {{ r.fights }}</span></div>
    </div>
    <div v-if="rows.length" class="legend small muted">
      <span><i class="sw win"></i>Victoires</span><span><i class="sw draw"></i>Égalités</span><span><i class="sw loss"></i>Défaites</span>
      <span>· barre = nombre de combats, texte = taux de victoire</span>
    </div>
    <div v-if="hover" class="tip" :style="{ left: hover.x + 12 + 'px', top: hover.y + 12 + 'px' }">
      <strong>{{ hover.row.bucket }}</strong>
      <div>{{ hover.row.fights }} combats · {{ fmtPct(hover.row.winrate) }} de victoires</div>
      <div class="secondary">{{ hover.row.wins }} V · {{ hover.row.draws }} N · {{ hover.row.losses }} D</div>
    </div>
  </div>
</template>

<style scoped>
.bars { position: relative; display: flex; flex-direction: column; gap: 6px; }
.line { display: flex; align-items: center; gap: 10px; padding: 3px 0; }
.line:hover .stack { filter: brightness(1.15); }
.lbl { flex: none; font-size: 12px; color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.track { flex: 1; min-width: 60px; }
.stack { display: flex; gap: 2px; height: 14px; }
.seg { min-width: 2px; }
.seg:first-child { border-radius: 0; }
.seg:last-child { border-radius: 0; }
.win { background: var(--good); }
.loss { background: var(--critical); }
.draw { background: var(--neutral); }
.val { flex: none; width: 92px; text-align: right; font-size: 12px; }
.legend { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 6px; }
.sw { display: inline-block; width: 10px; height: 10px; margin-right: 4px; vertical-align: -1px; }
.tip { position: absolute; z-index: 5; pointer-events: none; background: var(--surface-3); border: 1px solid var(--border); padding: 6px 10px; font-size: 12px; box-shadow: var(--shadow-pixel-small); white-space: nowrap; }
</style>
