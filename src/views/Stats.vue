<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { api, qs, CONTEXTS, TYPES } from "../api";
import { state, go, trackJob, refreshStatus } from "../state";
import { fmtNum, fmtOps, fmtPct } from "../format";
import LeekImage from "../components/LeekImage.vue";
import ItemIcon from "../components/ItemIcon.vue";
import StatTile from "../components/StatTile.vue";
import RecordBars from "../components/RecordBars.vue";
import LineChart from "../components/LineChart.vue";

const f = reactive({ context: "", type: "", last: "", period: "" });
const s = ref<any>(null);
const error = ref("");
const oppSort = ref<"fights" | "winrate" | "losses">("fights");

async function load() {
  try {
    const since = f.period ? Math.floor(Date.now() / 1000) - Number(f.period) * 86400 : undefined;
    s.value = await api.get(`/api/stats${qs({ leek: state.leekId ?? undefined, context: f.context, type: f.type, last: f.last, since })}`);
    error.value = "";
  } catch (e: any) {
    error.value = e.message;
  }
}
watch(() => [state.leekId, state.dataVersion, { ...f }], load, { immediate: true, deep: true });

const byContext = computed(() =>
  Object.entries(s.value?.byContext ?? {}).map(([k, v]: any) => ({ bucket: CONTEXTS[Number(k)] ?? k, ...v })),
);
const byType = computed(() => Object.entries(s.value?.byType ?? {}).map(([k, v]: any) => ({ bucket: TYPES[Number(k)] ?? k, ...v })));
const daySeries = computed(() => [
  {
    name: "Taux de victoire",
    color: "var(--series-me)",
    points: (s.value?.byDay ?? []).map((d: any) => ({ x: Date.parse(d.day) / 1000, y: d.winrate })),
  },
]);
const shortDate = (ts: number) => new Date(ts * 1000).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" });
const trackedIds = computed(() => new Set((state.status?.leeks ?? []).map((l) => l.id)));
async function follow(id: number) {
  const res = await api.post("/api/leeks/tracked", { id });
  if (res.job) trackJob(res.job);
  refreshStatus();
}
const opponents = computed(() => {
  const list = [...(s.value?.opponents ?? [])];
  if (oppSort.value === "winrate") list.sort((a, b) => a.winrate - b.winrate || b.fights - a.fights);
  if (oppSort.value === "losses") list.sort((a, b) => b.losses - a.losses);
  return list.slice(0, 40);
});
</script>

<template>
  <section class="row">
    <h1>Analyse</h1>
    <span class="spacer"></span>
  </section>

  <section class="card row filters">
    <label class="field">
      Période
      <select v-model="f.period"><option value="">Tout</option><option value="1">24 h</option><option value="7">7 jours</option><option value="30">30 jours</option></select>
    </label>
    <label class="field">
      Derniers combats
      <select v-model="f.last"><option value="">Tous</option><option value="20">20</option><option value="50">50</option><option value="100">100</option><option value="200">200</option></select>
    </label>
    <label class="field">
      Contexte
      <select v-model="f.context"><option value="">Tous</option><option v-for="(l, k) in CONTEXTS" :key="k" :value="k">{{ l }}</option></select>
    </label>
    <label class="field">
      Type
      <select v-model="f.type"><option value="">Tous</option><option v-for="(l, k) in TYPES" :key="k" :value="k">{{ l }}</option></select>
    </label>
  </section>

  <div v-if="error" class="error">{{ error }}</div>

  <template v-if="s">
    <section class="tiles">
      <StatTile label="Combats" :value="s.total.fights" :hint="`${s.total.wins} V · ${s.total.draws} N · ${s.total.losses} D`" />
      <StatTile label="Taux de victoire" :value="fmtPct(s.total.winrate)" />
      <StatTile label="Dégâts infligés / combat" :value="fmtNum(s.averages.damageDealt)" :hint="`subis : ${fmtNum(s.averages.damageTaken)}`" />
      <StatTile label="Soins / combat" :value="fmtNum(s.averages.heal)" />
      <StatTile label="Vie restante moy." :value="fmtNum(s.averages.lifeLeftPct, 1) + ' %'" />
      <StatTile label="PT inutilisés / tour" :value="fmtNum(s.averages.tpUnusedPerTurn, 2)" />
      <StatTile label="Ops IA / combat" :value="fmtOps(s.averages.ops)" />
      <StatTile label="Bugs IA" :value="s.bugs.total" :hint="`${s.bugs.fights} combat(s) concernés`" />
    </section>

    <section class="card">
      <h2>Taux de victoire par jour (%)</h2>
      <LineChart v-if="daySeries[0].points.length > 1" :series="daySeries" :format-x="shortDate" :format-y="(y) => Math.round(y) + ' %'" :y-min="0" :y-max="100" :height="200" />
      <div v-else class="empty">Pas assez de jours de données.</div>
    </section>

    <section class="grid cols-2">
      <div class="card"><h2>Selon l'écart de niveau (adversaire − moi)</h2><RecordBars :rows="s.byLevelDiff" /></div>
      <div class="card"><h2>Selon l'écart de talent (adversaire − moi)</h2><RecordBars :rows="s.byTalentDiff" /></div>
      <div class="card"><h2>Selon la durée (tours)</h2><RecordBars :rows="s.byDuration" :label-width="60" /></div>
      <div class="card"><h2>Selon le profil de l'adversaire</h2><RecordBars :rows="s.byOppProfile" :label-width="90" /><p class="small muted">Profil = caractéristique dominante parmi force, sagesse, agilité, résistance, science, magie (« Mixte » si deux sont proches).</p></div>
      <div class="card"><h2>Selon mon build</h2><RecordBars :rows="s.byBuild.slice(0, 6)" :label-width="230" /><p class="small muted"><a href="#/characteristics">Gérer les caractéristiques →</a></p></div>
      <div class="card">
        <h2>Selon le contexte et le type</h2>
        <RecordBars :rows="byContext" />
        <div style="height: 12px"></div>
        <RecordBars :rows="byType" />
      </div>
    </section>

    <section class="card">
      <h2>Utilisation des objets</h2>
      <div class="table-wrap" v-if="s.items.length">
        <table>
          <thead>
            <tr>
              <th>Objet</th><th class="num">Utilisé dans</th><th class="num">Util./combat</th><th class="num">Total util.</th><th class="num">Dégâts</th>
              <th class="num">Dégâts/util.</th><th class="num">Soins</th><th class="num">Kills</th><th class="num">Crit.</th><th class="num">Victoires si utilisé</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="it in s.items" :key="it.kind + it.name">
              <td><ItemIcon :kind="it.kind" :name="it.name" label /></td>
              <td class="num">{{ fmtPct(it.usageRate) }}</td>
              <td class="num">{{ fmtNum(it.usesPerFight, 1) }}</td>
              <td class="num">{{ it.uses }}</td>
              <td class="num">{{ fmtNum(it.damage) }}</td>
              <td class="num">{{ fmtNum(it.damagePerUse, 1) }}</td>
              <td class="num">{{ fmtNum(it.heal) }}</td>
              <td class="num">{{ it.kills }}</td>
              <td class="num">{{ fmtPct(it.critRate) }}</td>
              <td class="num">{{ fmtPct(it.winrateWhenUsed) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-else class="empty">Aucune donnée d'objets.</div>
    </section>

    <section class="card">
      <div class="row" style="margin-bottom: 8px">
        <h2>Adversaires</h2><span class="spacer"></span>
        <select v-model="oppSort"><option value="fights">Les plus affrontés</option><option value="losses">Le plus de défaites</option><option value="winrate">Pire taux de victoire</option></select>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Adversaire</th><th class="num">Niveau</th><th class="num">Talent</th><th class="num">Combats</th><th class="num">V / N / D</th><th class="num">Taux</th><th></th></tr></thead>
          <tbody>
            <tr v-for="o in opponents" :key="o.id" class="clickable" @click="go(`#/fights?opponent=${o.id}`)">
              <td class="leek-cell"><LeekImage :leek="o" head :size="28" />{{ o.name }} <span class="muted small">#{{ o.id }}</span></td>
              <td class="num">{{ o.level }}</td><td class="num">{{ o.talent }}</td><td class="num">{{ o.fights }}</td>
              <td class="num">{{ o.wins }} / {{ o.draws }} / {{ o.losses }}</td><td class="num">{{ fmtPct(o.winrate) }}</td>
              <td class="num"><button v-if="!trackedIds.has(o.id)" class="ghost small" @click.stop="follow(o.id)" title="Suivre pour analyser son historique">+ Suivre</button><span v-else class="muted small">suivi</span></td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </template>
</template>

<style scoped>
.filters { align-items: flex-end; gap: 14px; }
</style>
