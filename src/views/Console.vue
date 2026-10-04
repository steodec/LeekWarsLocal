<script setup lang="ts">
// Console multi-comptes : tous mes comptes d'un coup d'œil, et les combats restants dépensés en un clic.
import { computed, ref, watch } from "vue";
import { api } from "../api";
import { state, trackJob, switchAccount } from "../state";
import { fmtNum } from "../format";
import LeekImage from "../components/LeekImage.vue";

interface PlanLeek { leekId: number; name: string; level: number; count: number; cap: number }
interface ConsoleAccount {
  id: number; name: string; error?: string; active?: boolean; talent?: number; lwplus?: boolean;
  garden?: { fights: number; maxFights: number; teamFights: number; maxTeamFights: number; brFights: number; maxBrFights: number; maxSoloPerLeek: number | null };
  tournamentRegistered?: boolean;
  leeks?: { id: number; name: string; level: number; talent: number; skin?: number; hat?: number | null; metal?: boolean; face?: number; ai: string | null }[];
  today?: { fights: number; wins: number; losses: number };
  plan?: { leeks: PlanLeek[]; unassigned: number };
}

const accounts = ref<ConsoleAccount[]>([]);
const selected = ref<Record<number, boolean>>({});
const strategy = ref("weakest");
const withFarmer = ref(true);
const confirming = ref(false);
const busy = ref(false);
const error = ref("");
const info = ref("");

async function load() {
  try {
    accounts.value = (await api.get("/api/console")).accounts;
    for (const a of accounts.value) selected.value[a.id] ??= !a.error && (a.garden?.fights ?? 0) > 0;
    error.value = "";
  } catch (e: any) {
    error.value = e.message;
  }
}
load();
watch(() => state.dataVersion, load);

const chosen = computed(() => accounts.value.filter((a) => selected.value[a.id] && !a.error));
const totals = computed(() => {
  let solo = 0;
  let farmer = 0;
  for (const a of chosen.value) {
    solo += a.plan?.leeks.reduce((s, p) => s + p.count, 0) ?? 0;
    if (withFarmer.value) farmer += a.plan?.unassigned ?? 0;
  }
  return { solo, farmer, all: solo + farmer };
});

async function spend() {
  busy.value = true;
  error.value = "";
  try {
    const { jobs } = await api.post("/api/console/spend", { accountIds: chosen.value.map((a) => a.id), strategy: strategy.value, farmer: withFarmer.value });
    jobs.forEach(trackJob);
    info.value = `${jobs.length} lancement(s) en cours : suivez-les dans le panneau des tâches.`;
    confirming.value = false;
  } catch (e: any) {
    error.value = e.message;
  } finally {
    busy.value = false;
  }
}

const STRATS: Record<string, string> = { weakest: "Le plus faible", closest: "Le plus proche en talent", strongest: "Le plus fort", random: "Aléatoire" };
</script>

<template>
  <section class="row">
    <h1>Comptes</h1>
    <span class="spacer"></span>
    <button @click="load">Actualiser</button>
  </section>

  <div v-if="error" class="error">{{ error }}</div>
  <div v-if="info" class="card ok">✓ {{ info }}</div>

  <section class="grid cols-2">
    <div v-for="a in accounts" :key="a.id" class="card account" :class="{ active: a.active }">
      <div class="row">
        <label class="row" style="gap: 6px"><input type="checkbox" v-model="selected[a.id]" :disabled="!!a.error" /> <h2 style="margin: 0">{{ a.name }}</h2></label>
        <span v-if="a.active" class="tag act">actif</span>
        <span v-if="a.lwplus" class="tag">LW+</span>
        <span class="spacer"></span>
        <button v-if="!a.active && !a.error" class="ghost small" @click="switchAccount(a.id).then(load)">Rendre actif</button>
      </div>
      <div v-if="a.error" class="error">{{ a.error }}</div>
      <template v-else>
        <div class="counters">
          <div><span class="muted small">Combats</span><b class="mono">{{ a.garden!.fights }}/{{ a.garden!.maxFights }}</b></div>
          <div><span class="muted small">Équipe</span><b class="mono">{{ a.garden!.teamFights }}/{{ a.garden!.maxTeamFights }}</b></div>
          <div><span class="muted small">Battle Royale</span><b class="mono">{{ a.garden!.brFights }}/{{ a.garden!.maxBrFights }}</b></div>
          <div><span class="muted small">Talent</span><b class="mono">{{ fmtNum(a.talent) }}</b></div>
          <div><span class="muted small">Aujourd'hui</span><b class="mono">{{ a.today!.wins }}V {{ a.today!.losses }}D</b></div>
        </div>
        <div class="small secondary">Tournoi éleveur : {{ a.tournamentRegistered ? "inscrit" : "non inscrit" }}</div>
        <table class="leeks">
          <tbody>
            <tr v-for="l in a.leeks" :key="l.id">
              <td class="leek-cell"><LeekImage :leek="l" head :size="26" /> {{ l.name }}</td>
              <td class="num muted small">niv. {{ l.level }}</td>
              <td class="num muted small">talent {{ l.talent }}</td>
              <td class="num small">
                <template v-if="a.plan?.leeks.find((p) => p.leekId === l.id)?.count">→ {{ a.plan?.leeks.find((p) => p.leekId === l.id)?.count }} combat(s)</template>
                <span v-else class="muted">plafond atteint</span>
              </td>
            </tr>
          </tbody>
        </table>
        <div v-if="a.plan?.unassigned" class="small muted">
          {{ a.plan.unassigned }} combat(s) au-delà du plafond solo ({{ a.garden!.maxSoloPerLeek }} par poireau){{ withFarmer ? " : joués en combats éleveur" : " : non dépensés" }}.
        </div>
      </template>
    </div>
  </section>

  <section class="card">
    <h2>Dépenser les combats restants</h2>
    <div class="row form">
      <label class="field">
        Choix des adversaires
        <select v-model="strategy"><option v-for="(label, k) in STRATS" :key="k" :value="k">{{ label }}</option></select>
      </label>
      <label class="row small secondary check"><input type="checkbox" v-model="withFarmer" /> Jouer le reste en combats éleveur</label>
      <span class="spacer"></span>
      <button class="primary" :disabled="busy || !totals.all" @click="confirming = true">Dépenser {{ totals.all }} combat(s)…</button>
    </div>
    <div v-if="confirming" class="confirm">
      <div>
        Lancer <b>{{ totals.solo }}</b> combat(s) solo<template v-if="totals.farmer"> et <b>{{ totals.farmer }}</b> combat(s) éleveur</template>
        sur {{ chosen.map((a) => a.name).join(", ") }} ? Les combats du jour seront consommés.
      </div>
      <span class="spacer"></span>
      <button @click="confirming = false">Annuler</button>
      <button class="primary" :disabled="busy" @click="spend">{{ busy ? "Lancement…" : "Confirmer" }}</button>
    </div>
    <p class="small muted">
      Les combats solo sont répartis à tour de rôle entre les poireaux de chaque compte, dans la limite de Leek Wars par poireau.
      Chaque lancement apparaît dans le panneau des tâches ; les combats sont importés à la fin.
    </p>
  </section>
</template>

<style scoped>
.account.active { border-color: var(--accent); }
.tag.act { color: var(--accent); }
.counters { display: flex; flex-wrap: wrap; gap: 6px 18px; margin: 10px 0 6px; }
.counters div { display: flex; flex-direction: column; }
.counters b { font-family: var(--font-display); font-size: 18px; }
.leeks { margin-top: 8px; width: 100%; }
.leeks td { padding: 3px 6px; }
.form { align-items: flex-end; gap: 14px; }
.check { gap: 6px; padding-bottom: 6px; }
.ok { border-color: var(--good); color: var(--good); }
.confirm { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-top: 10px; padding: 10px; border: 1px solid var(--warning); background: color-mix(in srgb, var(--warning) 8%, transparent); }
</style>
