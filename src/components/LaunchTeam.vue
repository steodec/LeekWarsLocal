<script setup lang="ts">
// Combats d'équipe : une composition de mon équipe contre les compositions proposées par Leek Wars.
import { computed, ref, watch } from "vue";
import { api } from "../api";
import { trackJob, type Job } from "../state";

interface Composition {
  id: number; name: string; team: string; level: number; totalLevel: number; talent: number; leekCount: number;
  accountId: number; accountName: string; teamFights: number; maxTeamFights: number;
}
const emit = defineEmits<{ launched: [job: Job] }>();

const compositions = ref<Composition[]>([]);
// Une composition appartient à l'équipe : chacun de mes comptes de l'équipe peut la jouer avec ses propres combats.
const selected = ref("");
const opponents = ref<any[]>([]);
const count = ref(1);
const strategy = ref("weakest");
const batch = ref(false);
const loading = ref(false);
const busy = ref(false);
const error = ref("");

const current = computed(() => compositions.value.find((c) => `${c.id}:${c.accountId}` === selected.value) ?? null);
const fightsLeft = computed(() => current.value?.teamFights ?? 0);

async function load() {
  try {
    compositions.value = (await api.get("/api/compositions")).compositions;
    if (!current.value && compositions.value[0]) selected.value = `${compositions.value[0].id}:${compositions.value[0].accountId}`;
  } catch (e: any) {
    error.value = e.message;
  }
}
load();

async function loadOpponents() {
  opponents.value = [];
  if (!current.value) return;
  loading.value = true;
  try {
    opponents.value = (await api.get(`/api/opponents/composition/${current.value.id}?account=${current.value.accountId}`)).opponents;
    error.value = "";
  } catch (e: any) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}
watch(current, loadOpponents);

async function launch(targetId?: number) {
  if (!current.value) return;
  busy.value = true;
  error.value = "";
  try {
    const job: Job = await api.post("/api/fights/team", {
      compositionId: current.value.id, accountId: current.value.accountId, targetId,
      strategy: strategy.value, count: targetId ? 1 : count.value, batch: batch.value,
    });
    trackJob(job);
    emit("launched", job);
    current.value.teamFights -= targetId ? 1 : count.value;
    if (targetId) loadOpponents();
  } catch (e: any) {
    error.value = e.message;
  } finally {
    busy.value = false;
  }
}

const STRATS: Record<string, string> = { weakest: "La plus faible (talent min.)", closest: "La plus proche en talent", strongest: "La plus forte", random: "Aléatoire" };
</script>

<template>
  <div v-if="error" class="error">{{ error }}</div>
  <section class="card">
    <div v-if="!compositions.length" class="empty">
      Aucune composition : rejoignez une équipe et créez une composition sur Leek Wars pour lancer des combats d'équipe.
    </div>
    <div v-else class="row form">
      <label class="field">
        Composition
        <select v-model="selected">
          <option v-for="c in compositions" :key="`${c.id}:${c.accountId}`" :value="`${c.id}:${c.accountId}`">
            {{ c.name }} [{{ c.team }}] · {{ c.leekCount }} poireaux{{ compositions.some((x) => x.id === c.id && x.accountId !== c.accountId) ? ` · via ${c.accountName}` : "" }} · ⚔ {{ c.teamFights }}/{{ c.maxTeamFights }}
          </option>
        </select>
      </label>
      <label class="field">
        Nombre de combats
        <input type="number" v-model.number="count" min="1" :max="Math.max(1, fightsLeft)" style="width: 90px" />
      </label>
      <label class="field">
        Choix de l'adversaire
        <select v-model="strategy" :disabled="batch">
          <option v-for="(label, k) in STRATS" :key="k" :value="k">{{ label }}</option>
        </select>
      </label>
      <label class="row small secondary check"><input type="checkbox" v-model="batch" /> Lot API (Leek Wars+, adversaires tirés au sort)</label>
      <span class="spacer"></span>
      <button class="primary" :disabled="busy || !current || !fightsLeft || count < 1 || count > fightsLeft" @click="launch()">
        Lancer {{ count }} combat{{ count > 1 ? "s" : "" }} d'équipe
      </button>
    </div>
    <p class="small muted">Les combats d'équipe ont leur propre compteur quotidien ({{ current?.maxTeamFights ?? 10 }} par compte), distinct des combats solo et éleveur.</p>
  </section>

  <section v-if="current" class="card">
    <div class="row" style="margin-bottom: 8px">
      <h2>Compositions adverses</h2>
      <span class="spacer"></span>
      <button :disabled="loading" @click="loadOpponents">{{ loading ? "Chargement…" : "Nouvelle liste" }}</button>
    </div>
    <div v-if="opponents.length" class="table-wrap">
      <table>
        <thead><tr><th>Composition</th><th>Équipe</th><th class="num">Poireaux</th><th class="num">Niveau total</th><th class="num">Talent</th><th></th></tr></thead>
        <tbody>
          <tr v-for="o in opponents" :key="o.id">
            <td class="display">{{ o.name }}</td>
            <td>{{ o.team }}</td>
            <td class="num">{{ o.leekCount }}</td>
            <td class="num">{{ o.totalLevel }}</td>
            <td class="num">{{ o.talent }}</td>
            <td class="num"><button :disabled="busy || !fightsLeft" @click="launch(o.id)">Combattre</button></td>
          </tr>
        </tbody>
      </table>
    </div>
    <div v-else-if="!loading" class="empty">Aucune composition adverse disponible.</div>
  </section>
</template>

<style scoped>
.form { align-items: flex-end; gap: 14px; }
.check { gap: 6px; padding-bottom: 6px; }
</style>
