<script setup lang="ts">
// Méta par niveau : ce que jouent les poireaux du haut du classement autour d'un niveau, comparé à mon poireau.
import { computed, ref, watch } from "vue";
import { api, qs } from "../api";
import { state, trackJob } from "../state";
import { fmtDate, fmtNum } from "../format";
import { characIcon } from "../lw";
import ItemIcon from "../components/ItemIcon.vue";
import LeekImage from "../components/LeekImage.vue";

interface Quartiles { p25: number; median: number; p75: number; mine: number | null }
interface Item { name: string; count: number; pct: number; mine: boolean }
interface Profile {
  id: number; name: string; level: number; talent: number; farmer: string | null; rank?: number;
  skin?: number; hat?: number | null; metal?: boolean; face?: number;
  stats: Record<string, number>; chips: string[]; weapons: string[];
}
interface MetaResult {
  at: number; level: number; spread: number; count: number; leeks: Profile[]; mine: Profile | null;
  stats: Record<string, Quartiles>; chips: Item[]; weapons: Item[]; missing: Item[];
}

const selectedLeek = computed(() => state.status?.leeks.find((l) => l.id === state.leekId) ?? null);
const level = ref<number>(selectedLeek.value?.level ?? 100);
const spread = ref(10);
const count = ref(30);
const meta = ref<MetaResult | null>(null);
const jobId = ref<number | null>(null);
const error = ref("");

const job = computed(() => state.jobs.find((j) => j.id === jobId.value));
const running = computed(() => job.value?.status === "running");

async function load() {
  try {
    meta.value = await api.get(`/api/meta${qs({ level: level.value, spread: spread.value })}`);
    error.value = "";
  } catch (e: any) {
    error.value = e.message;
  }
}
load();
watch([level, spread], load);
watch(() => selectedLeek.value?.level, (l) => l && (level.value = l));
// Fin du calcul : on recharge le résultat mis en cache par le serveur.
watch(() => job.value?.status, (s) => {
  if (s === "done") load();
  if (s === "error") error.value = job.value?.error ?? "Calcul impossible";
});

async function compute() {
  error.value = "";
  try {
    const j = await api.post("/api/meta", { level: level.value, spread: spread.value, count: count.value, leekId: selectedLeek.value?.id });
    trackJob(j);
    jobId.value = j.id;
  } catch (e: any) {
    error.value = e.message;
  }
}

const LABELS: Record<string, string> = {
  life: "Vie", strength: "Force", wisdom: "Sagesse", agility: "Agilité", resistance: "Résistance",
  science: "Science", magic: "Magie", frequency: "Fréquence", tp: "PT", mp: "PM",
};
const scale = (q: Quartiles) => Math.max(q.p75, q.mine ?? 0, 1);
const pct = (v: number | null, q: Quartiles) => `${Math.min(100, (100 * (v ?? 0)) / scale(q))}%`;
const gap = (q: Quartiles) => (q.mine == null || !q.median ? null : Math.round((100 * (q.mine - q.median)) / q.median));
const topStats = (p: Profile) =>
  Object.entries(p.stats).filter(([k]) => !["life", "tp", "mp", "frequency"].includes(k)).sort((a, b) => b[1] - a[1]).slice(0, 2);
</script>

<template>
  <section class="row">
    <h1>Méta par niveau</h1>
    <span class="spacer"></span>
    <span v-if="meta" class="secondary small">calculée le {{ fmtDate(Math.floor(meta.at / 1000)) }} sur {{ meta.count }} poireaux</span>
  </section>

  <div v-if="error" class="error">{{ error }}</div>

  <section class="card">
    <div class="row form">
      <label class="field">Niveau<input type="number" v-model.number="level" min="1" max="301" style="width: 90px" /></label>
      <label class="field">Écart de niveau<input type="number" v-model.number="spread" min="0" max="100" style="width: 90px" /></label>
      <label class="field">Poireaux analysés<input type="number" v-model.number="count" min="5" max="60" style="width: 90px" /></label>
      <span class="spacer"></span>
      <button class="primary" :disabled="running" @click="compute">
        {{ running ? `Analyse… ${job?.progress.done ?? 0}/${job?.progress.total || count}` : meta ? "Recalculer" : "Analyser la méta" }}
      </button>
    </div>
    <p class="small muted">
      Les poireaux les mieux classés en talent entre les niveaux {{ level - spread }} et {{ level }}, d'après le classement et les fiches
      publiques de Leek Wars (mises en cache 12 h).
      <template v-if="selectedLeek">Comparaison avec <b>{{ selectedLeek.name }}</b> (poireau sélectionné en haut de la page).</template>
    </p>
  </section>

  <template v-if="meta">
    <section v-if="meta.missing.length" class="card warn">
      <h2>Ce que joue la majorité et que {{ meta.mine?.name ?? "votre poireau" }} n'a pas</h2>
      <div class="items">
        <span v-for="x in meta.missing" :key="x.name" class="item">
          <ItemIcon :kind="meta.weapons.some((w) => w.name === x.name) ? 'weapon' : 'chip'" :name="x.name" label :size="22" />
          <b class="mono">{{ x.pct }} %</b>
        </span>
      </div>
    </section>

    <section class="card">
      <h2>Caractéristiques</h2>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Caractéristique</th><th class="num">1er quartile</th><th class="num">Médiane</th><th class="num">3e quartile</th><th class="num">{{ meta.mine?.name ?? "Moi" }}</th><th class="num">Écart</th><th style="width: 30%"></th></tr></thead>
          <tbody>
            <tr v-for="(q, k) in meta.stats" :key="k">
              <td class="charac"><img class="charac-icon" :src="characIcon(k as string)" alt="" /> <span :style="{ color: `var(--stat-${k})` }">{{ LABELS[k] ?? k }}</span></td>
              <td class="num muted">{{ fmtNum(q.p25) }}</td>
              <td class="num"><b>{{ fmtNum(q.median) }}</b></td>
              <td class="num muted">{{ fmtNum(q.p75) }}</td>
              <td class="num">{{ q.mine == null ? "–" : fmtNum(q.mine) }}</td>
              <td class="num" :class="{ good: (gap(q) ?? 0) > 15, bad: (gap(q) ?? 0) < -15 }">{{ gap(q) == null ? "" : `${gap(q)! > 0 ? "+" : ""}${gap(q)} %` }}</td>
              <td>
                <div class="bar">
                  <span class="range" :style="{ left: pct(q.p25, q), width: `calc(${pct(q.p75, q)} - ${pct(q.p25, q)})` }"></span>
                  <span class="median" :style="{ left: pct(q.median, q) }"></span>
                  <span v-if="q.mine != null" class="me" :style="{ left: pct(q.mine, q) }"></span>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p class="small muted">Totaux (base, capital et équipement). Barre : zone grisée = moitié centrale des poireaux, trait = médiane, point = votre poireau.</p>
    </section>

    <section class="grid cols-2">
      <div v-for="kind in (['weapons', 'chips'] as const)" :key="kind" class="card">
        <h2>{{ kind === "weapons" ? "Armes" : "Puces" }} les plus jouées</h2>
        <div v-for="x in meta[kind]" :key="x.name" class="pop">
          <ItemIcon :kind="kind === 'weapons' ? 'weapon' : 'chip'" :name="x.name" label :size="22" />
          <span class="spacer"></span>
          <span v-if="x.mine" class="tag act">✓ équipé</span>
          <span class="pop-bar"><i :style="{ width: x.pct + '%' }"></i></span>
          <span class="mono small" style="width: 42px; text-align: right">{{ x.pct }} %</span>
        </div>
      </div>
    </section>

    <section class="card">
      <h2>Poireaux analysés</h2>
      <div class="table-wrap">
        <table>
          <thead><tr><th class="num">Rang</th><th>Poireau</th><th class="num">Niveau</th><th class="num">Talent</th><th>Profil</th><th>Armes</th></tr></thead>
          <tbody>
            <tr v-for="p in meta.leeks" :key="p.id">
              <td class="num muted">{{ p.rank }}</td>
              <td class="leek-cell"><LeekImage :leek="p" head :size="28" /> <a :href="`https://leekwars.com/leek/${p.id}`" target="_blank" rel="noopener">{{ p.name }}</a> <span class="muted small">{{ p.farmer }}</span></td>
              <td class="num">{{ p.level }}</td>
              <td class="num">{{ p.talent }}</td>
              <td class="small"><span v-for="[k, v] in topStats(p)" :key="k" :style="{ color: `var(--stat-${k})` }" class="stat">{{ LABELS[k] }} {{ v }}</span></td>
              <td><ItemIcon v-for="w in p.weapons" :key="w" kind="weapon" :name="w" :size="20" /></td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </template>
  <div v-else-if="!running" class="card empty">Pas encore de méta pour ce niveau : lancez l'analyse (environ {{ Math.ceil(count / 5) + 2 }} s).</div>
</template>

<style scoped>
.form { align-items: flex-end; gap: 14px; }
.warn { border-color: var(--warning); }
.items { display: flex; flex-wrap: wrap; gap: 8px 18px; }
.item { display: inline-flex; align-items: center; gap: 8px; }
.charac { display: flex; align-items: center; gap: 8px; }
.charac-icon { width: 22px; height: 22px; object-fit: contain; }
.good { color: var(--good); }
.bad { color: var(--critical); }
.bar { position: relative; height: 12px; background: var(--surface-2); }
.bar .range { position: absolute; top: 2px; bottom: 2px; background: var(--surface-3); border: 1px solid var(--border-strong); }
.bar .median { position: absolute; top: 0; bottom: 0; width: 2px; margin-left: -1px; background: var(--text-secondary); }
.bar .me { position: absolute; top: 1px; width: 10px; height: 10px; margin-left: -5px; border-radius: 50%; background: var(--series-me); }
.pop { display: flex; align-items: center; gap: 8px; padding: 3px 0; }
.pop-bar { width: 90px; height: 8px; background: var(--surface-2); }
.pop-bar i { display: block; height: 100%; background: var(--accent-surface); }
.tag.act { color: var(--accent); }
.stat + .stat { margin-left: 8px; }
</style>
