<script setup lang="ts">
// Arène : salle d'attente de chacun de mes comptes ; l'inscription est renouvelée par le serveur local
// (elle expire sinon) jusqu'à ce que l'arène parte ou que l'on quitte la salle.
import { onUnmounted, ref } from "vue";
import { api } from "../api";
import { state } from "../state";
import LeekImage from "./LeekImage.vue";

interface Arena {
  accountId: number; accountName: string; error?: string;
  registered?: boolean; count?: number; countdown?: number; minPlayers?: number; maxPlayers?: number; minLevel?: number;
  leeks?: { id: number; name: string; level: number; talent: number; preference: number; skin?: number; hat?: number | null }[];
  keepAlive?: { leekId: number; leekName: string; preference: number; since: number } | null;
}

const arenas = ref<Arena[] | null>(null);
const choice = ref<Record<number, { leekId: number | null; preference: number }>>({});
const busy = ref(false);
const error = ref("");

const PREFERENCES: Record<number, string> = { [-1]: "Suivre les autres inscrits", [-2]: "Tous les modes à égalité", 0: "Battle Royale", 1: "Guerre", 2: "Chasse au trésor", 3: "Colosse" };
const leeksOf = (accountId: number) => (state.status?.leeks ?? []).filter((l) => l.owned && l.accountId === accountId && l.level >= 20);

async function load() {
  try {
    arenas.value = (await api.get("/api/arena")).arenas as Arena[];
    for (const a of arenas.value) choice.value[a.accountId] ??= { leekId: leeksOf(a.accountId)[0]?.id ?? null, preference: -1 };
    error.value = "";
  } catch (e: any) {
    error.value = e.message;
  }
}
load();
// La salle évolue (inscrits, décompte) : rafraîchie toutes les 20 s tant que la page est ouverte.
const timer = window.setInterval(load, 20_000);
onUnmounted(() => clearInterval(timer));

async function act(fn: () => Promise<unknown>) {
  busy.value = true;
  error.value = "";
  try {
    await fn();
    await load();
  } catch (e: any) {
    error.value = e.message;
  } finally {
    busy.value = false;
  }
}
const register = (a: Arena) => act(() => api.post("/api/arena/register", { ...choice.value[a.accountId], keep: true }));
const leave = (a: Arena) => act(() => api.post("/api/arena/leave", { accountId: a.accountId }));
</script>

<template>
  <div v-if="error" class="error">{{ error }}</div>
  <div v-if="!arenas" class="card muted small">Chargement des salles d'attente…</div>
  <section v-for="a in arenas ?? []" :key="a.accountId" class="card">
    <div class="row" style="margin-bottom: 8px">
      <h2>Arène · {{ a.accountName }}</h2>
      <span class="spacer"></span>
      <span v-if="!a.error" class="secondary">
        {{ a.count }} inscrit(s) · départ à {{ a.minPlayers }} (max. {{ a.maxPlayers }})
        <template v-if="(a.countdown ?? -1) >= 0"> · départ dans {{ a.countdown }} s</template>
      </span>
    </div>
    <div v-if="a.error" class="error">{{ a.error }}</div>
    <template v-else>
      <div v-if="a.registered || a.keepAlive" class="card ok">
        ✓ Inscrit<template v-if="a.keepAlive"> avec <b>{{ a.keepAlive.leekName }}</b> ({{ PREFERENCES[a.keepAlive.preference] }}) · inscription renouvelée automatiquement</template>
        <button class="danger" :disabled="busy" style="margin-left: 12px" @click="leave(a)">Quitter la salle</button>
      </div>
      <div v-else class="row form">
        <label class="field">
          Poireau (niveau {{ a.minLevel }}+)
          <select v-model.number="choice[a.accountId].leekId">
            <option v-for="l in leeksOf(a.accountId)" :key="l.id" :value="l.id">{{ l.name }} (niv. {{ l.level }})</option>
          </select>
        </label>
        <label class="field">
          Mode préféré
          <select v-model.number="choice[a.accountId].preference">
            <option v-for="(label, k) in PREFERENCES" :key="k" :value="Number(k)">{{ label }}</option>
          </select>
        </label>
        <span class="spacer"></span>
        <button class="primary" :disabled="busy || !choice[a.accountId]?.leekId" @click="register(a)">S'inscrire</button>
      </div>
      <div v-if="a.leeks?.length" class="waiting">
        <span v-for="l in a.leeks" :key="l.id" class="tag">
          <LeekImage :leek="l" head :size="20" /> {{ l.name }} <span class="muted">niv. {{ l.level }}</span>
        </span>
      </div>
    </template>
  </section>
  <p class="small muted">
    Les arènes (Battle Royale, guerre, chasse au trésor, colosse) partent quand assez de joueurs attendent. Leek Wars fait
    expirer l'inscription : LeekWars Local la renouvelle tant que le serveur tourne, pendant 3 h au plus.
    <a href="#/fights?type=3,5,6,7">Voir mes combats d'arène →</a>
  </p>
</template>

<style scoped>
.form { align-items: flex-end; gap: 14px; }
.ok { border-color: var(--good); color: var(--good); display: flex; align-items: center; flex-wrap: wrap; }
.waiting { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
.waiting .tag { display: inline-flex; align-items: center; gap: 4px; }
</style>
