<script setup lang="ts">
import { computed, ref } from "vue";
import { api, qs, CONTEXTS, TYPES, type FightSummary } from "../api";
import { go, trackJob, state, refreshStatus } from "../state";
import { fmtDate, fmtNum, fmtOps } from "../format";
import ResultBadge from "../components/ResultBadge.vue";
import StatTile from "../components/StatTile.vue";
import LineChart from "../components/LineChart.vue";
import LeekImage from "../components/LeekImage.vue";
import ItemIcon from "../components/ItemIcon.vue";
import FightReplay, { type ReplayData } from "../components/FightReplay.vue";
import AiAnalysis from "../components/AiAnalysis.vue";
import { lwImage } from "../lw";
import { leekscriptErrors, logLines, type LogLine } from "../fightlogs";

const props = defineProps<{ id: number }>();
const summary = ref<FightSummary | null>(null);
const analysis = ref<any>(null);
const error = ref("");
const note = ref("");
const tags = ref("");
const saved = ref(false);
const logs = ref<LogLine[] | null>(null);
const logsError = ref("");
const logsIssuesOnly = ref(false);
const replayData = ref<ReplayData | null>(null);
const replayError = ref("");
const showSummons = ref(false);
const turnEntity = ref<number | null>(null);

const participants = ref<{ id: number; name: string; tracked: boolean; mine: boolean }[]>([]);
// Point de vue : ?leek= dans l'URL, sinon le poireau sélectionné s'il a participé (le serveur choisit sinon).
const viewLeek = ref<number | null>(Number(new URLSearchParams(window.location.hash.split("?")[1] ?? "").get("leek")) || state.leekId);
const perspectiveLeek = ref<number | null>(null);

async function load(refresh = false) {
  try {
    const res = await api.get(`/api/fights/${props.id}${qs({ refresh: refresh ? 1 : undefined, leek: viewLeek.value ?? undefined })}`);
    participants.value = res.participants ?? [];
    perspectiveLeek.value = res.perspective?.leekId ?? null;
    viewLeek.value = res.perspective?.leekId ?? null;
    summary.value = res.summary;
    analysis.value = res.analysis;
    note.value = res.summary?.note ?? "";
    tags.value = (res.summary?.tags ?? []).join(", ");
    const mine = res.analysis?.entities.find((e: any) => e.mine && !e.summon);
    turnEntity.value = mine?.id ?? res.analysis?.entities[0]?.id ?? null;
    error.value = "";
  } catch (e: any) {
    error.value = e.message;
  }
}
load();

async function save() {
  await api.patch(`/api/fights/${props.id}`, { note: note.value, tags: tags.value.split(",") });
  saved.value = true;
  setTimeout(() => (saved.value = false), 1500);
}

async function remove() {
  await api.del(`/api/fights/${props.id}`);
  state.dataVersion++;
  go("#/fights");
}

async function follow(id: number) {
  const res = await api.post("/api/leeks/tracked", { id });
  if (res.job) trackJob(res.job);
  await refreshStatus();
  load();
}

async function loadLogs() {
  logsError.value = "";
  try {
    const [raw, errors] = await Promise.all([api.get(`/api/fights/${props.id}/logs`), leekscriptErrors()]);
    logs.value = logLines(raw, errors);
  } catch (e: any) {
    logsError.value = e.message;
  }
}

async function loadReplay() {
  try {
    replayData.value = await api.get(`/api/fights/${props.id}/replay`);
    replayError.value = "";
  } catch (e: any) {
    replayError.value = e.message;
  }
}
loadReplay();
loadLogs();

// Logs groupés par tour (tour de l'action à laquelle ils sont rattachés).
const entityName = (id: number) => replayData.value?.entities.find((e) => e.id === id)?.name ?? `#${id}`;
const logsByTurn = computed(() => {
  const actions = replayData.value?.actions ?? [];
  const turnAt: number[] = [];
  let turn = 1;
  actions.forEach((a, i) => {
    if (a[0] === 6) turn = a[1];
    turnAt[i] = turn;
  });
  const groups: { turn: number; lines: LogLine[] }[] = [];
  for (const l of logs.value ?? []) {
    if (logsIssuesOnly.value && l.kind !== "warning" && l.kind !== "error") continue;
    const t = turnAt[l.action] ?? 0;
    let last = groups[groups.length - 1];
    if (last?.turn !== t) groups.push((last = { turn: t, lines: [] }));
    last.lines.push(l);
  }
  return groups;
});
const logCounts = computed(() => ({
  total: logs.value?.length ?? 0,
  errors: logs.value?.filter((l) => l.kind === "error").length ?? 0,
  warnings: logs.value?.filter((l) => l.kind === "warning").length ?? 0,
}));

async function replay() {
  const s = summary.value!;
  const job = await api.post("/api/fights/challenge", {
    leekId: s.myLeeks[0],
    targetId: s.opponents[0]?.id,
    seed: s.seed ?? 0,
    side: s.mySide === 1 ? "left" : "right",
  });
  trackJob(job);
}

// Rejouer = défi avec le même seed, possible seulement si le point de vue est un de mes poireaux en 1 contre 1.
const canReplay = computed(() => {
  const s = summary.value;
  if (!s || s.opponents.length !== 1 || !s.myLeeks.length) return false;
  return !!state.status?.leeks.find((l) => l.id === s.myLeeks[0] && l.owned);
});
const leeks = computed(() => (analysis.value?.entities ?? []).filter((e: any) => showSummons.value || !e.summon));
const mainEntities = computed(() => (analysis.value?.entities ?? []).filter((e: any) => !e.summon));

// Couleurs : mes poireaux en bleu, adverses en orange ; au-delà d'un par camp, on distingue par opacité + nom en légende.
const lifeSeries = computed(() => {
  if (!analysis.value) return [];
  const ents = mainEntities.value;
  return ents.map((e: any) => ({
    name: `${e.name}${e.mine ? " (moi)" : ""}`,
    color: e.mine ? "var(--series-me)" : "var(--series-them)",
    step: true,
    points: [{ x: 0, y: e.maxLife }, ...analysis.value.lifeTimeline.map((t: any) => ({ x: t.turn, y: t.life[e.id] ?? 0 }))],
  }));
});

const turnRows = computed(() => (analysis.value?.turnsLog ?? []).filter((t: any) => t.entity === turnEntity.value));
const turnEntityObj = computed(() => analysis.value?.entities.find((e: any) => e.id === turnEntity.value));
const nameOf = (id: number | null) => analysis.value?.entities.find((e: any) => e.id === id)?.name ?? "?";
const entitiesWithItems = computed(() => (analysis.value?.entities ?? []).filter((e: any) => e.items.length && (!e.summon || showSummons.value)));
</script>

<template>
  <div v-if="error" class="error">{{ error }}</div>
  <template v-if="summary">
    <section class="row">
      <button class="ghost" @click="go('#/fights')">←</button>
      <h1>Combat #{{ summary.id }}</h1>
      <ResultBadge :result="summary.result" />
      <span class="secondary">{{ fmtDate(summary.date) }} · {{ CONTEXTS[summary.context] }} · {{ TYPES[summary.type] }} · {{ summary.turns ?? "?" }} tours</span>
      <span class="spacer"></span>
      <a class="btn" :href="`https://leekwars.com/fight/${summary.id}`" target="_blank" rel="noopener">Voir sur Leek Wars ↗</a>
      <button v-if="canReplay" @click="replay" title="Relance un défi contre le même adversaire avec le même seed">Rejouer en défi</button>
      <button @click="load(true)">Recharger</button>
      <button class="danger" @click="remove">Supprimer</button>
    </section>

    <section class="grid cols-2">
      <div class="card">
        <div class="row" style="margin-bottom: 8px">
          <h3 style="margin: 0">Camps</h3>
          <span class="spacer"></span>
          <label class="row small secondary" style="gap: 6px">
            Point de vue
            <select :value="viewLeek ?? ''" @change="viewLeek = Number(($event.target as HTMLSelectElement).value) || null; load()">
              <option v-if="participants.some((p) => p.mine)" value="">Mon éleveur</option>
              <option v-for="p in participants" :key="p.id" :value="p.id">{{ p.name }}{{ p.mine ? " (à moi)" : p.tracked ? " (suivi)" : "" }}</option>
            </select>
          </label>
        </div>
        <div class="versus">
          <template v-for="side in [1, 2]" :key="side">
            <img v-if="side === 2" class="vs" :src="lwImage('vs.png')" alt="contre" />
            <div class="side" :class="{ me: summary.mySide === side, winner: summary.winner === side }">
              <div v-for="l in (summary as any)['leeks' + side]" :key="l.id" class="fighter">
                <LeekImage :leek="l" :size="(summary as any)['leeks' + side].length > 2 ? 64 : 96" />
                <a :href="`https://leekwars.com/leek/${l.id}`" target="_blank" rel="noopener" class="display">{{ l.name }}</a>
                <span class="muted small">niv. {{ l.level }} · <img class="icon" :src="lwImage('talent.svg')" alt="talent" /> {{ l.talent }}</span>
                <button v-if="!participants.find((p) => p.id === l.id)?.tracked && !participants.find((p) => p.id === l.id)?.mine" class="ghost small" @click="follow(l.id)" title="Suivre ce poireau pour l'analyser">+ Suivre</button>
              </div>
              <span v-if="summary.winner === side" class="win-label display">Vainqueur</span>
            </div>
          </template>
        </div>
        <div class="small muted" style="margin-top: 8px">
          Seed {{ summary.seed ?? "?" }} · gains : talent {{ summary.talentGain ?? "–" }}, XP {{ fmtNum(summary.xp) }}, habs {{ fmtNum(summary.money) }}
        </div>
      </div>
      <div class="card">
        <h3>Notes</h3>
        <textarea v-model="note" rows="2" placeholder="Ce que j'ai observé, idée d'amélioration de l'IA…" style="width: 100%"></textarea>
        <div class="row" style="margin-top: 6px">
          <input v-model="tags" placeholder="tags séparés par des virgules" style="flex: 1" />
          <button @click="save">{{ saved ? "Enregistré ✓" : "Enregistrer" }}</button>
        </div>
      </div>
    </section>

    <AiAnalysis v-if="analysis" :fight-id="summary.id" :leek="perspectiveLeek" />

    <section class="card">
      <h2>Replay</h2>
      <FightReplay v-if="replayData" :data="replayData" :logs="logs ?? []" :my-side="summary.mySide" />
      <div v-else-if="replayError" class="error">{{ replayError }}</div>
      <div v-else class="muted small">Chargement du combat…</div>
    </section>

    <template v-if="analysis">
      <section class="tiles" v-if="summary.me && summary.them">
        <StatTile label="Dégâts infligés" :value="fmtNum(summary.me.damageDealt)" :hint="`adversaire : ${fmtNum(summary.them.damageDealt)}`" />
        <StatTile label="Soins" :value="fmtNum(summary.me.heal)" :hint="`adversaire : ${fmtNum(summary.them.heal)}`" />
        <StatTile label="Vie restante" :value="fmtNum(summary.me.lifeLeftPct) + ' %'" :hint="`adversaire : ${fmtNum(summary.them.lifeLeftPct)} %`" />
        <StatTile label="PT inutilisés / tour" :value="fmtNum(summary.me.tpUnusedPerTurn, 1)" :hint="`adversaire : ${fmtNum(summary.them.tpUnusedPerTurn, 1)}`" />
        <StatTile label="Opérations IA" :value="fmtOps(summary.me.ops)" :hint="`adversaire : ${fmtOps(summary.them.ops)}`" />
        <StatTile label="Bugs IA" :value="summary.me.bugs" :hint="`invocations : ${summary.me.summons}`" />
      </section>

      <section class="card">
        <h2>Points de vie par tour</h2>
        <LineChart :series="lifeSeries" :format-x="(x) => 'Tour ' + Math.round(x)" :y-min="0" :height="240" />
        <div v-if="analysis.kills.length" class="small secondary" style="margin-top: 8px">
          Morts :
          <span v-for="(k, i) in analysis.kills" :key="i">{{ i ? " · " : "" }}{{ nameOf(k.victim) }} (tour {{ k.turn }}, par {{ nameOf(k.killer) }})</span>
        </div>
      </section>

      <section class="card">
        <div class="row" style="margin-bottom: 8px">
          <h2>Entités</h2><span class="spacer"></span>
          <label class="row small secondary" style="gap: 6px"><input type="checkbox" v-model="showSummons" /> Afficher les invocations</label>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Entité</th><th class="num">Vie</th><th class="num">Infligés</th><th class="num">dont poison</th><th class="num">Subis</th>
                <th class="num">Soins</th><th class="num">Kills</th><th class="num">Tours</th><th class="num">PT/tour</th><th class="num">PM/tour</th>
                <th class="num">Puces</th><th class="num">Tirs</th><th class="num">Crit.</th><th class="num">Échecs</th><th class="num">Bugs</th><th class="num">Ops</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="e in leeks" :key="e.id">
                <td class="leek-cell">
                  <span class="dot" :style="{ background: e.mine ? 'var(--series-me)' : 'var(--series-them)' }"></span>
                  <LeekImage v-if="!e.summon" :leek="e" head :size="28" />
                  {{ e.name }} <span class="muted small">{{ e.summon ? "invocation" : "niv. " + e.level }}</span>
                  <span v-if="e.deathTurn" class="small" style="color: var(--critical)"> ✕ t{{ e.deathTurn }}</span>
                </td>
                <td class="num">{{ e.finalLife }}/{{ e.maxLife }}</td>
                <td class="num">{{ fmtNum(e.damageDealt) }}</td>
                <td class="num">{{ fmtNum(e.poisonDealt) }}</td>
                <td class="num">{{ fmtNum(e.damageTaken) }}</td>
                <td class="num">{{ fmtNum(e.heal) }}</td>
                <td class="num">{{ e.kills }}</td>
                <td class="num">{{ e.turnsPlayed }}</td>
                <td class="num">{{ fmtNum(e.tpUsedPerTurn, 1) }}/{{ e.tp }}</td>
                <td class="num">{{ fmtNum(e.mpUsedPerTurn, 1) }}/{{ e.mp }}</td>
                <td class="num">{{ e.chipUses }}</td>
                <td class="num">{{ e.weaponUses }}</td>
                <td class="num">{{ e.crits }}</td>
                <td class="num">{{ e.fails }}</td>
                <td class="num" :style="{ color: e.bugs ? 'var(--critical)' : undefined }">{{ e.bugs }}</td>
                <td class="num">{{ fmtOps(e.ops) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="grid cols-2">
        <div v-for="e in entitiesWithItems" :key="e.id" class="card">
          <h2><LeekImage v-if="!e.summon" :leek="e" head :size="32" /><span v-else class="dot" :style="{ background: e.mine ? 'var(--series-me)' : 'var(--series-them)' }"></span>Objets de {{ e.name }}</h2>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Objet</th><th class="num">Utilisations</th><th class="num">Dégâts</th><th class="num">Soins</th><th class="num">Dégâts/util.</th><th class="num">Crit.</th><th class="num">Kills</th></tr></thead>
              <tbody>
                <tr v-for="it in e.items" :key="it.kind + it.name">
                  <td><ItemIcon :kind="it.kind" :name="it.name" label /></td>
                  <td class="num">{{ it.uses }}</td>
                  <td class="num">{{ fmtNum(it.damage) }}</td>
                  <td class="num">{{ fmtNum(it.heal) }}</td>
                  <td class="num">{{ it.uses ? fmtNum(it.damage / it.uses, 1) : "–" }}</td>
                  <td class="num">{{ it.crits }}</td>
                  <td class="num">{{ it.kills }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section class="card">
        <div class="row" style="margin-bottom: 8px">
          <h2>Tour par tour</h2><span class="spacer"></span>
          <select v-model.number="turnEntity">
            <option v-for="e in analysis.entities" :key="e.id" :value="e.id">{{ e.name }}{{ e.summon ? " (invocation)" : "" }}</option>
          </select>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th class="num">Tour</th><th class="num">PT utilisés</th><th class="num">PM utilisés</th><th class="num">Dégâts</th><th>Puces</th><th class="num">Tirs</th></tr></thead>
            <tbody>
              <tr v-for="(t, i) in turnRows" :key="i">
                <td class="num">{{ t.turn }}</td>
                <td class="num" :style="{ color: turnEntityObj && t.tpUsed < turnEntityObj.tp / 2 ? 'var(--warning)' : undefined }">{{ t.tpUsed }}/{{ turnEntityObj?.tp }}</td>
                <td class="num">{{ t.mpUsed }}</td>
                <td class="num">{{ fmtNum(t.damage) }}</td>
                <td class="chips"><ItemIcon v-for="(c, j) in t.chips" :key="j" kind="chip" :name="c" :size="22" /><span v-if="!t.chips.length" class="muted">–</span></td>
                <td class="num">{{ t.weapons }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p class="small muted">PT utilisés estimés à partir du coût des objets (les bonus de PT temporaires ne sont pas comptés). En orange : moins de la moitié des PT utilisés.</p>
      </section>

      <section class="card">
        <div class="row" style="margin-bottom: 8px">
          <h2>Logs IA</h2>
          <span v-if="logs" class="small secondary">
            {{ logCounts.total }} ligne(s)
            <template v-if="logCounts.errors"> · <span class="log-error">{{ logCounts.errors }} erreur(s)</span></template>
            <template v-if="logCounts.warnings"> · <span class="log-warning">{{ logCounts.warnings }} avertissement(s)</span></template>
          </span>
          <span class="spacer"></span>
          <label class="row small secondary" style="gap: 6px"><input type="checkbox" v-model="logsIssuesOnly" /> Erreurs et avertissements seulement</label>
          <button @click="loadLogs">Recharger</button>
        </div>
        <div v-if="logsError" class="error">{{ logsError }}</div>
        <div v-else-if="logs && !logs.length" class="empty small">
          Aucun log : l'IA n'a rien affiché (debug, debugW, debugE…) et aucune erreur n'a été levée. Les logs ne sont visibles que pour vos propres poireaux.
        </div>
        <div v-else-if="logs" class="logs">
          <template v-for="g in logsByTurn" :key="g.turn">
            <div class="log-turn">Tour {{ g.turn }}</div>
            <div v-for="l in g.lines" :key="`${l.action}-${l.index}`" class="log-line" :class="l.kind ? 'log-' + l.kind : ''" :style="l.color ? { color: l.color } : undefined">
              <span class="muted">[{{ entityName(l.entity) }}]</span> {{ l.text }}
            </div>
          </template>
          <div v-if="!logsByTurn.length" class="muted">Aucune erreur ni avertissement.</div>
        </div>
        <div v-else class="muted small">Chargement des logs…</div>
      </section>
    </template>
    <div v-else class="card empty">Combat pas encore terminé ou données indisponibles. <button @click="load(true)">Réessayer</button></div>
  </template>
</template>

<style scoped>
.versus { display: flex; align-items: center; gap: 12px; }
.side { flex: 1; display: flex; flex-wrap: wrap; justify-content: center; align-items: flex-end; gap: 12px; padding: 10px 6px; position: relative; border: 1px solid transparent; }
.side.me { background: color-mix(in srgb, var(--series-me) 8%, transparent); border-color: color-mix(in srgb, var(--series-me) 35%, transparent); }
.side.winner { border-color: var(--good); }
.fighter { display: flex; flex-direction: column; align-items: center; gap: 2px; text-align: center; }
.fighter .icon { width: 14px; height: 14px; }
.vs { width: 48px; height: auto; flex: none; }
.win-label { position: absolute; top: -10px; left: 8px; padding: 0 6px; font-size: 12px; background: var(--good); color: var(--accent-ink); }
.chips { display: flex; gap: 2px; flex-wrap: wrap; }
.dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px; flex: none; }
.logs { max-height: 420px; overflow: auto; background: var(--surface-2); border: 1px solid var(--border); padding: 10px; font-size: 12px; font-family: var(--font-mono, monospace); white-space: pre-wrap; }
.log-turn { color: var(--text-muted); margin: 8px 0 2px; }
.log-turn:first-child { margin-top: 0; }
.log-warning { color: var(--warning); }
.log-error { color: var(--critical); }
.log-pause { color: var(--series-me); }
</style>
