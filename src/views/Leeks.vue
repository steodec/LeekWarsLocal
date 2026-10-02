<script setup lang="ts">
import { ref, watch } from "vue";
import { api } from "../api";
import { state, refreshStatus, selectLeek, trackJob, go } from "../state";
import { fmtNum } from "../format";
import LeekImage from "../components/LeekImage.vue";

interface LeekRow {
  id: number; name: string; level: number; talent: number; ai: string | null; capital: number | null;
  storedFights: number; owned: boolean; farmerName?: string | null;
  skin?: number; hat?: number | null; hatItem?: number | null; metal?: boolean; face?: number;
}

const tracked = ref<LeekRow[]>([]);
const available = ref<LeekRow[]>([]);
const error = ref("");
const info = ref("");
const busy = ref(false);
const newId = ref("");
const removing = ref<LeekRow | null>(null);
const purge = ref(false);

async function load() {
  try {
    const res = await api.get("/api/leeks");
    tracked.value = res.tracked;
    available.value = res.available;
    error.value = "";
  } catch (e: any) {
    error.value = e.message;
  }
}
watch(() => state.dataVersion, load, { immediate: true });

async function run(fn: () => Promise<unknown>) {
  busy.value = true;
  error.value = "";
  info.value = "";
  try {
    await fn();
    await Promise.all([load(), refreshStatus()]);
  } catch (e: any) {
    error.value = e.message;
  } finally {
    busy.value = false;
  }
}

const add = (id: number | string) =>
  run(async () => {
    const res = await api.post("/api/leeks/tracked", { id });
    if (res.job) trackJob(res.job);
    info.value =
      `${res.leek.name} est suivi${res.leek.owned ? "" : ` pour analyse (éleveur ${res.leek.farmerName})`}. ` +
      `${res.indexed} combat(s) déjà stocké(s) analysé(s) ; import de son historique en cours…`;
    newId.value = "";
  });

const confirmRemove = () =>
  run(async () => {
    const l = removing.value!;
    const res = await api.del(`/api/leeks/tracked/${l.id}${purge.value ? "?purge=1" : ""}`);
    info.value = `${l.name} n'est plus suivi` + (purge.value ? ` (${res.purged} combat(s) supprimé(s) de la base).` : ".");
    if (state.leekId === l.id) selectLeek(null);
    removing.value = null;
    purge.value = false;
    state.dataVersion++;
  });

const move = (i: number, dir: -1 | 1) =>
  run(async () => {
    const ids = tracked.value.map((l) => l.id);
    const j = i + dir;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    await api.put("/api/leeks/tracked", { ids });
  });
</script>

<template>
  <section class="row">
    <h1>Poireaux</h1>
    <span class="muted" v-if="state.status">compte {{ state.status.farmer.name }}</span>
  </section>

  <div v-if="error" class="error">{{ error }}</div>
  <div v-if="info" class="card ok">✓ {{ info }}</div>

  <section class="card">
    <h2>Ajouter un poireau</h2>
    <div class="row">
      <input v-model="newId" placeholder="ID ou lien leekwars.com/leek/…" style="width: 300px" @keyup.enter="newId && add(newId)" />
      <button class="primary" :disabled="busy || !newId" @click="add(newId)">Suivre</button>
      <span class="small muted">N'importe quel poireau : un des vôtres, ou un adversaire / un joueur à étudier (analyse uniquement).</span>
    </div>
    <template v-if="available.length">
      <h3 style="margin: 16px 0 8px">Poireaux de vos comptes non suivis</h3>
      <div class="avail">
        <div v-for="l in available" :key="l.id" class="leek">
          <LeekImage :leek="l" :size="64" />
          <div class="grow">
            <b>{{ l.name }}</b> <span class="muted small">#{{ l.id }}</span>
            <div class="small secondary">niv. {{ l.level }} · talent {{ l.talent }}{{ (l as any).accountName ? ` · ${(l as any).accountName}` : "" }}</div>
          </div>
          <button :disabled="busy" @click="add(l.id)">Suivre</button>
        </div>
      </div>
    </template>
  </section>

  <section class="card">
    <h2>Poireaux suivis</h2>
    <p class="small muted" style="margin-top: -6px">
      Les vôtres peuvent être lancés en combat et recevoir du capital ; les autres servent à l'analyse (historique, stats, builds).
      L'ordre est celui du sélecteur.
    </p>
    <div class="table-wrap" v-if="tracked.length">
      <table>
        <thead>
          <tr><th>Ordre</th><th>Poireau</th><th>Éleveur</th><th class="num">Niveau</th><th class="num">Talent</th><th class="num">Capital</th><th class="num">Combats stockés</th><th></th></tr>
        </thead>
        <tbody>
          <tr v-for="(l, i) in tracked" :key="l.id">
            <td class="order">
              <button class="ghost" :disabled="busy || i === 0" @click="move(i, -1)" aria-label="Monter">▲</button>
              <button class="ghost" :disabled="busy || i === tracked.length - 1" @click="move(i, 1)" aria-label="Descendre">▼</button>
            </td>
            <td class="leek-cell">
              <LeekImage :leek="l" head :size="40" />
              <a :href="`https://leekwars.com/leek/${l.id}`" target="_blank" rel="noopener" class="display">{{ l.name }}</a>
              <span class="muted small"> #{{ l.id }}</span>
              <span class="tag" :class="l.owned ? 'own' : 'ext'">{{ l.owned ? "à moi" : "analyse" }}</span>
            </td>
            <td class="secondary">{{ l.owned ? (l as any).accountName : l.farmerName ?? "?" }}</td>
            <td class="num">{{ l.level }}</td>
            <td class="num">{{ l.talent }}</td>
            <td class="num" :class="{ cap: (l.capital ?? 0) > 0 }">{{ l.owned ? l.capital : "–" }}</td>
            <td class="num">{{ fmtNum(l.storedFights) }}</td>
            <td class="num actions">
              <button class="ghost" @click="selectLeek(l.id); go('#/')">Ouvrir</button>
              <button v-if="l.owned && (l.capital ?? 0) > 0" class="ghost" @click="selectLeek(l.id); go('#/characteristics')">Répartir</button>
              <button class="danger" :disabled="busy" @click="removing = l; purge = false">Retirer</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <div v-else class="empty">Aucun poireau suivi. Ajoutez-en un ci-dessus.</div>

    <div v-if="removing" class="confirm">
      <div>
        Ne plus suivre <b>{{ removing.name }}</b> ? Rien n'est supprimé sur Leek Wars.
        <label class="row small secondary" style="gap: 6px; margin-top: 6px">
          <input type="checkbox" v-model="purge" /> Supprimer aussi de la base ses combats qui ne concernent aucun autre poireau suivi ni mon compte
        </label>
      </div>
      <span class="spacer"></span>
      <button @click="removing = null">Annuler</button>
      <button class="primary" :disabled="busy" @click="confirmRemove">Retirer</button>
    </div>
  </section>
</template>

<style scoped>
.order { white-space: nowrap; }
.order button { padding: 2px 6px; }
.actions { white-space: nowrap; }
.cap { color: var(--warning); font-weight: 600; }
.tag { margin-left: 6px; }
.tag.own { color: var(--accent); }
.tag.ext { color: var(--series-me); }
.avail { display: grid; gap: 8px; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); }
.leek { display: flex; align-items: center; gap: 12px; padding: 10px 12px; border: 1px solid var(--border-strong); background: var(--surface-2); }
.leek .grow { flex: 1; }
.confirm { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-top: 12px; padding: 12px; border: 1px solid var(--warning); background: color-mix(in srgb, var(--warning) 8%, transparent); }
.ok { border-color: var(--good); color: var(--good); }
</style>
