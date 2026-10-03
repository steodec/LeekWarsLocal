<script setup lang="ts">
import { reactive, ref, watch } from "vue";
import { api, qs, CONTEXTS, TYPES, type FightSummary } from "../api";
import { state, go } from "../state";
import { fmtDate, fmtNum, fmtOps } from "../format";
import FightMatchup from "../components/FightMatchup.vue";

const initial = Object.fromEntries(new URLSearchParams(window.location.hash.split("?")[1] ?? ""));
const f = reactive({
  result: initial.result ?? "",
  context: initial.context ?? "",
  type: initial.type ?? "",
  q: initial.q ?? initial.opponent ?? "",
  tag: initial.tag ?? "",
  bugs: initial.bugs === "1",
});
const page = ref(0);
const PAGE = 50;
const list = ref<FightSummary[]>([]);
const total = ref(0);
const error = ref("");
const importId = ref("");

async function load() {
  try {
    const res = await api.get(
      `/api/fights${qs({
        leek: state.leekId ?? undefined,
        result: f.result,
        context: f.context,
        type: f.type,
        q: f.q,
        tag: f.tag,
        bugs: f.bugs ? 1 : undefined,
        limit: PAGE,
        offset: page.value * PAGE,
      })}`,
    );
    list.value = res.fights;
    total.value = res.total;
    error.value = "";
  } catch (e: any) {
    error.value = e.message;
  }
}
watch(() => [state.leekId, state.dataVersion, page.value], load, { immediate: true });
watch(f, () => {
  page.value = 0;
  load();
});

async function importFight() {
  const id = Number(importId.value.replace(/\D/g, ""));
  if (!id) return;
  try {
    await api.post("/api/fights/import", { ids: [id] });
    go(`#/fight/${id}`);
  } catch (e: any) {
    error.value = e.message;
  }
}

</script>

<template>
  <section class="row">
    <h1>Combats</h1>
    <span class="muted">{{ total }} combat(s)</span>
    <span class="spacer"></span>
    <input v-model="importId" placeholder="Importer un combat (ID ou URL)" style="width: 240px" @keyup.enter="importFight" />
    <button @click="importFight">Importer</button>
  </section>

  <section class="card row filters">
    <label class="field">
      Résultat
      <select v-model="f.result">
        <option value="">Tous</option><option value="win">Victoires</option><option value="loss">Défaites</option><option value="draw">Égalités</option>
      </select>
    </label>
    <label class="field">
      Contexte
      <select v-model="f.context">
        <option value="">Tous</option>
        <option v-for="(l, k) in CONTEXTS" :key="k" :value="k">{{ l }}</option>
      </select>
    </label>
    <label class="field">
      Type
      <select v-model="f.type">
        <option value="">Tous</option>
        <option v-for="(l, k) in TYPES" :key="k" :value="k">{{ l }}</option>
      </select>
    </label>
    <label class="field">Recherche (adversaire, note, ID)<input v-model.lazy="f.q" placeholder="…" /></label>
    <label class="field">Tag<input v-model.lazy="f.tag" placeholder="ex. test-v2" style="width: 120px" /></label>
    <label class="row small secondary" style="gap: 6px; padding-bottom: 6px"><input type="checkbox" v-model="f.bugs" /> Avec bug IA</label>
  </section>

  <div v-if="error" class="error">{{ error }}</div>

  <section class="card">
    <div class="table-wrap" v-if="list.length">
      <table>
        <thead>
          <tr>
            <th>Combat</th><th>Date</th><th>Contexte</th>
            <th class="num">Tours</th><th class="num">Dégâts infl.</th><th class="num">Dégâts subis</th><th class="num">Vie restante</th>
            <th class="num">PT inutilisés/tour</th><th class="num">Ops</th><th class="num">Talent</th><th>Notes</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="x in list" :key="x.id" class="clickable" @click="go('#/fight/' + x.id)">
            <td class="matchup-cell"><FightMatchup :fight="x" /><span v-if="x.type === 0 && x.opponents[0]" class="muted small">niv. {{ x.opponents[0].level }} · {{ x.opponents[0].talent }}</span></td>
            <td class="mono">{{ fmtDate(x.date) }}</td>
            <td class="secondary">{{ CONTEXTS[x.context] ?? x.context }} · {{ TYPES[x.type] ?? x.type }}</td>
            <td class="num">{{ x.turns ?? "–" }}</td>
            <td class="num">{{ fmtNum(x.me?.damageDealt) }}</td>
            <td class="num">{{ fmtNum(x.me?.damageTaken) }}</td>
            <td class="num">{{ x.me ? fmtNum(x.me.lifeLeftPct) + " %" : "–" }}</td>
            <td class="num">{{ fmtNum(x.me?.tpUnusedPerTurn, 1) }}</td>
            <td class="num">{{ fmtOps(x.me?.ops) }}</td>
            <td class="num">{{ x.talentGain != null ? (x.talentGain > 0 ? "+" : "") + x.talentGain : "–" }}</td>
            <td>
              <span v-if="x.me?.bugs" class="tag" style="color: var(--critical)">⚠ {{ x.me.bugs }} bug</span>
              <span v-for="t in x.tags" :key="t" class="tag">{{ t }}</span>
              <span class="small muted">{{ x.note }}</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <div v-else class="empty">Aucun combat ne correspond aux filtres.</div>
    <div class="row" v-if="total > PAGE" style="margin-top: 12px">
      <button :disabled="page === 0" @click="page--">← Précédent</button>
      <span class="muted">Page {{ page + 1 }} / {{ Math.ceil(total / PAGE) }}</span>
      <button :disabled="(page + 1) * PAGE >= total" @click="page++">Suivant →</button>
    </div>
  </section>
</template>

<style scoped>
.filters { align-items: flex-end; gap: 14px; }
</style>
