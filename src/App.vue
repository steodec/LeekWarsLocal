<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { state, refreshStatus, refreshJobs, selectLeek, trackJob, switchAccount, go } from "./state";
import { api } from "./api";
import Dashboard from "./views/Dashboard.vue";
import Launch from "./views/Launch.vue";
import Fights from "./views/Fights.vue";
import FightDetail from "./views/FightDetail.vue";
import Stats from "./views/Stats.vue";
import Characteristics from "./views/Characteristics.vue";
import Leeks from "./views/Leeks.vue";
import Settings from "./views/Settings.vue";
import Tournaments from "./views/Tournaments.vue";
import Console from "./views/Console.vue";
import Meta from "./views/Meta.vue";
import JobsPanel from "./components/JobsPanel.vue";
import UpdateBanner from "./components/UpdateBanner.vue";
import { startUpdateChecks } from "./updater";
import LeekImage from "./components/LeekImage.vue";
import { lwImage } from "./lw";

const hash = ref(window.location.hash || "#/");
window.addEventListener("hashchange", () => (hash.value = window.location.hash || "#/"));

const view = computed(() => {
  const h = hash.value.replace(/^#/, "");
  const fight = h.match(/^\/fight\/(\d+)/);
  if (fight) return { name: "fight", id: Number(fight[1]) };
  const tournament = h.match(/^\/tournament\/(\d+)/);
  if (tournament) return { name: "tournament", id: Number(tournament[1]) };
  const name = h.split("?")[0].replace(/^\//, "") || "dashboard";
  return { name, id: 0 };
});

// Icônes de Leek Wars (public/lw/) ; `mask` : icône blanche teintée à la couleur du texte.
const NAV = [
  { key: "dashboard", label: "Tableau de bord", icon: "icon/xp_trophies.png" },
  { key: "launch", label: "Lancer", icon: "icon/xp_garden.png" },
  { key: "fights", label: "Combats", icon: "fight.png", mask: true },
  { key: "tournaments", label: "Tournois", icon: "icon/trophy.png" },
  { key: "stats", label: "Analyse", icon: "icon/xp_ranking.png" },
  { key: "meta", label: "Méta", icon: "icon/ranking.png" },
  { key: "characteristics", label: "Caractéristiques", icon: "charac/strength.png" },
  { key: "leeks", label: "Poireaux", icon: "icon/xp_leek.png" },
  { key: "console", label: "Comptes", icon: "icon/team.png" },
  { key: "settings", label: "Paramètres", icon: "icon/gearing.png", mask: true },
];

// Thème : automatique (système), clair ou sombre ; mémorisé dans le navigateur.
type Theme = "auto" | "light" | "dark";
const THEMES: Record<Theme, { next: Theme; label: string; glyph: string }> = {
  auto: { next: "light", label: "Thème automatique", glyph: "◐" },
  light: { next: "dark", label: "Thème clair", glyph: "☀" },
  dark: { next: "auto", label: "Thème sombre", glyph: "☾" },
};
const theme = ref<Theme>("auto");
try {
  const saved = localStorage.getItem("theme") as Theme | null;
  if (saved && saved in THEMES) theme.value = saved;
} catch {
  /* stockage indisponible : thème automatique */
}
function applyTheme() {
  if (theme.value === "auto") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme.value;
}
applyTheme();
function cycleTheme() {
  theme.value = THEMES[theme.value].next;
  applyTheme();
  try {
    localStorage.setItem("theme", theme.value);
  } catch {
    /* ignoré */
  }
}

const currentLeek = computed(() => state.status?.leeks.find((l) => l.id === state.leekId) ?? null);
const maskStyle = (file: string) => ({ maskImage: `url(${lwImage(file)})`, WebkitMaskImage: `url(${lwImage(file)})` });

function onAccountChange(e: Event) {
  const select = e.target as HTMLSelectElement;
  if (select.value === "add") {
    // Remet le sélecteur sur le compte actif, puis ouvre l'ajout de compte.
    select.value = String(state.status?.farmer.id ?? "");
    go("#/settings");
    return;
  }
  switchAccount(Number(select.value));
}

const syncing = computed(() => state.jobs.some((j) => j.kind === "sync" && j.status === "running"));
async function syncNow() {
  trackJob(await api.post("/api/sync", {}));
}

onMounted(() => {
  refreshStatus();
  refreshJobs();
  startUpdateChecks();
});
</script>

<template>
  <header class="top">
    <div class="brand" @click="go('#/')" title="LeekWars Local">
      <img class="brand-leek" :src="lwImage('icon/xp_leek.png')" alt="" />
      <span class="wordmark" :style="maskStyle('logo_pixel.svg')" role="img" aria-label="Leek Wars"></span>
      <span class="local">Local</span>
    </div>
    <nav>
      <a v-for="n in NAV" :key="n.key" :href="'#/' + (n.key === 'dashboard' ? '' : n.key)" :class="{ active: view.name === n.key || (n.key === 'fights' && view.name === 'fight') || (n.key === 'tournaments' && view.name === 'tournament') }">
        <span v-if="n.mask" class="nav-icon mask" :style="maskStyle(n.icon)" aria-hidden="true"></span>
        <img v-else class="nav-icon" :src="lwImage(n.icon)" alt="" />
        {{ n.label }}
      </a>
    </nav>
    <div class="spacer"></div>
    <div v-if="state.status" class="row right">
      <select
        v-if="state.status.accounts.length"
        class="account"
        :value="state.status.farmer.id"
        title="Compte actif"
        aria-label="Compte actif"
        @change="onAccountChange($event)"
      >
        <option v-for="a in state.status.accounts" :key="a.id" :value="a.id">
          {{ a.name }}{{ a.garden ? ` · ⚔ ${a.garden.fights}` : "" }}{{ a.ok ? "" : " (clé invalide)" }}
        </option>
        <option value="add">＋ Ajouter un compte…</option>
      </select>
      <LeekImage v-if="currentLeek" :leek="currentLeek" head :size="34" />
      <select :value="state.leekId ?? ''" @change="selectLeek(Number(($event.target as HTMLSelectElement).value) || null)" aria-label="Poireau">
        <option value="">Éleveur {{ state.status.farmer.name }} (tous ses poireaux)</option>
        <optgroup v-for="a in state.status.accounts" :key="a.id" :label="`Poireaux de ${a.name}`">
          <option v-for="l in state.status.leeks.filter((x) => x.owned && x.accountId === a.id)" :key="l.id" :value="l.id">{{ l.name }} · niv. {{ l.level }}</option>
        </optgroup>
        <optgroup v-if="state.status.leeks.some((x) => !x.owned)" label="Suivis pour analyse">
          <option v-for="l in state.status.leeks.filter((x) => !x.owned)" :key="l.id" :value="l.id">{{ l.name }} · niv. {{ l.level }} ({{ l.farmerName }})</option>
        </optgroup>
        <option v-if="!state.status.leeks.length" value="" disabled>Aucun poireau suivi</option>
      </select>
      <span class="fights mono" title="Combats restants aujourd'hui">
        <span class="nav-icon mask" :style="maskStyle('fight.png')" aria-hidden="true"></span>
        {{ state.status.garden.fights }}/{{ state.status.garden.maxFights }}
      </span>
      <button :disabled="syncing" @click="syncNow" title="Importer l'historique Leek Wars">{{ syncing ? "Synchro…" : "Synchroniser" }}</button>
    </div>
    <button class="ghost theme" :title="THEMES[theme].label" :aria-label="THEMES[theme].label" @click="cycleTheme">{{ THEMES[theme].glyph }}</button>
  </header>

  <main>
    <UpdateBanner />
    <div v-if="state.needsApiKey && view.name !== 'settings'" class="card setup">
      <b>Bienvenue !</b> Pour commencer, renseignez votre clé API Leek Wars.
      <a class="btn" href="#/settings">Configurer la clé API →</a>
    </div>
    <div v-else-if="state.error && view.name !== 'settings'" class="error">
      Serveur local injoignable ou erreur Leek Wars : {{ state.error }}<br />
      <span class="small">Vérifiez que <code>npm run server</code> tourne, ou la clé API dans <a href="#/settings">Paramètres</a>.</span>
    </div>
    <Dashboard v-if="view.name === 'dashboard'" />
    <Launch v-else-if="view.name === 'launch'" />
    <Fights v-else-if="view.name === 'fights'" />
    <FightDetail v-else-if="view.name === 'fight'" :id="view.id" :key="view.id" />
    <Stats v-else-if="view.name === 'stats'" />
    <Characteristics v-else-if="view.name === 'characteristics'" />
    <Leeks v-else-if="view.name === 'leeks'" />
    <Tournaments v-else-if="view.name === 'tournaments' || view.name === 'tournament'" :id="view.id" />
    <Meta v-else-if="view.name === 'meta'" />
    <Console v-else-if="view.name === 'console'" />
    <Settings v-else-if="view.name === 'settings'" />
    <div v-else class="empty">Page inconnue</div>
  </main>

  <JobsPanel />
</template>

<style scoped>
.top {
  position: sticky; top: 0; z-index: 10;
  display: flex; align-items: center; gap: 18px; flex-wrap: wrap;
  padding: 8px 20px; background: var(--surface-1); border-bottom: 2px solid var(--ink);
}
.brand { display: flex; align-items: center; gap: 8px; cursor: pointer; white-space: nowrap; }
.brand-leek { width: 34px; height: 34px; }
.wordmark { display: inline-block; width: 150px; height: 19px; background: var(--accent); mask-size: contain; mask-repeat: no-repeat; -webkit-mask-size: contain; -webkit-mask-repeat: no-repeat; }
.local {
  font-family: var(--font-display); letter-spacing: var(--display-tracking); font-weight: 700; font-size: 13px;
  padding: 0 5px; background: var(--accent-surface); color: var(--accent-ink);
}
nav { display: flex; gap: 2px; flex-wrap: wrap; }
nav a {
  display: inline-flex; align-items: center; gap: 6px; padding: 5px 10px; color: var(--text-secondary);
  font-family: var(--font-display); letter-spacing: var(--display-tracking); font-weight: 700; font-size: 14px;
  border: 1px solid transparent;
}
nav a:hover { background: var(--surface-2); text-decoration: none; color: var(--text-primary); }
nav a.active { background: var(--surface-input); color: var(--text-primary); border-color: var(--border-strong); box-shadow: inset 0 -3px 0 var(--accent-surface); }
.nav-icon { width: 20px; height: 20px; object-fit: contain; flex: none; }
.nav-icon.mask { display: inline-block; background: currentColor; mask-size: contain; mask-repeat: no-repeat; mask-position: center; -webkit-mask-size: contain; -webkit-mask-repeat: no-repeat; -webkit-mask-position: center; }
.fights { display: inline-flex; align-items: center; gap: 4px; color: var(--text-secondary); padding: 0 4px; font-family: var(--font-display); font-weight: 700; font-size: 15px; }
.theme { font-size: 18px; padding: 4px 8px; }
.setup { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; border-color: var(--accent); }
main { max-width: 1280px; margin: 0 auto; padding: 24px 20px; display: flex; flex-direction: column; gap: 20px; }
@media (max-width: 640px) {
  .top { padding: 8px 16px; gap: 10px; }
  .wordmark { width: 110px; }
  main { padding: 16px; }
}
</style>
