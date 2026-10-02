import { reactive, ref } from "vue";
import { api } from "./api";

export interface TrackedLeek {
  id: number; name: string; level: number; talent: number; ai: string | null; capital: number | null;
  life: number | null; tp: number | null; mp: number | null;
  /** Apparence (images Leek Wars) */
  skin?: number; hat?: number | null; hatItem?: number | null; metal?: boolean; face?: number;
  /** true = poireau de mon compte (lancement, capital) ; false = suivi pour analyse uniquement. */
  owned: boolean; farmerName?: string | null;
  /** Compte propriétaire (si à moi). */
  accountId?: number | null; accountName?: string | null;
}

export interface Account {
  id: number; name: string; active: boolean; keyMasked: string | null; ok: boolean; error: string | null;
  leeks: number; talent?: number; garden: { fights: number; maxFights: number } | null;
}

export interface Status {
  farmer: { id: number; name: string; talent: number; habs: number; victories: number; defeats: number; draws: number };
  accounts: Account[];
  leeks: TrackedLeek[];
  garden: { fights: number; maxFights: number; teamFights: number; battleRoyaleFights: number };
  store: { fights: number; lastSync: number | null };
}

export interface Job {
  id: number;
  kind: string;
  status: "running" | "done" | "error";
  progress: { done: number; total: number };
  fights: { id: number; opponent: { id: number; name?: string; level?: number; talent?: number } | null; result: string; turns?: number }[];
  error: string | null;
  lastLog: string | null;
  startedAt: number;
}

export const state = reactive({
  status: null as Status | null,
  error: "" as string,
  /** Aucune clé API configurée côté serveur : l'interface renvoie vers Paramètres. */
  needsApiKey: false,
  leekId: Number(localStorageGet("lwl.leek")) || (null as number | null),
  /** false tant que l'utilisateur n'a rien choisi : on sélectionne alors son premier poireau. */
  leekChosen: localStorageGet("lwl.leek") !== null,
  jobs: [] as Job[],
  /** Incrémenté à chaque fin de tâche : les vues s'en servent pour se rafraîchir. */
  dataVersion: 0,
});

export const loading = ref(false);

function localStorageGet(k: string) {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}

export function selectLeek(id: number | null) {
  state.leekId = id;
  state.leekChosen = true;
  try {
    // "" = vue éleveur (tous mes poireaux).
    localStorage.setItem("lwl.leek", id ? String(id) : "");
  } catch {
    /* stockage indisponible */
  }
}

export async function refreshStatus() {
  loading.value = true;
  try {
    state.status = await api.get<Status>("/api/status");
    state.error = "";
    state.needsApiKey = false;
    const missing = state.leekId && !state.status.leeks.some((l) => l.id === state.leekId);
    if (missing || (!state.leekId && !state.leekChosen)) {
      selectLeek(state.status.leeks.find((l) => l.owned)?.id ?? state.status.leeks[0]?.id ?? null);
    }
  } catch (e: any) {
    state.needsApiKey = e.code === "no_api_key";
    state.error = e.message;
  } finally {
    loading.value = false;
  }
}

let pollTimer: number | undefined;
export async function refreshJobs() {
  try {
    const jobs = await api.get<Job[]>("/api/jobs");
    const wasRunning = state.jobs.filter((j) => j.status === "running").map((j) => j.id);
    state.jobs = jobs;
    const finished = jobs.some((j) => wasRunning.includes(j.id) && j.status !== "running");
    if (finished) {
      state.dataVersion++;
      refreshStatus();
    }
  } catch {
    /* serveur injoignable : on réessaie au prochain tick */
  }
  clearTimeout(pollTimer);
  pollTimer = window.setTimeout(refreshJobs, state.jobs.some((j) => j.status === "running") ? 1500 : 10000);
}

export function trackJob(job: Job) {
  state.jobs = [job, ...state.jobs.filter((j) => j.id !== job.id)];
  clearTimeout(pollTimer);
  pollTimer = window.setTimeout(refreshJobs, 1000);
}

export async function switchAccount(id: number) {
  await api.put("/api/accounts/active", { id });
  await refreshStatus();
  state.dataVersion++;
}

export function go(hash: string) {
  window.location.hash = hash;
}
