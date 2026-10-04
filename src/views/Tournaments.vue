<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { api } from "../api";
import { go, state } from "../state";
import { fmtDate } from "../format";

interface Entry {
  id: number; date: number; kind: "solo" | "farmer";
  entity: { id: number; name: string; mine: boolean };
  rounds: number[]; wins: number; status: "eliminated" | "running" | "qualified";
}
interface Contestant { id: number; name: string; level: number | null; win: boolean; mine: boolean; tracked: boolean }
interface Bracket {
  id: number; type: string; date: number; finished: boolean; size: number; currentRound: number | null; nextRound: number | null;
  rounds: { key: string; label: string; matches: { fightId: number | null; contestants: (Contestant | null)[] }[] }[];
  importing: number; url: string;
}

const props = defineProps<{ id: number }>();
const entries = ref<Entry[] | null>(null);
const bracket = ref<Bracket | null>(null);
const error = ref("");
const loading = ref(false);

async function loadList() {
  try {
    entries.value = (await api.get("/api/tournaments")).tournaments;
    error.value = "";
  } catch (e: any) {
    error.value = e.message;
  }
}

async function loadBracket(id: number) {
  bracket.value = null;
  if (!id) return;
  loading.value = true;
  try {
    bracket.value = await api.get(`/api/tournaments/${id}`);
    error.value = "";
  } catch (e: any) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}

loadList();
watch(() => props.id, loadBracket, { immediate: true });
watch(() => state.dataVersion, loadList);

// Un même tournoi peut réunir plusieurs de mes poireaux : une ligne par tournoi.
const tournaments = computed(() => {
  const byId = new Map<number, { id: number; date: number; kind: string; entries: Entry[] }>();
  for (const e of entries.value ?? []) {
    const t = byId.get(e.id) ?? { id: e.id, date: e.date, kind: e.kind, entries: [] };
    t.entries.push(e);
    byId.set(e.id, t);
  }
  return [...byId.values()].sort((a, b) => b.date - a.date);
});

const KIND: Record<string, string> = { solo: "Solo", farmer: "Éleveur", team: "Équipe" };
const STATUS: Record<string, string> = { eliminated: "Éliminé", running: "En cours", qualified: "Qualifié" };
const roundGlyph = (r: number) => (r === 1 ? "✓" : r === -1 ? "✕" : "…");
const nextRoundIn = (ts: number | null) => {
  if (!ts) return "";
  const min = Math.round((ts * 1000 - Date.now()) / 60000);
  return min > 0 ? `prochaine manche dans ${min} min` : "prochaine manche imminente";
};
</script>

<template>
  <section class="row">
    <button v-if="id" class="ghost" @click="go('#/tournaments')">←</button>
    <h1>{{ id ? `Tournoi #${id}` : "Tournois" }}</h1>
    <span class="spacer"></span>
    <template v-if="bracket">
      <span class="secondary">
        {{ KIND[bracket.type] ?? bracket.type }} · {{ bracket.size }} participants · {{ fmtDate(bracket.date) }} ·
        {{ bracket.finished ? "terminé" : nextRoundIn(bracket.nextRound) }}
      </span>
      <a class="btn" :href="bracket.url" target="_blank" rel="noopener">Voir sur Leek Wars ↗</a>
    </template>
    <button v-else-if="!id" @click="loadList">Actualiser</button>
  </section>

  <div v-if="error" class="error">{{ error }}</div>

  <!-- Arbre d'un tournoi -->
  <template v-if="id">
    <div v-if="loading" class="card muted small">Chargement de l'arbre…</div>
    <section v-else-if="bracket" class="card">
      <p v-if="bracket.importing" class="small secondary" style="margin-top: 0">
        Import de {{ bracket.importing }} combat(s) de vos poireaux en arrière-plan : ils apparaîtront dans Combats et Analyse.
      </p>
      <div class="bracket">
        <div v-for="r in bracket.rounds" :key="r.key" class="round">
          <h3>{{ r.label }}</h3>
          <div class="matches">
            <div v-for="(m, i) in r.matches" :key="i" class="match" :class="{ mine: m.contestants.some((c) => c?.mine) }">
              <div v-for="(c, j) in m.contestants" :key="j" class="contestant" :class="{ win: c?.win, mine: c?.mine, tracked: c?.tracked && !c?.mine }">
                <template v-if="c">
                  <span class="name">{{ c.name }}</span>
                  <span v-if="c.level" class="muted small">{{ c.level }}</span>
                </template>
                <span v-else class="muted small">à venir</span>
              </div>
              <div v-if="!m.contestants.length" class="contestant muted small">à venir</div>
              <a v-if="m.fightId" class="fight small" :href="'#/fight/' + m.fightId" title="Ouvrir le combat">combat →</a>
            </div>
          </div>
        </div>
      </div>
      <p class="small muted">En vert : vos poireaux (ou éleveurs) ; en bleu : les poireaux suivis. Le vainqueur de chaque match est en gras.</p>
    </section>
  </template>

  <!-- Liste -->
  <section v-else class="card">
    <div v-if="!entries" class="muted small">Chargement des tournois…</div>
    <div v-else-if="!tournaments.length" class="empty">
      Aucun tournoi récent pour vos poireaux et éleveurs. Inscrivez-les aux tournois sur Leek Wars : ils apparaîtront ici.
    </div>
    <div v-else class="table-wrap">
      <table>
        <thead><tr><th>Date</th><th>Type</th><th>Participant(s)</th><th>Parcours</th><th>État</th><th></th></tr></thead>
        <tbody>
          <template v-for="t in tournaments" :key="t.id">
            <tr v-for="(e, i) in t.entries" :key="t.id + '-' + e.entity.id" class="clickable" @click="go('#/tournament/' + t.id)">
              <td v-if="i === 0" :rowspan="t.entries.length">{{ fmtDate(t.date) }}</td>
              <td v-if="i === 0" :rowspan="t.entries.length">{{ KIND[t.kind] ?? t.kind }}</td>
              <td>{{ e.entity.name }} <span v-if="!e.entity.mine" class="tag">suivi</span></td>
              <td class="mono">
                <span v-for="(r, k) in e.rounds" :key="k" class="glyph" :class="{ good: r === 1, bad: r === -1 }">{{ roundGlyph(r) }}</span>
                <span class="muted small"> {{ e.wins }} manche(s) gagnée(s)</span>
              </td>
              <td><span :class="{ good: e.status === 'qualified', bad: e.status === 'eliminated' }">{{ STATUS[e.status] }}</span></td>
              <td v-if="i === 0" :rowspan="t.entries.length" class="num"><a :href="'#/tournament/' + t.id" @click.stop>Arbre →</a></td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>
    <p class="small muted">Tournois récents tels que listés par Leek Wars (les derniers jours). ✓ manche gagnée, ✕ éliminé, … en attente.</p>
  </section>
</template>

<style scoped>
.clickable { cursor: pointer; }
.clickable:hover td { background: var(--surface-2); }
.glyph { display: inline-block; width: 16px; text-align: center; font-weight: 700; }
.good { color: var(--good); }
.bad { color: var(--critical); }
.bracket { display: flex; gap: 16px; overflow-x: auto; padding-bottom: 8px; }
.round { flex: 0 0 200px; display: flex; flex-direction: column; }
.round h3 { margin: 0 0 8px; font-size: 14px; }
.matches { flex: 1; display: flex; flex-direction: column; justify-content: space-around; gap: 8px; }
.match { border: 1px solid var(--border); background: var(--surface-2); padding: 4px 6px; position: relative; }
.match.mine { border-color: var(--good); }
.contestant { display: flex; justify-content: space-between; gap: 6px; padding: 2px 0; font-size: 13px; }
.contestant .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.contestant.win .name { font-weight: 700; }
.contestant.mine .name { color: var(--good); }
.contestant.tracked .name { color: var(--link); }
.contestant + .contestant { border-top: 1px dashed var(--border); }
.fight { display: block; text-align: right; }
</style>
