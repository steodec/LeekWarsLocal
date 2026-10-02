<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { api, qs } from "../api";
import { state, refreshStatus } from "../state";
import { fmtDate, fmtNum, fmtPct } from "../format";
import StatTile from "../components/StatTile.vue";
import { characIcon } from "../lw";

interface Stat {
  base: number; added: number; equipment: number; current: number; total: number; capitalInvested: number;
  bonus: number; bonusCost: number; bonusValid: boolean; after: number;
  next: { sup: number; capital: number } | null; prev: { sup: number; capital: number } | null;
}
interface View { owned: boolean; leekId: number; name: string; level: number; capital: number; totalCapital: number; planned: number; remaining: number; valid: boolean; stats: Record<string, Stat> }

const LABELS: Record<string, string> = {
  life: "Vie", strength: "Force", wisdom: "Sagesse", agility: "Agilité", resistance: "Résistance", science: "Science",
  magic: "Magie", frequency: "Fréquence", cores: "Cœurs", ram: "RAM", tp: "PT", mp: "PM",
};
const HINTS: Record<string, string> = {
  life: "Points de vie", strength: "Dégâts des armes et puces offensives", wisdom: "Soins et vol de vie", agility: "Coups critiques et renvoi de dégâts",
  resistance: "Boucliers", science: "Effets temporaires (boosts, poisons…)", magic: "Poisons et malus", frequency: "Ordre de jeu",
  cores: "Opérations par tour de l'IA", ram: "Mémoire de l'IA", tp: "Points de tour (actions)", mp: "Points de mouvement",
};

const view = ref<View | null>(null);
const bonuses = reactive<Record<string, number>>({});
const error = ref("");
const busy = ref(false);
const confirming = ref(false);
const done = ref("");
const builds = ref<any[]>([]);

async function load() {
  if (!state.leekId) return;
  error.value = "";
  for (const k of Object.keys(bonuses)) delete bonuses[k];
  try {
    view.value = await api.get(`/api/leeks/${state.leekId}/characteristics`);
    const s = await api.get(`/api/stats${qs({ leek: state.leekId })}`);
    builds.value = s.byBuild ?? [];
  } catch (e: any) {
    error.value = e.message;
  }
}
watch(() => [state.leekId, state.dataVersion], load, { immediate: true });

let timer: number | undefined;
function preview() {
  clearTimeout(timer);
  timer = window.setTimeout(async () => {
    try {
      view.value = await api.post(`/api/leeks/${state.leekId}/characteristics/preview`, { bonuses: { ...bonuses } });
    } catch (e: any) {
      error.value = e.message;
    }
  }, 120);
}

// Applique un achat (ou un retrait) au palier courant, puis le serveur recalcule coûts et paliers suivants.
function step(c: string, dir: 1 | -1) {
  const s = view.value?.stats[c];
  if (!s) return;
  const cur = bonuses[c] ?? 0;
  if (dir === 1) {
    if (!s.next) return;
    bonuses[c] = cur + s.next.sup;
  } else {
    if (!cur) return;
    bonuses[c] = Math.max(0, cur - (s.prev?.sup ?? 1));
  }
  confirming.value = false;
  preview();
}

function reset() {
  for (const k of Object.keys(bonuses)) delete bonuses[k];
  confirming.value = false;
  preview();
}

const changes = computed(() => Object.entries(view.value?.stats ?? {}).filter(([, s]) => s.bonus > 0));
const canAdd = (c: string) => {
  const s = view.value?.stats[c];
  return !!view.value?.owned && !!s?.next && (view.value?.remaining ?? 0) >= s.next.capital;
};

async function validate() {
  busy.value = true;
  error.value = "";
  try {
    const res = await api.post(`/api/leeks/${state.leekId}/characteristics`, { bonuses: { ...bonuses } });
    done.value = `${res.spent} capital dépensé : ` + Object.entries(res.bonuses).map(([k, v]) => `${LABELS[k]} +${v}`).join(", ");
    for (const k of Object.keys(bonuses)) delete bonuses[k];
    view.value = res.after;
    confirming.value = false;
    refreshStatus();
  } catch (e: any) {
    error.value = e.message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <section class="row">
    <h1>Caractéristiques</h1>
    <span v-if="view" class="muted">{{ view.name }} · niv. {{ view.level }}</span>
  </section>

  <div v-if="!state.leekId" class="empty">Choisissez un poireau en haut à droite.</div>
  <div v-if="error" class="error">{{ error }}</div>
  <div v-if="done" class="card ok">✓ {{ done }}</div>

  <template v-if="view">
    <div v-if="!view.owned" class="card small secondary">
      Poireau suivi pour analyse : caractéristiques en lecture seule (profil public, sans répartition du capital).
    </div>
    <section v-if="view.owned" class="tiles">
      <StatTile label="Capital disponible" :value="view.capital" :hint="`${view.totalCapital} gagnés au niveau ${view.level}`" />
      <StatTile label="Capital prévu" :value="view.planned" :hint="view.valid ? 'répartition valide' : 'répartition impossible'" />
      <StatTile label="Capital restant" :value="view.remaining" />
    </section>

    <section class="card">
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Caractéristique</th>
              <th class="num">Base</th>
              <th class="num">Capital investi</th>
              <th class="num">Équipement</th>
              <th class="num">Total actuel</th>
              <template v-if="view.owned">
                <th class="num">Ajout prévu</th>
                <th class="num">Après</th>
                <th class="num">Prochain achat</th>
              </template>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(s, c) in view.stats" :key="c" :class="{ planned: s.bonus > 0 }">
              <td>
                <div class="charac">
                <img class="charac-icon" :src="characIcon(c as string)" alt="" />
                <div>
                  <strong class="display" :style="{ color: `var(--stat-${c})` }">{{ LABELS[c] ?? c }}</strong>
                  <div class="small muted">{{ HINTS[c] }}</div>
                </div>
                </div>
              </td>
              <td class="num">{{ fmtNum(s.base) }}</td>
              <td class="num">+{{ fmtNum(s.added) }} <span class="muted small">({{ s.capitalInvested }} cap.)</span></td>
              <td class="num">{{ s.equipment ? "+" + fmtNum(s.equipment) : "–" }}</td>
              <td class="num"><b class="display total" :style="{ color: `var(--stat-${c})` }">{{ fmtNum(s.total) }}</b></td>
              <template v-if="view.owned">
              <td class="num">
                <div class="stepper">
                  <button :disabled="!s.bonus" @click="step(c as string, -1)" :aria-label="'Retirer ' + LABELS[c]">−</button>
                  <span class="mono" :class="{ bad: !s.bonusValid }">{{ s.bonus ? "+" + s.bonus : "0" }}</span>
                  <button :disabled="!canAdd(c as string)" @click="step(c as string, 1)" :aria-label="'Ajouter ' + LABELS[c]">+</button>
                </div>
                <div v-if="s.bonusCost" class="small muted">{{ s.bonusCost }} capital</div>
              </td>
              <td class="num" :class="{ up: s.bonus > 0 }">{{ fmtNum(s.after) }}</td>
              <td class="num small secondary">
                <template v-if="s.next">+{{ s.next.sup }} pour {{ s.next.capital }} cap.</template>
                <template v-else>maximum</template>
              </td>
              </template>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-if="view.owned" class="row actions">
        <span class="small muted">Les points s'achètent par paliers (ex. Force : +2 par capital jusqu'à 200 ajoutés, puis +1, puis 2 capital pour +1 au-delà de 400).</span>
        <span class="spacer"></span>
        <button :disabled="!changes.length" @click="reset">Réinitialiser</button>
        <button v-if="!confirming" class="primary" :disabled="!changes.length || !view.valid" @click="confirming = true">Valider la répartition</button>
      </div>
      <div v-if="confirming && view.owned" class="confirm">
        <div>
          Dépenser <b>{{ view.planned }} capital</b> sur {{ view.name }} :
          <span v-for="([c, s], i) in changes" :key="c">{{ i ? ", " : "" }}{{ LABELS[c] }} +{{ s.bonus }}</span>.
          <div class="small secondary">Irréversible sans potion de restat.</div>
        </div>
        <span class="spacer"></span>
        <button @click="confirming = false">Annuler</button>
        <button class="primary" :disabled="busy" @click="validate">{{ busy ? "Envoi…" : "Confirmer" }}</button>
      </div>
    </section>

    <section class="card">
      <h2>Historique des builds</h2>
      <p class="small muted" style="margin-top: -6px">Caractéristiques en combat (équipement compris), hors vie et niveau. Le plus récent en premier.</p>
      <div class="table-wrap" v-if="builds.length">
        <table>
          <thead><tr><th>Build</th><th>Période</th><th class="num">Combats</th><th class="num">V / N / D</th><th class="num">Taux de victoire</th></tr></thead>
          <tbody>
            <tr v-for="b in builds" :key="b.bucket">
              <td class="mono small">{{ b.bucket }}</td>
              <td class="small secondary">{{ fmtDate(b.first) }} → {{ fmtDate(b.last) }}</td>
              <td class="num">{{ b.fights }}</td>
              <td class="num">{{ b.wins }} / {{ b.draws }} / {{ b.losses }}</td>
              <td class="num">{{ fmtPct(b.winrate) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-else class="empty">Pas encore de combats analysés pour ce poireau.</div>
    </section>
  </template>
</template>

<style scoped>
.charac { display: flex; align-items: center; gap: 10px; }
.charac-icon { width: 28px; height: 28px; object-fit: contain; flex: none; }
.charac strong { font-size: 16px; }
.total { font-size: 17px; }
.stepper { display: inline-flex; align-items: center; gap: 6px; }
.stepper button { width: 28px; height: 28px; padding: 0; font-weight: 600; }
.stepper .mono { min-width: 40px; text-align: center; }
.bad { color: var(--critical); }
.up { color: var(--good); font-weight: 600; }
tr.planned { background: color-mix(in srgb, var(--accent) 8%, transparent); }
.actions { margin-top: 12px; }
.confirm { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-top: 12px; padding: 12px; border: 1px solid var(--warning); background: color-mix(in srgb, var(--warning) 8%, transparent); }
.ok { border-color: var(--good); color: var(--good); }
</style>
