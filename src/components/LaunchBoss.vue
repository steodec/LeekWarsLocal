<script setup lang="ts">
// Combats de boss : jusqu'à 8 de mes poireaux (même compte) contre un boss, et classement des boss au nombre de tours.
import { computed, ref, watch } from "vue";
import { api } from "../api";
import { state, trackJob, type Job } from "../state";

interface Boss {
  id: number; name: string; label: string; level: number;
  top: { rank: number; farmer: string; turns: number; leeks: number; levels: number[]; fight: number }[];
}
const emit = defineEmits<{ launched: [job: Job] }>();

const bosses = ref<Boss[]>([]);
const bossId = ref<number | null>(null);
const accountId = ref<number | null>(state.status?.farmer.id ?? null);
const picked = ref<number[]>([]);
const count = ref(1);
const batch = ref(false);
const busy = ref(false);
const error = ref("");

const accounts = computed(() => state.status?.accounts ?? []);
const account = computed(() => accounts.value.find((a) => a.id === accountId.value) ?? accounts.value[0] ?? null);
const leeks = computed(() => (state.status?.leeks ?? []).filter((l) => l.owned && l.accountId === account.value?.id));
const fightsLeft = computed(() => account.value?.garden?.fights ?? 0);
const boss = computed(() => bosses.value.find((b) => b.id === bossId.value) ?? null);
watch(account, () => (picked.value = leeks.value.map((l) => l.id).slice(0, 8)), { immediate: true });

async function load() {
  try {
    bosses.value = (await api.get("/api/bosses")).bosses;
    bossId.value ??= bosses.value[0]?.id ?? null;
  } catch (e: any) {
    error.value = e.message;
  }
}
load();

function toggle(id: number) {
  picked.value = picked.value.includes(id) ? picked.value.filter((x) => x !== id) : picked.value.length < 8 ? [...picked.value, id] : picked.value;
}

async function launch() {
  busy.value = true;
  error.value = "";
  try {
    const job: Job = await api.post("/api/fights/boss", { bossId: bossId.value, leekIds: picked.value, count: count.value, batch: batch.value });
    trackJob(job);
    emit("launched", job);
  } catch (e: any) {
    error.value = e.message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div v-if="error" class="error">{{ error }}</div>
  <section class="grid cols-3 bosses">
    <button v-for="b in bosses" :key="b.id" class="card boss" :class="{ on: b.id === bossId }" @click="bossId = b.id">
      <div class="display name">{{ b.label }}</div>
      <div class="secondary small">niveau {{ b.level }}</div>
      <div v-if="b.top[0]" class="small muted">Record : {{ b.top[0].turns }} tour(s), {{ b.top[0].farmer }}</div>
    </button>
  </section>

  <section class="card">
    <div class="row form">
      <label v-if="accounts.length > 1" class="field">
        Compte
        <select :value="account?.id" @change="accountId = Number(($event.target as HTMLSelectElement).value)">
          <option v-for="a in accounts" :key="a.id" :value="a.id">{{ a.name }}{{ a.garden ? ` (⚔ ${a.garden.fights})` : "" }}</option>
        </select>
      </label>
      <label class="field">
        Nombre de combats
        <input type="number" v-model.number="count" min="1" :max="Math.max(1, fightsLeft)" style="width: 90px" />
      </label>
      <label class="row small secondary check"><input type="checkbox" v-model="batch" /> Lot API (Leek Wars+)</label>
      <span class="spacer"></span>
      <button class="primary" :disabled="busy || !boss || !picked.length || !fightsLeft || count < 1 || count > fightsLeft" @click="launch">
        Attaquer {{ boss?.label ?? "le boss" }} ({{ count }} combat{{ count > 1 ? "s" : "" }})
      </button>
    </div>
    <div class="leeks">
      <label v-for="l in leeks" :key="l.id" class="leek-pick">
        <input type="checkbox" :checked="picked.includes(l.id)" :disabled="!picked.includes(l.id) && picked.length >= 8" @change="toggle(l.id)" />
        {{ l.name }} <span class="muted small">niv. {{ l.level }}</span>
      </label>
      <span v-if="!leeks.length" class="muted small">Aucun poireau sur ce compte.</span>
    </div>
    <p class="small muted">
      Jusqu'à 8 poireaux d'un même compte par combat ; chaque combat de boss consomme un combat du jour.
      <a href="#/fights?type=4">Voir mes combats de boss →</a>
    </p>
  </section>

  <section v-if="boss?.top.length" class="card">
    <h2>Meilleurs temps contre {{ boss.label }}</h2>
    <div class="table-wrap">
      <table>
        <thead><tr><th class="num">Rang</th><th>Éleveur</th><th class="num">Tours</th><th class="num">Poireaux</th><th>Niveaux</th><th></th></tr></thead>
        <tbody>
          <tr v-for="r in boss.top" :key="r.rank">
            <td class="num">{{ r.rank }}</td>
            <td>{{ r.farmer }}</td>
            <td class="num">{{ r.turns }}</td>
            <td class="num">{{ r.leeks }}</td>
            <td class="small muted">{{ r.levels.join(", ") }}</td>
            <td class="num"><a :href="'#/fight/' + r.fight">combat →</a></td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<style scoped>
.bosses { gap: 12px; }
.boss { text-align: left; cursor: pointer; display: flex; flex-direction: column; gap: 2px; }
.boss .name { font-size: 18px; text-transform: capitalize; }
.boss.on { border-color: var(--accent); box-shadow: inset 0 -3px 0 var(--accent-surface); }
.form { align-items: flex-end; gap: 14px; }
.check { gap: 6px; padding-bottom: 6px; }
.leeks { display: flex; flex-wrap: wrap; gap: 6px 16px; margin-top: 12px; }
.leek-pick { display: inline-flex; align-items: center; gap: 6px; }
</style>
