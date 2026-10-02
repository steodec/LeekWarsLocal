<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { api } from "../api";
import { state, trackJob, refreshStatus, type Job } from "../state";
import { fmtPct } from "../format";
import ResultBadge from "../components/ResultBadge.vue";
import LeekImage from "../components/LeekImage.vue";

type Mode = "solo" | "farmer" | "challenge";
const mode = ref<Mode>("solo");
// Seuls mes poireaux peuvent combattre : un poireau suivi pour analyse n'est pas proposé ici.
const ownLeeks = computed(() => (state.status?.leeks ?? []).filter((l) => l.owned));
const pickOwn = (id: number | null) => (ownLeeks.value.some((l) => l.id === id) ? id : ownLeeks.value[0]?.id ?? null);
const leekId = ref<number | null>(pickOwn(state.leekId));
watch(() => [state.leekId, ownLeeks.value.length], () => (leekId.value = pickOwn(state.leekId)));

const count = ref(1);
const strategy = ref("weakest");
const batch = ref(false);
const challenge = ref({ targetId: "", seed: "", side: "random", count: 1 });

const opponents = ref<any[]>([]);
const loadingOpp = ref(false);
const error = ref("");
const busy = ref(false);
const lastJobId = ref<number | null>(null);

// Compte concerné : celui du poireau (solo / défi) ou le compte choisi (éleveur).
const farmerAccountId = ref<number | null>(null);
const accounts = computed(() => state.status?.accounts ?? []);
const currentAccount = computed(() => {
  const id = mode.value === "farmer" ? farmerAccountId.value ?? state.status?.farmer.id : ownLeeks.value.find((l) => l.id === leekId.value)?.accountId;
  return accounts.value.find((a) => a.id === id) ?? null;
});
const fightsLeft = computed(() => currentAccount.value?.garden?.fights ?? 0);
const lastJob = computed<Job | undefined>(() => state.jobs.find((j) => j.id === lastJobId.value));

async function loadOpponents() {
  opponents.value = [];
  error.value = "";
  if (mode.value === "challenge") return;
  if (mode.value === "solo" && !leekId.value) return;
  loadingOpp.value = true;
  try {
    const res = await api.get(mode.value === "solo" ? `/api/opponents/${leekId.value}` : `/api/opponents/farmer${farmerAccountId.value ? `?account=${farmerAccountId.value}` : ""}`);
    opponents.value = res.opponents ?? [];
  } catch (e: any) {
    error.value = e.message;
  } finally {
    loadingOpp.value = false;
  }
}
watch([mode, leekId], loadOpponents, { immediate: true });

async function follow(o: any) {
  const res = await api.post("/api/leeks/tracked", { id: o.id });
  if (res.job) trackJob(res.job);
  o.tracked = true;
  refreshStatus();
}

async function launch(targetId?: number) {
  busy.value = true;
  error.value = "";
  try {
    let job: Job;
    if (mode.value === "challenge") {
      job = await api.post("/api/fights/challenge", {
        leekId: leekId.value,
        targetId: Number(targetId ?? challenge.value.targetId),
        seed: Number(challenge.value.seed) || 0,
        side: challenge.value.side,
        count: challenge.value.count,
      });
    } else {
      const body = { leekId: leekId.value, accountId: farmerAccountId.value ?? undefined, targetId, strategy: strategy.value, count: targetId ? 1 : count.value, batch: batch.value };
      job = await api.post(mode.value === "solo" ? "/api/fights/solo" : "/api/fights/farmer", body);
    }
    trackJob(job);
    lastJobId.value = job.id;
    if (targetId) loadOpponents();
  } catch (e: any) {
    error.value = e.message;
  } finally {
    busy.value = false;
  }
}

const STRATS: Record<string, string> = {
  weakest: "Le plus faible (talent min.)",
  closest: "Le plus proche de mon talent",
  strongest: "Le plus fort (talent max.)",
  random: "Aléatoire",
};
</script>

<template>
  <section class="row">
    <h1>Lancer des combats</h1>
    <span class="spacer"></span>
    <span class="secondary">Combats restants<template v-if="currentAccount"> ({{ currentAccount.name }})</template> : <b class="mono">{{ fightsLeft }}</b></span>
  </section>

  <div class="tabs">
    <button :class="{ on: mode === 'solo' }" @click="mode = 'solo'">Solo</button>
    <button :class="{ on: mode === 'farmer' }" @click="mode = 'farmer'">Éleveur</button>
    <button :class="{ on: mode === 'challenge' }" @click="mode = 'challenge'">Défi</button>
  </div>

  <div v-if="error" class="error">{{ error }}</div>

  <section class="card">
    <div class="row form">
      <label v-if="mode === 'farmer' && accounts.length > 1" class="field">
        Compte
        <select :value="farmerAccountId ?? state.status?.farmer.id" @change="farmerAccountId = Number(($event.target as HTMLSelectElement).value); loadOpponents()">
          <option v-for="a in accounts" :key="a.id" :value="a.id">{{ a.name }}{{ a.garden ? ` (⚔ ${a.garden.fights})` : "" }}</option>
        </select>
      </label>
      <label v-if="mode !== 'farmer'" class="field">
        Poireau
        <select v-model.number="leekId">
          <option v-for="l in ownLeeks" :key="l.id" :value="l.id">{{ l.name }} (niv. {{ l.level }}, talent {{ l.talent }}){{ accounts.length > 1 ? ` · ${l.accountName}` : "" }}</option>
        </select>
      </label>

      <template v-if="mode !== 'challenge'">
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
        <label class="row small secondary check">
          <input type="checkbox" v-model="batch" /> Lot API Leek Wars (adversaires choisis par le serveur, plus rapide)
        </label>
        <span class="spacer"></span>
        <button class="primary" :disabled="busy || !fightsLeft || count < 1 || count > fightsLeft" @click="launch()">
          Lancer {{ count }} combat{{ count > 1 ? "s" : "" }}
        </button>
      </template>

      <template v-else>
        <label class="field">ID du poireau adverse<input v-model="challenge.targetId" placeholder="ex. 134873" style="width: 130px" /></label>
        <label class="field">Seed (0 = aléatoire)<input v-model="challenge.seed" type="number" style="width: 120px" /></label>
        <label class="field">
          Côté
          <select v-model="challenge.side"><option value="random">aléatoire</option><option value="left">gauche</option><option value="right">droite</option></select>
        </label>
        <label class="field">Nombre<input v-model.number="challenge.count" type="number" min="1" max="50" style="width: 80px" /></label>
        <span class="spacer"></span>
        <button class="primary" :disabled="busy || !challenge.targetId || !leekId" @click="launch()">Lancer le défi</button>
      </template>
    </div>
    <p v-if="mode === 'challenge'" class="small muted">
      Un défi oppose votre poireau à un poireau précis. Avec un seed fixe, le combat est reproductible : pratique pour tester une
      modification d'IA sur exactement la même situation.
    </p>
  </section>

  <section v-if="lastJob" class="card">
    <h2>Dernier lancement</h2>
    <div class="small muted" style="margin-bottom: 8px">{{ lastJob.progress.done }}/{{ lastJob.progress.total }} terminé(s) · {{ lastJob.error ?? lastJob.lastLog }}</div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Combat</th><th>Adversaire</th><th class="num">Tours</th><th>Résultat</th></tr></thead>
        <tbody>
          <tr v-for="f in lastJob.fights" :key="f.id">
            <td><a :href="'#/fight/' + f.id">#{{ f.id }}</a></td>
            <td>{{ f.opponent?.name ?? "?" }} <span class="muted small" v-if="f.opponent?.talent">talent {{ f.opponent.talent }}</span></td>
            <td class="num">{{ f.turns ?? "–" }}</td>
            <td><ResultBadge :result="f.result" /></td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>

  <section v-if="mode !== 'challenge'" class="card">
    <div class="row" style="margin-bottom: 8px">
      <h2>Adversaires proposés</h2>
      <span class="spacer"></span>
      <button :disabled="loadingOpp" @click="loadOpponents">{{ loadingOpp ? "Chargement…" : "Nouvelle liste" }}</button>
    </div>
    <div class="table-wrap" v-if="opponents.length">
      <table>
        <thead>
          <tr>
            <th>Nom</th>
            <th v-if="mode === 'solo'" class="num">Niveau</th>
            <th v-else class="num">Niveau total</th>
            <th class="num">Talent</th>
            <th v-if="mode === 'solo'" class="num">Bilan local</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="o in opponents" :key="o.id">
            <td class="leek-cell"><LeekImage v-if="mode === 'solo'" :leek="o" head :size="36" /><span class="display">{{ o.name }}</span> <span class="muted small">#{{ o.id }}</span></td>
            <td class="num">{{ o.level ?? o.total_level }}</td>
            <td class="num">{{ o.talent }}</td>
            <td v-if="mode === 'solo'" class="num">
              <template v-if="o.record?.fights">{{ o.record.wins }}V {{ o.record.losses }}D · {{ fmtPct((100 * o.record.wins) / o.record.fights) }}</template>
              <span v-else class="muted">jamais affronté</span>
            </td>
            <td class="num">
              <button v-if="mode === 'solo' && !o.tracked" class="ghost small" @click="follow(o)" title="Suivre ce poireau pour l'analyser">+ Suivre</button>
              <button v-if="mode === 'solo'" class="ghost small" @click="challenge.targetId = String(o.id); mode = 'challenge'">Défi</button>
              <button :disabled="busy || !fightsLeft" @click="launch(o.id)">Combattre</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <div v-else-if="!loadingOpp" class="empty">Aucun adversaire disponible.</div>
  </section>
</template>

<style scoped>
.tabs { display: flex; gap: 4px; }
.tabs button { }
.tabs button.on { background: var(--surface-3); border-color: var(--text-muted); }
.form { align-items: flex-end; gap: 14px; }
.check { gap: 6px; padding-bottom: 6px; }
</style>
