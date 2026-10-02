<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { api, qs, CONTEXTS, type FightSummary } from "../api";
import { state, go } from "../state";
import { fmtDate, fmtNum, fmtPct } from "../format";
import StatTile from "../components/StatTile.vue";
import ResultBadge from "../components/ResultBadge.vue";
import LineChart from "../components/LineChart.vue";
import LeekImage from "../components/LeekImage.vue";

const stats = ref<any>(null);
const recent = ref<FightSummary[]>([]);
const error = ref("");

async function load() {
  try {
    const leek = state.leekId ?? undefined;
    const [s, f] = await Promise.all([api.get(`/api/stats${qs({ leek })}`), api.get(`/api/fights${qs({ leek, limit: 12 })}`)]);
    stats.value = s;
    recent.value = f.fights;
    error.value = "";
  } catch (e: any) {
    error.value = e.message;
  }
}
watch(() => [state.leekId, state.dataVersion], load, { immediate: true });

const leek = computed(() => state.status?.leeks.find((l) => l.id === state.leekId) ?? null);
// Combats restants du compte du poireau affiché (ou du compte actif en vue éleveur).
const garden = computed(() => {
  const accId = leek.value?.accountId ?? state.status?.farmer.id;
  return state.status?.accounts.find((a) => a.id === accId)?.garden ?? state.status?.garden ?? null;
});
const talentSeries = computed(() => [
  {
    name: "Talent",
    color: "var(--series-me)",
    points: (stats.value?.talent ?? []).map((t: any) => ({ x: t.date, y: t.talent })),
  },
]);
const streakLabel = computed(() => {
  const s = stats.value?.streak;
  if (!s?.result) return "–";
  const word = s.result === "win" ? "victoire" : s.result === "loss" ? "défaite" : "égalité";
  return `${s.count} ${word}${s.count > 1 ? "s" : ""}`;
});
const shortDate = (ts: number) => new Date(ts * 1000).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" });
const opp = (f: FightSummary) => f.opponents.map((o) => o.name).join(", ") || "?";
</script>

<template>
  <div v-if="error" class="error">{{ error }}</div>

  <section class="row hero">
    <LeekImage v-if="leek" :leek="leek" :size="110" />
    <div v-else class="team">
      <LeekImage v-for="l in (state.status?.leeks ?? []).filter((x) => x.owned).slice(0, 4)" :key="l.id" :leek="l" :size="72" />
    </div>
    <div class="titles">
      <h1>{{ leek ? leek.name : "Tous les poireaux" }}</h1>
      <span v-if="leek" class="muted">niv. {{ leek.level }} · talent {{ leek.talent }}<template v-if="leek.owned"> · IA <code>{{ leek.ai ?? "aucune" }}</code></template></span>
      <span v-if="leek && !leek.owned" class="tag">analyse · éleveur {{ leek.farmerName }}</span>
    </div>
    <span class="spacer"></span>
    <button v-if="!leek || leek.owned" class="primary" @click="go('#/launch')">Lancer des combats</button>
  </section>

  <section class="tiles" v-if="stats">
    <StatTile v-if="!leek || leek.owned" label="Combats restants" :value="garden ? `${garden.fights}/${garden.maxFights}` : '–'" :hint="`aujourd'hui · ${leek?.accountName ?? state.status?.farmer.name ?? ''}`" />
    <StatTile v-else label="Combats stockés" :value="stats.total.fights" hint="depuis son historique" />
    <StatTile label="Taux de victoire" :value="fmtPct(stats.total.winrate)" :hint="`${stats.total.wins} V · ${stats.total.draws} N · ${stats.total.losses} D`" />
    <StatTile label="10 derniers" :value="fmtPct(stats.recent.last10.winrate)" :hint="`50 derniers : ${fmtPct(stats.recent.last50.winrate)}`" />
    <StatTile label="Série en cours" :value="streakLabel" />
    <StatTile label="Durée moyenne" :value="`${fmtNum(stats.averages.turns, 1)} tours`" />
    <StatTile label="Bugs IA" :value="stats.bugs.total" :hint="`dans ${stats.bugs.fights} combat(s)`" />
  </section>

  <section class="grid cols-2">
    <div class="card">
      <h2>Évolution du talent</h2>
      <LineChart v-if="talentSeries[0].points.length > 1" :series="talentSeries" :format-x="shortDate" :height="200" />
      <div v-else class="empty">Synchronisez ou lancez des combats pour voir l'évolution.</div>
    </div>
    <div class="card">
      <h2>Bêtes noires</h2>
      <div class="table-wrap" v-if="stats?.nemeses?.length">
        <table>
          <thead><tr><th>Adversaire</th><th class="num">Niv.</th><th class="num">Talent</th><th class="num">Bilan</th><th class="num">Taux</th></tr></thead>
          <tbody>
            <tr v-for="o in stats.nemeses.slice(0, 7)" :key="o.id" class="clickable" @click="go(`#/fights?opponent=${o.id}`)">
              <td class="leek-cell"><LeekImage :leek="o" head :size="28" />{{ o.name }}</td><td class="num">{{ o.level }}</td><td class="num">{{ o.talent }}</td>
              <td class="num">{{ o.wins }}V {{ o.losses }}D</td><td class="num">{{ fmtPct(o.winrate) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-else class="empty">Aucune défaite enregistrée 🎉</div>
    </div>
  </section>

  <section class="card">
    <div class="row" style="margin-bottom: 8px">
      <h2>Derniers combats</h2><span class="spacer"></span><a href="#/fights">Tout voir →</a>
    </div>
    <div class="table-wrap" v-if="recent.length">
      <table>
        <thead><tr><th>Résultat</th><th>Date</th><th>Adversaire</th><th>Contexte</th><th class="num">Tours</th><th class="num">Dégâts infl./subis</th><th class="num">Talent</th></tr></thead>
        <tbody>
          <tr v-for="f in recent" :key="f.id" class="clickable" @click="go('#/fight/' + f.id)">
            <td><ResultBadge :result="f.result" /></td>
            <td class="mono">{{ fmtDate(f.date) }}</td>
            <td class="leek-cell"><LeekImage v-if="f.opponents[0]" :leek="f.opponents[0]" head :size="28" />{{ opp(f) }} <span class="muted small">niv. {{ f.opponents[0]?.level }}</span></td>
            <td class="secondary">{{ CONTEXTS[f.context] ?? f.context }}</td>
            <td class="num">{{ f.turns ?? "–" }}</td>
            <td class="num">{{ fmtNum(f.me?.damageDealt) }} / {{ fmtNum(f.me?.damageTaken) }}</td>
            <td class="num">{{ f.talentGain != null ? (f.talentGain > 0 ? "+" : "") + f.talentGain : "–" }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <div v-else class="empty">Aucun combat stocké. Cliquez sur « Synchroniser » pour importer votre historique.</div>
  </section>
</template>

<style scoped>
.hero { align-items: flex-end; gap: 16px; }
.team { display: flex; align-items: flex-end; gap: 4px; }
.titles { display: flex; flex-direction: column; gap: 4px; padding-bottom: 6px; }
</style>
